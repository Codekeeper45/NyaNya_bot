import { tool } from 'ai';
import { z } from 'zod';
import { scheduleJob, scheduleRepeatingJob, cancelJob, cancelRepeatingJob, listRepeatingJobs, type JobPayload } from '../../scheduler/jobs.js';
import { opekuQueue } from '../../scheduler/queue.js';
import { createChildLogger } from '../../lib/logger.js';
import { setupUserSchedules } from '../../scheduler/proactive.js';
import { usersRepo } from '../../db/repos/users.js';
import type { NewUser } from '../../db/schema.js';
import { jobsRepo } from '../../db/repos/jobs.js';
import { repeatingJobsRepo } from '../../db/repos/repeating_jobs.js';
import { jobSkipOnceRepo } from '../../db/repos/job_skip_once.js';
import { jobExecutionsRepo } from '../../db/repos/job_executions.js';
import { fromZonedTime } from 'date-fns-tz';
import CronParser from 'cron-parser';

function computeDelayToTarget(targetTime: string, targetDate: string | undefined, tz: string): number {
  const now = Date.now();
  const todayInTz = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(now);
  const dateStr = targetDate ?? todayInTz;
  const targetDateStr = `${dateStr}T${targetTime}:00`;
  const targetUtc = fromZonedTime(targetDateStr, tz);
  return targetUtc.getTime() - now;
}

// Routine types that map to scheduler ID prefixes
const ROUTINE_KINDS = {
  morning:    { kind: 'morning_greeting', context: 'Утреннее приветствие' },
  breakfast:  { kind: 'meal_reminder',   context: 'завтрак' },
  lunch:      { kind: 'meal_reminder',   context: 'обед' },
  dinner:     { kind: 'meal_reminder',   context: 'ужин' },
  reflection: { kind: 'evening_reflection', context: 'Вечерняя рефлексия' },
  planning:   { kind: 'daily_planning',  context: 'Дневное планирование' },
} as const;

type RoutineName = keyof typeof ROUTINE_KINDS;

// Cancel all scheduler IDs for this user+routine (handles per-day splits)
async function cancelRoutineJobs(userId: number, routine: RoutineName): Promise<void> {
  const prefix = `user-${userId}-${routine}`;
  const all = await repeatingJobsRepo.findByUser(userId);
  const toCancel = all.filter(j => j.schedulerId.startsWith(prefix));
  for (const j of toCancel) await cancelRepeatingJob(j.schedulerId);
}

// Parse cron "m h * * days" → { time: "HH:MM", days: number[] }
function parseCron(cron: string): { time: string; days: number[] } {
  const [m, h, , , daysPart] = cron.split(' ');
  const hh = h.padStart(2, '0');
  const mm = m.padStart(2, '0');
  const days = daysPart === '*'
    ? [0, 1, 2, 3, 4, 5, 6]
    : daysPart.split(',').map(Number);
  return { time: `${hh}:${mm}`, days };
}

// Read current per-day times for a routine → Map<day, time>
async function readRoutineDayMap(userId: number, routine: RoutineName): Promise<Map<number, string>> {
  const prefix = `user-${userId}-${routine}`;
  const all = await repeatingJobsRepo.findByUser(userId);
  const jobs = all.filter(j => j.schedulerId.startsWith(prefix));
  const map = new Map<number, string>();
  for (const job of jobs) {
    const { time, days } = parseCron(job.cronPattern);
    for (const d of days) map.set(d, time);
  }
  return map;
}

// Convert day→time map into minimal slots array (group days with same time)
function dayMapToSlots(map: Map<number, string>): { days: number[]; time: string }[] {
  const byTime = new Map<string, number[]>();
  for (const [day, time] of map) {
    if (!byTime.has(time)) byTime.set(time, []);
    byTime.get(time)!.push(day);
  }
  return Array.from(byTime.entries()).map(([time, days]) => ({ time, days: days.sort() }));
}

const log = createChildLogger('tool:schedule');

