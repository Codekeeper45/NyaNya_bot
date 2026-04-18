import { Worker } from 'bullmq';
import { redisConnection } from './queue.js';
import { runOrchestrator } from '../agent/orchestrator.js';
import { usersRepo } from '../db/repos/users.js';
import { messagesRepo } from '../db/repos/messages.js';
import { lessonPlansRepo } from '../db/repos/lesson_plans.js';
import { habitsRepo } from '../db/repos/habits.js';
import type { JobPayload } from './jobs.js';
import { scheduleFollowup } from './proactive.js';
import { callUser, isTwilioConfigured } from '../call/initiate.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('worker');

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

      if (kind === 'followup_check' && (attemptNumber ?? 1) >= 4) {
        log.info({ userId, jobId: job.id, attemptNumber }, 'Followup attempt limit reached');
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
        preferences: (user.preferences as Record<string, unknown>) ?? {},
        onboardingComplete: user.onboardingComplete,
        mode: 'proactive',
        proactiveKind: kind,
        proactiveContext: proactiveContext,
        proactiveAttempt: attemptNumber ?? 1,
      });

      // Auto-escalate followup_check: schedule next attempt if not at limit
      if (kind === 'followup_check') {
        const currentAttempt = attemptNumber ?? 1;
        if (currentAttempt < 4) {
          await scheduleFollowup(
            { userId, telegramUserId, telegramChatId, context: context ?? '' },
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
