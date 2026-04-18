import { tool } from 'ai';
import { z } from 'zod';
import { scheduleJob, scheduleRepeatingJob, cancelJob, cancelRepeatingJob, listRepeatingJobs, type JobPayload } from '../../scheduler/jobs.js';
import { createChildLogger } from '../../lib/logger.js';
import { setupUserSchedules } from '../../scheduler/proactive.js';
import { usersRepo } from '../../db/repos/users.js';
import { jobsRepo } from '../../db/repos/jobs.js';
import { repeatingJobsRepo } from '../../db/repos/repeating_jobs.js';

// Routine types that map to scheduler ID prefixes
const ROUTINE_KINDS = {
  morning:    { kind: 'morning_greeting', context: 'Утреннее приветствие' },
  breakfast:  { kind: 'meal_reminder',   context: 'завтрак' },
  lunch:      { kind: 'meal_reminder',   context: 'обед' },
  dinner:     { kind: 'meal_reminder',   context: 'ужин' },
  reflection: { kind: 'evening_reflection', context: 'Вечерняя рефлексия' },
} as const;

type RoutineName = keyof typeof ROUTINE_KINDS;

// Cancel all scheduler IDs for this user+routine (handles per-day splits)
async function cancelRoutineJobs(userId: number, routine: RoutineName): Promise<void> {
  const prefix = `user-${userId}-${routine}`;
  const all = await repeatingJobsRepo.findByUser(userId);
  const toCancel = all.filter(j => j.schedulerId.startsWith(prefix));
  await Promise.all(toCancel.map(j => cancelRepeatingJob(j.schedulerId)));
}

const log = createChildLogger('tool:schedule');

