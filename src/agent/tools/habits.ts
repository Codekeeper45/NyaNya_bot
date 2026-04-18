import { tool } from 'ai';
import { z } from 'zod';
import { habitsRepo } from '../../db/repos/habits.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:habits');

const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function todayDate(timezone: string): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: timezone }); // "2026-04-18"
}

export function habitTools(userId: number, timezone: string) {
  return {
    habit_create: tool({
      description: 'Создать новую привычку для отслеживания. Можно задать конкретные дни недели.',
      inputSchema: z.object({
        name: z.string().describe('Название привычки, например "Зарядка 10 минут" или "Выпить 2л воды"'),
        targetDays: z.array(z.number().min(0).max(6))
          .default([0, 1, 2, 3, 4, 5, 6])
          .describe('Целевые дни: 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб. По умолчанию каждый день.'),
      }),
      execute: async ({ name, targetDays }) => {
        try {
          const habit = await habitsRepo.create(userId, name, targetDays);
          const daysStr = targetDays.length === 7 ? 'каждый день' : targetDays.map(d => DAY_NAMES[d]).join(', ');
          log.info({ userId, habitId: habit.id, name }, 'Habit created');
          return { success: true, habitId: habit.id, message: `Привычка «${name}» создана (${daysStr}).` };
        } catch (err) {
          log.error({ err }, 'Failed to create habit');
          return { error: 'Не удалось создать привычку.' };
        }
      },
    }),

    habit_log: tool({
      description: 'Отметить выполнение (или невыполнение) привычки за сегодня. Обновляет стрик.',
      inputSchema: z.object({
        habitId: z.number().describe('ID привычки'),
        done: z.boolean().describe('true = выполнено, false = пропущено'),
      }),
      execute: async ({ habitId, done }) => {
        try {
          const habit = await habitsRepo.findById(habitId, userId);
          if (!habit) return { error: 'Привычка не найдена.' };

          const date = todayDate(timezone);
          await habitsRepo.log(habitId, date, done);

          let newStreak = habit.streak ?? 0;
          if (done) {
            const lastDate = habit.lastLoggedDate;
            // Compute yesterday in user's timezone by shifting date string, not JS Date arithmetic
            const todayStr = todayDate(timezone);
            const d = new Date(`${todayStr}T00:00:00`);
            d.setDate(d.getDate() - 1);
            const yesterdayStr = d.toLocaleDateString('sv-SE');
            newStreak = (lastDate === yesterdayStr || lastDate === date) ? newStreak + 1 : 1;
          } else {
            newStreak = 0;
          }

          await habitsRepo.updateStreak(habitId, newStreak, date);
          log.info({ userId, habitId, done, streak: newStreak }, 'Habit logged');

          const streakMsg = done && newStreak > 1 ? ` Стрик: ${newStreak} дней 🔥` : '';
          return { logged: true, streak: newStreak, message: done ? `Отлично, отметила!${streakMsg}` : 'Записала. Завтра получится!' };
        } catch (err) {
          log.error({ err }, 'Failed to log habit');
          return { error: 'Не удалось записать привычку.' };
        }
      },
    }),

    habit_list: tool({
      description: 'Показать все привычки пользователя с текущими стриками и статусом на сегодня.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const date = todayDate(timezone);
          const todayLogs = await habitsRepo.getTodayLogs(userId, date);
          if (todayLogs.length === 0) return { message: 'Привычек пока нет. Создай первую через habit_create!' };

          const habits = todayLogs.map(({ habit, log: entry }) => ({
            id: habit.id,
            name: habit.name,
            streak: habit.streak ?? 0,
            targetDays: (habit.targetDays as number[] | null)?.map(d => DAY_NAMES[d]).join(', ') ?? 'каждый день',
            todayDone: entry?.done ?? null,
          }));
          return { habits, date };
        } catch (err) {
          log.error({ err }, 'Failed to list habits');
          return { error: 'Не удалось загрузить привычки.' };
        }
      },
    }),

    habit_stats: tool({
      description: 'Показать статистику привычки за последние 7 дней.',
      inputSchema: z.object({
        habitId: z.number().describe('ID привычки'),
      }),
      execute: async ({ habitId }) => {
        try {
          const habit = await habitsRepo.findById(habitId, userId);
          if (!habit) return { error: 'Привычка не найдена.' };

          const todayStr = todayDate(timezone);
          const dates = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(`${todayStr}T00:00:00`);
            d.setDate(d.getDate() - i);
            return d.toLocaleDateString('sv-SE');
          });
          const logs = await habitsRepo.getWeekLogs(habitId, dates);
          const last7 = logs.slice(0, 7);
          const doneCount = last7.filter(l => l.done).length;
          return {
            name: habit.name,
            streak: habit.streak ?? 0,
            last7Days: { total: last7.length, done: doneCount, missed: last7.length - doneCount },
          };
        } catch (err) {
          log.error({ err }, 'Failed to get habit stats');
          return { error: 'Не удалось получить статистику.' };
        }
      },
    }),

    habit_delete: tool({
      description: 'Удалить привычку.',
      inputSchema: z.object({
        habitId: z.number().describe('ID привычки'),
      }),
      execute: async ({ habitId }) => {
        try {
          const habit = await habitsRepo.findById(habitId, userId);
          if (!habit) return { error: 'Привычка не найдена.' };
          await habitsRepo.delete(habitId);
          log.info({ userId, habitId }, 'Habit deleted');
          return { deleted: true, name: habit.name };
        } catch (err) {
          log.error({ err }, 'Failed to delete habit');
          return { error: 'Не удалось удалить привычку.' };
        }
      },
    }),
  };
}
