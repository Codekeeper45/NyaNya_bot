import { Worker } from 'bullmq';
import { workerRedisConnection } from './queue.js';
import { runOrchestrator } from '../agent/orchestrator.js';
import { usersRepo } from '../db/repos/users.js';
import { messagesRepo } from '../db/repos/messages.js';
import { lessonPlansRepo } from '../db/repos/lesson_plans.js';
import { habitsRepo } from '../db/repos/habits.js';
import { todosRepo } from '../db/repos/todos.js';
import { jobExecutionsRepo } from '../db/repos/job_executions.js';
import type { JobPayload } from './jobs.js';

import { callUser, isTwilioConfigured } from '../call/initiate.js';
import { jobSkipOnceRepo } from '../db/repos/job_skip_once.js';
import { repeatingJobsRepo } from '../db/repos/repeating_jobs.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('worker');

function clampFollowupLimit(value: unknown, fallback = 3): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(3, Math.floor(value)));
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function isUserAsleep(
  nowMinutes: number,
  sleepMinutes: number,
  wakeMinutes: number,
): boolean {
  if (sleepMinutes > wakeMinutes) {
    // Sleep crosses midnight (e.g. 23:00 → 08:00)
    return nowMinutes >= sleepMinutes || nowMinutes < wakeMinutes;
  }
  // Sleep does not cross midnight (e.g. 02:00 → 10:00)
  return nowMinutes >= sleepMinutes && nowMinutes < wakeMinutes;
}