export function scheduleTools(
  userId: number,
  telegramUserId: number,
  chatId: number,
  userTimezone: string,
  setOnboardingDone?: () => void,
  proactiveKind?: string,
  proactiveSchedulerId?: string,
) {
  return {
    schedule_reminder: tool({
      description: 'Запланировать одноразовое напоминание. WHEN: пользователь просит "напомни через 5 минут", "напомни в 15:00", "напомни завтра в 9:00". Два режима: delayMinutes (относительный) или atTime[+atDate] (абсолютный). CHAIN: прямой запрос → этот инструмент → message_send_text. RETURNS: { scheduled: true, inMinutes, jobId }. NEVER: не используй для follow-up после проактивных сообщений — используй followup_ask.',
      inputSchema: z.object({
        message: z.string().describe('О чём напомнить'),
        delayMinutes: z.number().optional().describe('Через сколько минут напомнить (относительный режим)'),
        atTime: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Точное время HH:MM в часовом поясе пользователя (абсолютный режим)'),
        atDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Дата YYYY-MM-DD (по умолчанию сегодня). Используй с atTime для "напомни завтра/послезавтра"'),
      }),
      execute: async ({ message, delayMinutes, atTime, atDate }) => {
        let delayMs: number;

        if (atTime) {
          delayMs = computeDelayToTarget(atTime, atDate, userTimezone);
          if (delayMs <= 0) {
            return { scheduled: false, error: 'Указанное время уже прошло' };
          }
          if (delayMs > 365 * 24 * 60 * 60 * 1000) {
            return { scheduled: false, error: 'Нельзя запланировать больше чем на год вперёд' };
          }
        } else if (delayMinutes !== undefined) {
          delayMs = delayMinutes * 60 * 1000;
        } else {
          return { scheduled: false, error: 'Укажи delayMinutes или atTime' };
        }

        const payload: JobPayload = {
          userId,
          telegramUserId,
          telegramChatId: chatId,
          kind: 'custom_reminder',
          context: message,
        };
        const jobId = await scheduleJob(payload, delayMs);
        const inMinutes = Math.round(delayMs / 60000);
        log.info({ userId, message, delayMs, atTime, atDate, jobId }, 'Reminder scheduled');
        return { scheduled: true, inMinutes, jobId, ...(atTime ? { atTime, atDate: atDate ?? 'today' } : {}) };
      },
    }),

    schedule_cancel: tool({
      description: 'Отменить одноразовую задачу по ID. WHEN: нужно отменить конкретное напоминание из oneTimeJobs. CHAIN: schedule_list (найди jobId) → schedule_cancel → schedule_list (проверь). RETURNS: { cancelled: true }.',
      inputSchema: z.object({
        jobId: z.string().describe('ID задачи для отмены'),
      }),
      execute: async ({ jobId }) => {
        const owned = await jobsRepo.belongsToUser(jobId, userId);
        if (!owned) {
          return { cancelled: false, error: 'Job not found or does not belong to you' };
        }
        await cancelJob(jobId);
        await jobsRepo.updateStatus(jobId, 'cancelled');
        log.info({ userId, jobId }, 'One-time job cancelled');
        return { cancelled: true };
      },
    }),

    schedule_repeating: tool({
      description: 'Создать повторяющееся напоминание (cron). WHEN: пользователь хочет напоминание каждый день/неделю ("напоминай пить воду каждый день в 10:00"). CHAIN: прямой запрос → этот инструмент → message_send_text. RETURNS: { scheduled: true, schedulerId, cron }. Примеры cron: "0 9 * * *" = каждый день 9:00; "30 8 * * 1" = пн 8:30.',
      inputSchema: z.object({
        schedulerId: z.string().describe('Уникальный ID напоминания (латиница, без пробелов, например: sport-monday, water-daily)'),
        message: z.string().describe('О чём напоминать'),
        cron: z.string().describe('Cron-паттерн расписания'),
      }),
      execute: async ({ schedulerId, message, cron }) => {
        const fullId = schedulerId.startsWith(`user-${userId}-`)
          ? schedulerId
          : `user-${userId}-${schedulerId}`;
        const payload: JobPayload = {
          userId,
          telegramUserId,
          telegramChatId: chatId,
          kind: 'custom_reminder',
          context: message,
        };
        await scheduleRepeatingJob(fullId, payload, cron, userTimezone);
        log.info({ userId, schedulerId: fullId, cron, message }, 'Repeating reminder set');
        return { scheduled: true, schedulerId: fullId, cron };
      },
    }),

    schedule_repeating_update: tool({
      description: 'Изменить cron или текст повторяющегося напоминания. WHEN: пользователь просит "измени текст напоминания" или "перенеси на другое время навсегда". CHAIN: schedule_list (найди schedulerId) → этот инструмент → schedule_list (проверь). RETURNS: { updated: true, schedulerId, cron }. Используй вместо cancel+create.',
      inputSchema: z.object({
        schedulerId: z.string().describe('Полный ID задания (user-N-...) — из schedule_list'),
        cron: z.string().optional().describe('Новый cron-паттерн (если меняется время)'),
        message: z.string().optional().describe('Новый текст напоминания (если меняется текст)'),
      }),
      execute: async ({ schedulerId, cron, message }) => {
        if (!schedulerId.startsWith(`user-${userId}-`)) {
          return { error: 'Unauthorized: cannot update another user\'s reminder' };
        }
        const all = await repeatingJobsRepo.findByUser(userId);
        const existing = all.find(j => j.schedulerId === schedulerId);
        if (!existing) {
          return { error: 'Job not found' };
        }
        const newCron = cron ?? existing.cronPattern;
        const newPayload = {
          ...(existing.payload as Record<string, unknown>),
          ...(message ? { context: message } : {}),
        };
        // DB-first update to avoid orphaned Redis state if DB fails
        try {
          await repeatingJobsRepo.upsert({
            userId,
            schedulerId,
            kind: existing.kind,
            payload: newPayload,
            cronPattern: newCron,
            timezone: userTimezone,
          });
          await opekuQueue.upsertJobScheduler(
            schedulerId,
            { pattern: newCron, tz: userTimezone },
            { name: existing.kind, data: newPayload },
          );
        } catch (err) {
          log.error({ err, userId, schedulerId }, 'Failed to update repeating reminder');
          return { error: 'Failed to update reminder' };
        }
        log.info({ userId, schedulerId, newCron }, 'Repeating reminder updated');
        return { updated: true, schedulerId, cron: newCron };
      },
    }),

    schedule_repeating_cancel: tool({
      description: 'Отменить повторяющееся напоминание навсегда. WHEN: пользователь говорит "больше не напоминай про ужин". CHAIN: schedule_list (найди schedulerId) → этот инструмент → schedule_list (проверь). RETURNS: { cancelled: true, schedulerId }.',
      inputSchema: z.object({
        schedulerId: z.string().describe('ID повторяющегося напоминания (полный, с префиксом user-N-)'),
      }),
      execute: async ({ schedulerId }) => {
        if (!schedulerId.startsWith(`user-${userId}-`)) {
          return { error: 'Unauthorized: cannot cancel another user\'s reminder' };
        }
        await cancelRepeatingJob(schedulerId);
        log.info({ userId, schedulerId }, 'Repeating reminder cancelled');
        return { cancelled: true, schedulerId };
      },
    }),

    schedule_skip_once: tool({
      description: 'Пропустить ОДИН следующий запуск повторяющегося напоминания. WHEN: "пропусти сегодня обед", "не напоминай в этот раз". CHAIN: schedule_list (найди schedulerId) → этот инструмент → schedule_list (проверь). RETURNS: { skipped: true, schedulerId }. NEVER: расписание НЕ меняется, завтра как обычно.',
      inputSchema: z.object({
        schedulerId: z.string().describe('ID джоба из schedule_list'),
      }),
      execute: async ({ schedulerId }) => {
        if (!schedulerId.startsWith(`user-${userId}-`)) {
          return { error: 'Unauthorized' };
        }
        const jobs = await repeatingJobsRepo.findByUser(userId);
        const job = jobs.find(j => j.schedulerId === schedulerId);
        if (!job) return { error: 'Напоминание не найдено' };
        await jobSkipOnceRepo.set(schedulerId);
        log.info({ userId, schedulerId }, 'Skip once set');
        return { skipped: true, schedulerId };
      },
    }),

    schedule_postpone_today: tool({
      description: 'Отложить сегодняшний запуск на другое время. WHEN: "перенеси сегодня на 15:00", "сегодня напомни вечером". CHAIN: schedule_list (найди schedulerId) → этот инструмент → schedule_list (проверь). RETURNS: { postponed: true, schedulerId, newTime, oneTimeJobId }. NEVER: не используй для переноса на другой день — используй schedule_reschedule.',
      inputSchema: z.object({
        schedulerId: z.string().describe('ID джоба из schedule_list'),
        newTime: z.string().regex(/^\d{2}:\d{2}$/).describe('Новое время HH:MM для сегодняшнего запуска'),
      }),
      execute: async ({ schedulerId, newTime }) => {
        if (!schedulerId.startsWith(`user-${userId}-`)) {
          return { error: 'Unauthorized' };
        }
        const jobs = await repeatingJobsRepo.findByUser(userId);
        const job = jobs.find(j => j.schedulerId === schedulerId);
        if (!job) return { error: 'Напоминание не найдено' };

        const delayMs = computeDelayToTarget(newTime, undefined, userTimezone);

        if (delayMs <= 0 || delayMs > 24 * 60 * 60 * 1000) {
          return { error: 'Нельзя отложить на прошедшее время или больше чем на 24 часа' };
        }

        await jobSkipOnceRepo.set(schedulerId);

        const originalPayload = job.payload as Partial<JobPayload> | undefined;
        const payload: JobPayload = {
          userId,
          telegramUserId,
          telegramChatId: chatId,
          kind: originalPayload?.kind ?? 'custom_reminder',
          context: `Отложенное напоминание (было ${job.kind}): ${originalPayload?.context ?? 'напоминание'}`,
          metadata: { originalKind: job.kind, originalSchedulerId: schedulerId },
        };
        const oneTimeJobId = await scheduleJob(payload, delayMs);

        log.info({ userId, schedulerId, newTime, delayMs, oneTimeJobId }, 'Postpone: skipped original, created one-time reminder');
        return { postponed: true, schedulerId, newTime, oneTimeJobId };
      },
    }),

    schedule_reschedule: tool({
      description: 'Перенести ближайший запуск на другую дату/время. WHEN: "перенеси ужин на завтра в 19:00", "отложи обед на послезавтра". CHAIN: schedule_list (найди schedulerId) → этот инструмент → schedule_list (проверь). RETURNS: { rescheduled: true, schedulerId, targetDate, targetTime, oneTimeJobId }. NEVER: для переноса только сегодня используй schedule_postpone_today.',
      inputSchema: z.object({
        schedulerId: z.string().describe('ID джоба из schedule_list'),
        targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Дата переноса YYYY-MM-DD (завтра, послезавтра и т.д.)'),
        targetTime: z.string().regex(/^\d{2}:\d{2}$/).describe('Время на новую дату HH:MM'),
      }),
      execute: async ({ schedulerId, targetDate, targetTime }) => {
        if (!schedulerId.startsWith(`user-${userId}-`)) {
          return { error: 'Unauthorized' };
        }
        const repeatJobs = await repeatingJobsRepo.findByUser(userId);
        const job = repeatJobs.find(j => j.schedulerId === schedulerId);
        if (!job) return { error: 'Напоминание не найдено' };

        const delayMs = computeDelayToTarget(targetTime, targetDate, userTimezone);
        if (delayMs <= 0) {
          return { error: 'Указанное время уже прошло' };
        }
        if (delayMs > 365 * 24 * 60 * 60 * 1000) {
          return { error: 'Нельзя перенести больше чем на год вперёд' };
        }

        await jobSkipOnceRepo.set(schedulerId);

        const originalPayload = job.payload as Partial<JobPayload> | undefined;
        const payload: JobPayload = {
          userId,
          telegramUserId,
          telegramChatId: chatId,
          kind: originalPayload?.kind ?? 'custom_reminder',
          context: originalPayload?.context ?? 'напоминание',
          metadata: { originalKind: job.kind, originalSchedulerId: schedulerId, rescheduledFrom: new Date().toISOString() },
        };
        const oneTimeJobId = await scheduleJob(payload, delayMs);

        log.info({ userId, schedulerId, targetDate, targetTime, delayMs, oneTimeJobId }, 'Reschedule: skipped original, created one-time at new date');
        return { rescheduled: true, schedulerId, targetDate, targetTime, oneTimeJobId, inMinutes: Math.round(delayMs / 60000) };
      },
    }),

    schedule_list: tool({
      description: 'Показать все активные напоминания. WHEN: перед ЛЮБЫМ изменением/отменой расписания. CHAIN: ВСЕГДА первый шаг перед skip/postpone/reschedule/cancel/update. RETURNS: { repeating: [...], oneTime: [...], totalRepeating, totalOneTime }.',
      inputSchema: z.object({}),
      execute: async () => {
        const repeating = await listRepeatingJobs(userId);
        const skipFlags = await Promise.all(repeating.map(j => jobSkipOnceRepo.shouldSkip(j.schedulerId as string)));

        const pendingJobs = await jobsRepo.findPendingByUser(userId);
        const oneTimeJobs = pendingJobs.map(j => {
          const payload = j.payload as Partial<JobPayload> | undefined;
          return {
            jobId: j.bullJobId ?? `db-${j.id}`,
            kind: j.kind,
            message: payload?.context ?? j.kind,
            scheduledAt: j.scheduledAt?.toISOString(),
          };
        });

        return {
          repeating: repeating.map((j, i) => ({ ...j, skipNext: skipFlags[i] })),
          oneTime: oneTimeJobs,
          totalRepeating: repeating.length,
          totalOneTime: oneTimeJobs.length,
        };
      },
    }),

    schedule_upcoming: tool({
      description: 'Показать запланированные напоминания на ближайшие N дней. WHEN: пользователь спрашивает "что на завтра", "что на этой неделе", "покажи расписание". CHAIN: прямой запрос → этот инструмент → message_send_text. RETURNS: { events: [{ date, time, label, source }], total, daysAhead }.',
      inputSchema: z.object({
        days: z.number().min(1).max(30).default(7).describe('На сколько дней вперёд смотреть (1 = только завтра, 7 = неделя)'),
      }),
      execute: async ({ days }) => {
        const now = new Date();
        const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        const tz = userTimezone;

        const events: { date: string; time: string; label: string; schedulerId?: string; source: string; _ts: number }[] = [];

        const repeatJobs = await listRepeatingJobs(userId);
        for (const job of repeatJobs) {
          try {
            const interval = CronParser.parseExpression(job.cron, { currentDate: now, endDate: until, tz, iterator: true });
            while (true) {
              try {
                const { value } = interval.next() as { value: { toDate(): Date }; done: boolean };
                const d = value.toDate();
                events.push({
                  date: d.toLocaleDateString('ru-RU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }),
                  time: d.toLocaleTimeString('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }),
                  label: job.name,
                  schedulerId: job.schedulerId,
                  source: 'repeating',
                  _ts: d.getTime(),
                });
              } catch { break; }
            }
          } catch { /* skip invalid cron */ }
        }

        const pendingJobs = await jobsRepo.findPendingByUser(userId);
        for (const j of pendingJobs) {
          if (!j.scheduledAt) continue;
          const d = new Date(j.scheduledAt);
          if (d < now || d > until) continue;
          const payload = j.payload as Partial<JobPayload> | undefined;
          events.push({
            date: d.toLocaleDateString('ru-RU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }),
            time: d.toLocaleTimeString('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }),
            label: payload?.context ?? j.kind,
            source: 'onetime',
            _ts: d.getTime(),
          });
        }

        events.sort((a, b) => a._ts - b._ts);
        return { events: events.map(({ _ts: _, ...e }) => e), total: events.length, daysAhead: days };
      },
    }),

    schedule_update_routine: tool({
      description: 'Изменить рутину (завтрак/обед/ужин/утро/рефлексия) ЦЕЛИКОМ. WHEN: "перенеси обед на 13:00 навсегда", первичная настройка. CHAIN: прямой запрос → этот инструмент → message_send_text. RETURNS: { updated: true, routine, created }. Поддерживает разное время для разных дней через slots.',
      inputSchema: z.object({
        routine: z.enum(['morning', 'breakfast', 'lunch', 'dinner', 'reflection', 'planning'])
          .describe('Какую рутину обновить'),
        slots: z.array(z.object({
          days: z.array(z.number().min(0).max(6))
            .describe('Дни недели (0=вс..6=сб). Пустой массив = каждый день'),
          time: z.string().regex(/^\d{2}:\d{2}$/).describe('Время HH:MM'),
        })).min(1).describe('Один или несколько временных слотов'),
      }),
      execute: async ({ routine, slots }) => {
        const { kind, context } = ROUTINE_KINDS[routine];
        const base: Omit<JobPayload, 'kind' | 'context'> = {
          userId, telegramUserId, telegramChatId: chatId,
        };

        // Cancel all existing jobs for this routine
        await cancelRoutineJobs(userId, routine);

        // Create new jobs per slot
        const created: string[] = [];
        for (let i = 0; i < slots.length; i++) {
          const { days, time } = slots[i];
          const [h, m] = time.split(':').map(Number);
          const daysPart = days.length === 0 ? '*' : days.join(',');
          const cron = `${m} ${h} * * ${daysPart}`;
          const schedulerId = slots.length === 1
            ? `user-${userId}-${routine}`
            : `user-${userId}-${routine}-${i}`;

          await scheduleRepeatingJob(
            schedulerId,
            { ...base, kind, context },
            cron,
            userTimezone,
          );
          created.push(`${schedulerId} (${cron})`);
        }

        // Update profile fields for meals
        const profileUpdate: Partial<Pick<NewUser, 'breakfastTime' | 'lunchTime' | 'dinnerTime' | 'wakeTime'>> = {};
        if (routine === 'breakfast' && slots[0]) profileUpdate.breakfastTime = slots[0].time;
        if (routine === 'lunch' && slots[0]) profileUpdate.lunchTime = slots[0].time;
        if (routine === 'dinner' && slots[0]) profileUpdate.dinnerTime = slots[0].time;
        if (routine === 'morning' && slots[0]) profileUpdate.wakeTime = slots[0].time;
        if (Object.keys(profileUpdate).length > 0) {
          await usersRepo.update(userId, profileUpdate);
        }

        log.info({ userId, routine, slots: created }, 'Routine updated');
        return { updated: true, routine, created };
      },
    }),

    setup_daily_schedule: tool({
      description: 'Настроить ежедневное расписание. WHEN: в конце онбординга, когда собраны все данные. CHAIN: profile_update(имя, город) → ... → этот инструмент → message_send_text. RETURNS: { done: true, jobs }. Безопасно вызывать повторно — перезапишет старое.',
      inputSchema: z.object({
        wakeTime: z.string().describe('Время подъёма в будни HH:MM'),
        sleepTime: z.string().describe('Время сна в будни HH:MM'),
        breakfastTime: z.string().describe('Время завтрака HH:MM'),
        lunchTime: z.string().describe('Время обеда HH:MM'),
        dinnerTime: z.string().describe('Время ужина HH:MM'),
        weekendWakeTime: z.string().optional().describe('Время подъёма в выходные HH:MM (если отличается)'),
        weekendSleepTime: z.string().optional().describe('Время сна в выходные HH:MM (если отличается)'),
      }),
      execute: async ({ wakeTime, sleepTime, breakfastTime, lunchTime, dinnerTime, weekendWakeTime, weekendSleepTime }) => {
        // Cancel existing routine jobs to avoid duplicates on re-run
        const routines: RoutineName[] = ['morning', 'breakfast', 'lunch', 'dinner', 'reflection', 'planning'];
        for (const r of routines) await cancelRoutineJobs(userId, r);

        await setupUserSchedules(
          { id: userId, telegramUserId, timezone: userTimezone, wakeTime, sleepTime, weekendWakeTime, weekendSleepTime },
          chatId,
          { breakfastTime, lunchTime, dinnerTime },
        );
        await usersRepo.update(userId, {
          wakeTime,
          sleepTime,
          weekendWakeTime: weekendWakeTime ?? null,
          weekendSleepTime: weekendSleepTime ?? null,
          breakfastTime,
          lunchTime,
          dinnerTime,
          onboardingComplete: true,
        });
        setOnboardingDone?.();
        log.info({ userId, weekendWakeTime }, 'Daily schedule configured via onboarding');
        return { done: true, jobs: ['morning', 'breakfast', 'lunch', 'dinner', 'reflection'] };
      },
    }),

    schedule_patch_routine: tool({
      description: 'Изменить рутину для КОНКРЕТНЫХ дней. WHEN: "перенеси обед только в среду на 13:30", "завтрак в выходные на 10:00". CHAIN: прямой запрос → этот инструмент → message_send_text. RETURNS: { patched: true, routine, days, time, result }. Остальные дни не трогаются.',
      inputSchema: z.object({
        routine: z.enum(['morning', 'breakfast', 'lunch', 'dinner', 'reflection', 'planning'])
          .describe('Какую рутину изменить'),
        days: z.array(z.number().min(0).max(6)).min(1)
          .describe('Дни недели для изменения (0=вс..6=сб)'),
        time: z.string().regex(/^\d{2}:\d{2}$/)
          .describe('Новое время HH:MM для указанных дней'),
      }),
      execute: async ({ routine, days, time }) => {
        const { kind, context } = ROUTINE_KINDS[routine];
        const base: Omit<JobPayload, 'kind' | 'context'> = {
          userId, telegramUserId, telegramChatId: chatId,
        };

        // Read current day→time map
        const dayMap = await readRoutineDayMap(userId, routine);

        for (const d of days) dayMap.set(d, time);

        // Rebuild slots from merged map
        const slots = dayMapToSlots(dayMap);

        // Cancel old jobs and recreate
        await cancelRoutineJobs(userId, routine);
        const created: string[] = [];
        for (let i = 0; i < slots.length; i++) {
          const { days: slotDays, time: slotTime } = slots[i];
          const [h, m] = slotTime.split(':').map(Number);
          const daysPart = slotDays.length === 7 ? '*' : slotDays.join(',');
          const cron = `${m} ${h} * * ${daysPart}`;
          const schedulerId = slots.length === 1
            ? `user-${userId}-${routine}`
            : `user-${userId}-${routine}-${i}`;
          await scheduleRepeatingJob(schedulerId, { ...base, kind, context }, cron, userTimezone);
          created.push(`${schedulerId} (${cron})`);
        }

        log.info({ userId, routine, days, time, slots: created }, 'Routine patched');
        return { patched: true, routine, days, time, result: created };
      },
    }),

    followup_ask: tool({
      description: 'Запланировать проактивный follow-up. WHEN: ТОЛЬКО после проактивных сообщений от расписания (morning_greeting, meal_reminder). CHAIN: проактивное сообщение → этот инструмент. RETURNS: { scheduled: true, inMinutes, attemptNumber, jobId } или { scheduled: false, reason: "limit_reached" }. NEVER: не используй, когда пользователь просит "напомни через час" — используй schedule_reminder. attemptNumber вычисляется автоматически.',
      inputSchema: z.object({
        delayMinutes: z.number().min(1).max(120).describe('Через сколько минут переспросить'),
        context: z.string().describe('О чём переспросить (контекст для проактивного сообщения)'),
      }),
      execute: async ({ delayMinutes, context }) => {
        const recentCount = await jobExecutionsRepo.countFollowupsSinceLastProactive(userId, proactiveSchedulerId);
        const autoAttempt = recentCount + 1;

        if (autoAttempt > 3) {
          log.info({ userId, recentCount, proactiveSchedulerId }, 'Follow-up limit reached (code-enforced)');
          return { scheduled: false, reason: 'limit_reached', recentFollowups: recentCount };
        }

        const payload: JobPayload = {
          userId,
          telegramUserId,
          telegramChatId: chatId,
          kind: 'followup_check',
          context,
          attemptNumber: autoAttempt,
          metadata: {
            ...(proactiveKind ? { followupForKind: proactiveKind } : {}),
            ...(proactiveSchedulerId ? { originalSchedulerId: proactiveSchedulerId } : {}),
          },
        };
        const jobId = await scheduleJob(payload, delayMinutes * 60_000);
        log.info({ userId, delayMinutes, context, attemptNumber: autoAttempt, jobId }, 'Follow-up scheduled');
        return { scheduled: true, inMinutes: delayMinutes, attemptNumber: autoAttempt, jobId };
      },
    }),
  };
}