export function scheduleTools(
  userId: number,
  telegramUserId: number,
  chatId: number,
  userTimezone: string,
  setOnboardingDone?: () => void,
) {
  return {
    schedule_reminder: tool({
      description: 'Запланировать одноразовое напоминание пользователю через указанное количество минут.',
      inputSchema: z.object({
        message: z.string().describe('О чём напомнить'),
        delayMinutes: z.number().describe('Через сколько минут напомнить'),
      }),
      execute: async ({ message, delayMinutes }) => {
        const payload: JobPayload = {
          userId,
          telegramUserId,
          telegramChatId: chatId,
          kind: 'custom_reminder',
          context: message,
        };
        const jobId = await scheduleJob(payload, delayMinutes * 60 * 1000);
        log.info({ userId, message, delayMinutes, jobId }, 'Reminder scheduled');
        return { scheduled: true, inMinutes: delayMinutes, jobId };
      },
    }),

    schedule_cancel: tool({
      description: 'Отменить ранее запланированную одноразовую задачу по ID.',
      inputSchema: z.object({
        jobId: z.string().describe('ID задачи для отмены'),
      }),
      execute: async ({ jobId }) => {
        const owned = await jobsRepo.belongsToUser(jobId, userId);
        if (!owned) {
          return { cancelled: false, error: 'Job not found or does not belong to you' };
        }
        await cancelJob(jobId);
        return { cancelled: true };
      },
    }),

    schedule_repeating: tool({
      description: `Создать повторяющееся напоминание по расписанию (cron). Используй когда пользователь хочет напоминание каждый день/неделю/месяц.
Cron формат: "минуты часы день_месяца месяц день_недели"
Примеры:
- Каждый день в 9:00 → "0 9 * * *"
- Каждый понедельник в 8:30 → "30 8 * * 1"
- Каждую пятницу в 18:00 → "0 18 * * 5"
- Каждые 2 часа → "0 */2 * * *"
- Дни недели: 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб`,
      inputSchema: z.object({
        schedulerId: z.string().describe('Уникальный ID напоминания (латиница, без пробелов, например: sport-monday, water-daily)'),
        message: z.string().describe('О чём напоминать'),
        cron: z.string().describe('Cron-паттерн расписания'),
      }),
      execute: async ({ schedulerId, message, cron }) => {
        const fullId = `user-${userId}-${schedulerId}`;
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

    schedule_repeating_cancel: tool({
      description: 'Отменить повторяющееся напоминание по его schedulerId.',
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

    schedule_list: tool({
      description: 'Показать список всех активных повторяющихся напоминаний пользователя.',
      inputSchema: z.object({}),
      execute: async () => {
        const jobs = await listRepeatingJobs(userId);
        if (jobs.length === 0) return { reminders: [], message: 'Нет активных повторяющихся напоминаний.' };
        return { reminders: jobs };
      },
    }),

    schedule_update_routine: tool({
      description: `Изменить расписание конкретной рутины (подъём, завтрак, обед, ужин, вечерняя рефлексия).
Поддерживает разное время для разных дней недели — передай несколько слотов.
Примеры:
- Обед каждый день в 13:00 → slots: [{ days: [], time: "13:00" }]
- Обед в будни в 12:30, в выходные в 14:00 → slots: [{ days: [1,2,3,4,5], time: "12:30" }, { days: [6,0], time: "14:00" }]
- Завтрак только по будням → slots: [{ days: [1,2,3,4,5], time: "08:00" }]
Дни: 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб`,
      inputSchema: z.object({
        routine: z.enum(['morning', 'breakfast', 'lunch', 'dinner', 'reflection'])
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
        const profileUpdate: Record<string, string> = {};
        if (routine === 'breakfast' && slots[0]) profileUpdate.breakfastTime = slots[0].time;
        if (routine === 'lunch' && slots[0]) profileUpdate.lunchTime = slots[0].time;
        if (routine === 'dinner' && slots[0]) profileUpdate.dinnerTime = slots[0].time;
        if (routine === 'morning' && slots[0]) profileUpdate.wakeTime = slots[0].time;
        if (Object.keys(profileUpdate).length > 0) {
          await usersRepo.update(userId, profileUpdate as any);
        }

        log.info({ userId, routine, slots: created }, 'Routine updated');
        return { updated: true, routine, created };
      },
    }),

    setup_daily_schedule: tool({
      description: 'Настроить ежедневное расписание пользователя. Вызывай в конце онбординга, когда собрал все данные. Безопасно вызывать повторно — перезапишет старое расписание.',
      inputSchema: z.object({
        wakeTime: z.string().describe('Время подъёма HH:MM'),
        sleepTime: z.string().describe('Время сна HH:MM'),
        breakfastTime: z.string().describe('Время завтрака HH:MM'),
        lunchTime: z.string().describe('Время обеда HH:MM'),
        dinnerTime: z.string().describe('Время ужина HH:MM'),
      }),
      execute: async ({ wakeTime, sleepTime, breakfastTime, lunchTime, dinnerTime }) => {
        // Cancel existing routine jobs to avoid duplicates on re-run
        const routines: RoutineName[] = ['morning', 'breakfast', 'lunch', 'dinner', 'reflection'];
        await Promise.all(routines.map(r => cancelRoutineJobs(userId, r)));

        await setupUserSchedules(
          { id: userId, telegramUserId, timezone: userTimezone, wakeTime, sleepTime },
          chatId,
          { breakfastTime, lunchTime, dinnerTime },
        );
        await usersRepo.update(userId, {
          wakeTime,
          sleepTime,
          breakfastTime,
          lunchTime,
          dinnerTime,
          onboardingComplete: true,
        });
        setOnboardingDone?.();
        log.info({ userId }, 'Daily schedule configured via onboarding');
        return { done: true, jobs: ['morning', 'breakfast', 'lunch', 'dinner', 'reflection'] };
      },
    }),

    followup_ask: tool({
      description: 'Запланировать проактивный follow-up — агент сам решает через сколько минут переспросить.',
      inputSchema: z.object({
        delayMinutes: z.number().min(1).max(120).describe('Через сколько минут переспросить'),
        context: z.string().describe('О чём переспросить (контекст для проактивного сообщения)'),
        attemptNumber: z.number().min(1).max(4).optional().default(1).describe('Номер попытки (1-4), влияет на тон эскалации'),
      }),
      execute: async ({ delayMinutes, context, attemptNumber }) => {
        const payload: JobPayload = {
          userId,
          telegramUserId,
          telegramChatId: chatId,
          kind: 'followup_check',
          context,
          attemptNumber,
        };
        const jobId = await scheduleJob(payload, delayMinutes * 60_000);
        log.info({ userId, delayMinutes, context, attemptNumber, jobId }, 'Follow-up scheduled');
        return { scheduled: true, inMinutes: delayMinutes, attemptNumber, jobId };
      },
    }),
  };
}