function shouldSkipBecauseAsleep(
  kind: string,
  user: {
    timezone: string;
    sleepTime: string | null;
    wakeTime: string | null;
    weekendSleepTime?: string | null;
    weekendWakeTime?: string | null;
  },
): { skip: boolean; reason?: string } {
  if (kind === 'followup_check') return { skip: false };
  if (!user.sleepTime || !user.wakeTime) return { skip: false };

  const nowStr = new Date().toLocaleTimeString('sv-SE', {
    timeZone: user.timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  const nowMinutes = timeToMinutes(nowStr);

  const todayInTz = new Date().toLocaleDateString('en-US', { timeZone: user.timezone });
  const dayOfWeek = new Date(todayInTz).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const sleepTime = isWeekend && user.weekendSleepTime ? user.weekendSleepTime : user.sleepTime;
  const wakeTime = isWeekend && user.weekendWakeTime ? user.weekendWakeTime : user.wakeTime;

  const sleepMinutes = timeToMinutes(sleepTime);
  const wakeMinutes = timeToMinutes(wakeTime);

  if (isUserAsleep(nowMinutes, sleepMinutes, wakeMinutes)) {
    return { skip: true, reason: `user_asleep (${nowStr}, sleep ${sleepTime}→${wakeTime})` };
  }
  return { skip: false };
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

      let wasSkipped = false;
      let skipReason: string | undefined;
      let orchestratorRan = false;

      const user = await usersRepo.findById(userId);
      if (!user) {
        log.warn({ userId }, 'User not found, skipping job');
        wasSkipped = true;
        skipReason = 'user_not_found';
        await logExecution();
        return;
      }
      if (user.paused) {
        log.info({ userId, kind }, 'User paused, skipping job');
        wasSkipped = true;
        skipReason = 'user_paused';
        await logExecution();
        return;
      }

      const asleepCheck = shouldSkipBecauseAsleep(kind, user);
      if (asleepCheck.skip) {
        log.info({ userId, kind, reason: asleepCheck.reason }, 'Skipping job: user is asleep');
        wasSkipped = true;
        skipReason = 'user_asleep';
        await logExecution();
        return;
      }

      const skipId = job.data.schedulerId;

      // For follow-up checks, the original schedulerId is stored in metadata
      // so that subsequent follow-ups are tracked against the same event.
      const originalSchedulerId = (typeof job.data.metadata?.originalSchedulerId === 'string')
        ? job.data.metadata.originalSchedulerId
        : skipId;

      if (skipId && await jobSkipOnceRepo.shouldSkip(skipId)) {
        await jobSkipOnceRepo.clear(skipId);
        log.info({ userId, kind, schedulerId: skipId }, 'Job skipped once by user request');
        wasSkipped = true;
        skipReason = 'skip_once';
        await logExecution();
        return;
      }

      if (skipId) {
        const exists = await repeatingJobsRepo.findBySchedulerId(skipId);
        if (!exists) {
          log.warn({ userId, kind, schedulerId: skipId }, 'Skipping scheduler job missing in DB source-of-truth');
          wasSkipped = true;
          skipReason = 'missing_in_db';
          await logExecution();
          return;
        }
      }

      // Skip followup_check if user already replied after this job was scheduled
      if (kind === 'followup_check' && job.timestamp) {
        const lastReply = await messagesRepo.getLastUserReplyTime(userId);
        if (lastReply && lastReply.getTime() > job.timestamp) {
          log.info({ userId, jobId: job.id }, 'User already replied — skipping followup');
          wasSkipped = true;
          skipReason = 'user_replied';
          await logExecution();
          return;
        }
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
        wasSkipped = true;
        skipReason = 'attempt_limit_reached';
        await logExecution();
        return;
      }

      let proactiveContext = context;

      // Resolve effective kind: if this is a rescheduled job, use the original kind for enrichment
      const effectiveKind = (typeof job.data.metadata?.originalKind === 'string')
        ? job.data.metadata.originalKind as string
        : kind;

      // For lesson_session: enrich context with plan details if available
      if (effectiveKind === 'lesson_session' && context) {
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

      if (effectiveKind === 'evening_reflection') {
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

      if (effectiveKind === 'daily_planning') {
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

      if (effectiveKind === 'weekly_digest') {
        try {
          const msgStats = await messagesRepo.getWeeklyStats(userId);
          const eduStats = await lessonPlansRepo.getWeeklyStats(userId);
          proactiveContext = `${context}. Статистика за неделю: сообщений от пользователя: ${msgStats.totalMessages}, учебных планов создано: ${eduStats.totalPlans}, уроков завершено: ${eduStats.completedPlans}.`;
        } catch (err) {
          log.error({ err, userId }, 'Failed to fetch weekly stats for digest');
        }
      }

      // Anti-spam: skip follow-up if bot already sent a message very recently
      if (kind === 'followup_check') {
        const lastBotMsg = await messagesRepo.getLastBotMessageTime(userId);
        if (lastBotMsg && Date.now() - lastBotMsg.getTime() < 120_000) {
          log.info({ userId, jobId: job.id }, 'Skipping follow-up: bot sent message < 2 min ago');
          wasSkipped = true;
          skipReason = 'anti_spam';
          await logExecution();
          return;
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
        mode: 'proactive',
        proactiveKind: kind,
        proactiveSchedulerId: originalSchedulerId,
        proactiveContext: proactiveContext,
        proactiveAttempt: attemptNumber ?? 1,
      });
      orchestratorRan = true;

      await logExecution();

      // Follow-up chain is driven ONLY by the model via followup_ask tool.
      // Do NOT auto-schedule here — that creates duplicate jobs when the model
      // also calls followup_ask, causing exponential message duplication.
      // The model already has instructions in the system prompt to call
      // followup_ask after proactive messages when appropriate.

      async function logExecution(): Promise<void> {
        try {
          let userRepliedWithin30Min: boolean | undefined;
          if (kind === 'followup_check' && job.timestamp) {
            const lastReply = await messagesRepo.getLastUserReplyTime(userId);
            userRepliedWithin30Min = lastReply
              ? (lastReply.getTime() - job.timestamp < 30 * 60 * 1000)
              : false;
          }
          await jobExecutionsRepo.create({
            userId,
            schedulerId: skipId,
            kind,
            attemptNumber,
            wasSkipped,
            skipReason,
            userRepliedWithin30Min,
          });
        } catch (err) {
          log.error({ err, userId, jobId: job.id }, 'Failed to log job execution');
        }
      }
    },
    {
      connection: workerRedisConnection,
      concurrency: 1,
      lockDuration: 120_000,
      lockRenewTime: 30_000,
      drainDelay: 30_000,
      stalledInterval: 60_000,
      maxStalledCount: 2,
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
