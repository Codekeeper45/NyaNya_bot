import { Worker } from 'bullmq';
import { redisConnection } from './queue.js';
import { runOrchestrator } from '../agent/orchestrator.js';
import { usersRepo } from '../db/repos/users.js';
import { messagesRepo } from '../db/repos/messages.js';
import { lessonPlansRepo } from '../db/repos/lesson_plans.js';
import { habitsRepo } from '../db/repos/habits.js';
import { todosRepo } from '../db/repos/todos.js';
import type { JobPayload } from './jobs.js';
import { scheduleFollowup } from './proactive.js';
import { callUser, isTwilioConfigured } from '../call/initiate.js';
import { jobSkipOnceRepo } from '../db/repos/job_skip_once.js';
import { repeatingJobsRepo } from '../db/repos/repeating_jobs.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('worker');

function clampFollowupLimit(value: unknown, fallback = 3): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(3, Math.floor(value)));
}

function resolveFollowupLimit(
  preferences: Record<string, unknown>,
  proactiveKind?: string,
): number {
  const globalMax = clampFollowupLimit(preferences.followup_max_attempts, 3);
  const byKind = (preferences.followup_by_kind && typeof preferences.followup_by_kind === 'object')
    ? preferences.followup_by_kind as Record<string, unknown>
    : undefined;
  const kindValue = proactiveKind ? byKind?.[proactiveKind] : undefined;
  const perKindMax = clampFollowupLimit(kindValue, globalMax);
  return Math.min(3, globalMax, perKindMax);
}

export function startWorker(): Worker<JobPayload> {
  const worker = new Worker<JobPayload>(
    'opekun-jobs',
    async (job) => {
      const { userId, telegramUserId, telegramChatId, kind, context, attemptNumber } = job.data;
      log.info({ jobId: job.id, kind, userId }, 'Processing job');

      const user = await usersRepo.findById(userId);
      if (!user) {
        log.warn({ userId }, 'User not found, skipping job');
        return;
      }
      if (user.paused) {
        log.info({ userId, kind }, 'User paused, skipping job');
        return;
      }

      const skipId = job.data.schedulerId;
      if (skipId && await jobSkipOnceRepo.shouldSkip(skipId)) {
        await jobSkipOnceRepo.clear(skipId);
        log.info({ userId, kind, schedulerId: skipId }, 'Job skipped once by user request');
        return;
      }

      if (skipId) {
        const exists = await repeatingJobsRepo.findBySchedulerId(skipId);
        if (!exists) {
          log.warn({ userId, kind, schedulerId: skipId }, 'Skipping scheduler job missing in DB source-of-truth');
          return;
        }
      }

      // Skip followup_check if user already replied after this job was scheduled
      if (kind === 'followup_check' && job.timestamp) {
        const lastReply = await messagesRepo.getLastUserReplyTime(userId);
        if (lastReply && lastReply.getTime() > job.timestamp) {
          log.info({ userId, jobId: job.id }, 'User already replied — skipping followup');
          return;
        }
      }

      // Don't follow up until the user has completed onboarding
      if (kind === 'followup_check' && !user.onboardingComplete) {
        log.info({ userId, jobId: job.id }, 'Onboarding not complete — skipping followup');
        return;
      }

      const preferences = (user.preferences as Record<string, unknown>) ?? {};
      const followupForKind = typeof job.data.metadata?.followupForKind === 'string'
        ? job.data.metadata.followupForKind
        : undefined;
      const followupLimit = resolveFollowupLimit(preferences, followupForKind);

      if (kind === 'followup_check' && (attemptNumber ?? 1) > followupLimit) {
        log.info({ userId, jobId: job.id, attemptNumber, followupLimit }, 'Followup attempt limit reached');
        // Try calling if phone number is set
        if (isTwilioConfigured() && user.phoneNumber) {
          log.info({ userId }, 'Escalating to phone call');
          await callUser({
            toNumber: user.phoneNumber,
            userId,
            telegramChatId,
            userName: user.name,
            timezone: user.timezone,
            reason: 'Ты долго не отвечал(а) на мои сообщения, вот и решила позвонить — всё хорошо?',
          });
        }
        return;
      }

      let proactiveContext = context;

      // For lesson_session: enrich context with plan details if available
      if (kind === 'lesson_session' && context) {
        try {
          const parsed = JSON.parse(context) as { planId?: number; subject?: string; topic?: string; planText?: string };
          if (parsed.planId) {
            const plan = await lessonPlansRepo.findById(parsed.planId);
            if (plan) {
              proactiveContext = JSON.stringify({
                planId: plan.id,
                subject: plan.subject,
                topic: plan.topic,
                planText: plan.plan ?? '',
              });
            }
          }
        } catch { /* keep original context */ }
      }

      // For evening_reflection: append today's habits status
      if (kind === 'evening_reflection') {
        try {
          const todayDate = new Date().toLocaleDateString('sv-SE', { timeZone: user.timezone });
          const todayLogs = await habitsRepo.getTodayLogs(userId, todayDate);
          if (todayLogs.length > 0) {
            const habitsSummary = todayLogs
              .map(({ habit, log }) => `- ${habit.name}: ${log === null ? 'не отмечено' : log.done ? '✓ выполнено' : '✗ пропущено'}`)
              .join('\n');
            proactiveContext = `${context}\n\nПривычки сегодня:\n${habitsSummary}`;
          }
        } catch { /* ignore habits error */ }
      }

      // For daily_planning: enrich with todos + habits
      if (kind === 'daily_planning') {
        try {
          const todayDate = new Date().toLocaleDateString('sv-SE', { timeZone: user.timezone });
          const [activeTodos, todayLogs] = await Promise.all([
            todosRepo.list(userId, false),
            habitsRepo.getTodayLogs(userId, todayDate),
          ]);
          const todoLines = activeTodos.length > 0
            ? activeTodos.map(t => `- [${t.id}] ${t.text}${t.deadline ? ` (до ${t.deadline.toLocaleDateString('ru-RU')})` : ''}`).join('\n')
            : 'нет активных задач';
          const habitLines = todayLogs.length > 0
            ? todayLogs.map(({ habit, log }) => `- ${habit.name}: ${log === null ? 'не отмечено' : log.done ? '✓' : '✗'}`).join('\n')
            : 'привычки не настроены';
          proactiveContext = `Дневное планирование.\n\nАктивные задачи:\n${todoLines}\n\nПривычки сегодня:\n${habitLines}`;
        } catch (err) {
          log.error({ err, userId }, 'Failed to enrich daily_planning context');
        }
      }

      // Special handling for weekly digest to provide stats
      if (kind === 'weekly_digest') {
        try {
          const msgStats = await messagesRepo.getWeeklyStats(userId);
          const eduStats = await lessonPlansRepo.getWeeklyStats(userId);
          proactiveContext = `${context}. Статистика за неделю: сообщений от пользователя: ${msgStats.totalMessages}, учебных планов создано: ${eduStats.totalPlans}, уроков завершено: ${eduStats.completedPlans}.`;
        } catch (err) {
          log.error({ err, userId }, 'Failed to fetch weekly stats for digest');
        }
      }

      await runOrchestrator({
        userId,
        telegramUserId,
        telegramChatId,
        userName: user.name,
        userTimezone: user.timezone,
        wakeTime: user.wakeTime ?? undefined,
        sleepTime: user.sleepTime ?? undefined,
        weekendWakeTime: user.weekendWakeTime ?? undefined,
        weekendSleepTime: user.weekendSleepTime ?? undefined,
        preferences,
        onboardingComplete: user.onboardingComplete,
        mode: 'proactive',
        proactiveKind: kind,
        proactiveContext: proactiveContext,
        proactiveAttempt: attemptNumber ?? 1,
      });

      // Auto-escalate followup_check: schedule next attempt if not at limit
      if (kind === 'followup_check') {
        const currentAttempt = attemptNumber ?? 1;
        if (currentAttempt < followupLimit) {
          await scheduleFollowup(
            {
              userId,
              telegramUserId,
              telegramChatId,
              context: context ?? '',
              metadata: {
                ...(job.data.metadata ?? {}),
                ...(followupForKind ? { followupForKind } : {}),
              },
            },
            currentAttempt + 1,
          );
        }
      }
    },
    {
      connection: redisConnection,
      concurrency: 1,
    },
  );

  let consecutiveFailures = 0;

  worker.on('completed', (job) => {
    consecutiveFailures = 0;
    log.info({ jobId: job.id, kind: job.data.kind }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    consecutiveFailures++;
    log.error({ jobId: job?.id, err, consecutiveFailures }, 'Job failed');
    if (consecutiveFailures >= 5) {
      log.fatal({ consecutiveFailures }, 'Too many consecutive job failures — exiting');
      process.exit(1);
    }
  });

  return worker;
}
