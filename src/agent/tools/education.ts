import { tool } from 'ai';
import { z } from 'zod';
import { lessonPlansRepo } from '../../db/repos/lesson_plans.js';
import { scheduleRepeatingJob, cancelRepeatingJob } from '../../scheduler/jobs.js';
import { repeatingJobsRepo } from '../../db/repos/repeating_jobs.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:education');

export function educationTools(
  userId: number,
  telegramUserId?: number,
  telegramChatId?: number,
  timezone?: string,
) {
  return {
    education_create_plan: tool({
      description: 'Создать новый учебный план или тему для изучения. Используй, когда предлагаешь пользователю что-то новое или когда он присылает материал.',
      inputSchema: z.object({
        subject: z.string().describe('Предмет (например, Python, Математика, Рисование)'),
        topic: z.string().describe('Конкретная тема урока'),
        plan: z.string().optional().describe('Подробный пошаговый план изучения'),
        materials: z.array(z.object({
          type: z.string().describe('Тип (link, text, file)'),
          content: z.string().describe('Ссылка или текст материала'),
          title: z.string().optional().describe('Заголовок материала')
        })).optional(),
      }),
      execute: async (data) => {
        try {
          const plan = await lessonPlansRepo.create({
            userId,
            ...data,
            status: 'active'
          });
          log.info({ userId, subject: data.subject, topic: data.topic }, 'Lesson plan created');
          return { success: true, planId: plan.id, message: `Учебный план по теме «${data.topic}» создан.` };
        } catch (err) {
          log.error({ err }, 'Failed to create lesson plan');
          return { success: false, error: 'Не удалось создать учебный план.' };
        }
      },
    }),

    education_list_plans: tool({
      description: 'Показать список всех учебных планов пользователя (активных и завершенных).',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const plans = await lessonPlansRepo.findByUser(userId);
          if (plans.length === 0) return { message: 'У тебя пока нет созданных учебных планов.' };
          return { plans };
        } catch (err) {
          log.error({ err }, 'Failed to list lesson plans');
          return { error: 'Не удалось загрузить список планов.' };
        }
      },
    }),

    education_update_status: tool({
      description: 'Обновить статус учебного плана (например, пометить как завершенный).',
      inputSchema: z.object({
        planId: z.number().describe('ID учебного плана'),
        status: z.enum(['draft', 'active', 'completed', 'archived']).describe('Новый статус'),
      }),
      execute: async ({ planId, status }) => {
        try {
          const updated = await lessonPlansRepo.updateStatusForUser(planId, userId, status);
          if (!updated) {
            return { success: false, error: 'План не найден или не принадлежит пользователю.' };
          }
          log.info({ userId, planId, status }, 'Lesson plan status updated');
          return { success: true, message: `Статус плана изменен на ${status}.` };
        } catch (err) {
          log.error({ err }, 'Failed to update lesson plan status');
          return { success: false, error: 'Не удалось обновить статус.' };
        }
      },
    }),

    education_get_plan: tool({
      description: 'Получить детали конкретного учебного плана по ID.',
      inputSchema: z.object({
        planId: z.number().describe('ID учебного плана'),
      }),
      execute: async ({ planId }) => {
        try {
          const plan = await lessonPlansRepo.findByIdForUser(planId, userId);
          if (!plan) return { error: 'План не найден.' };
          return { plan };
        } catch (err) {
          log.error({ err }, 'Failed to get lesson plan');
          return { error: 'Не удалось загрузить план.' };
        }
      },
    }),

    education_schedule: tool({
      description: 'Поставить учебный план в расписание повторяющихся уроков. После вызова: 1) проверь scheduled: true, 2) сообщи пользователю какой план, в какие дни и в какое время запланирован. Если scheduled: false или error — скажи об ошибке и не подтверждай создание.',
      inputSchema: z.object({
        planId: z.number().describe('ID учебного плана (из education_list_plans)'),
        days: z.array(z.number().min(0).max(6)).describe('Дни недели: 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб'),
        time: z.string().regex(/^\d{2}:\d{2}$/).describe('Время урока HH:MM'),
        durationMinutes: z.number().min(15).max(180).default(45).describe('Длительность урока в минутах'),
      }),
      execute: async ({ planId, days, time, durationMinutes }) => {
        if (!telegramUserId || !telegramChatId || !timezone) {
          return { error: 'Недостаточно контекста для планирования.' };
        }
        try {
          const plan = await lessonPlansRepo.findByIdForUser(planId, userId);
          if (!plan) return { error: 'Учебный план не найден.' };

          const [h, m] = time.split(':');
          const daysPart = days.length > 0 ? days.join(',') : '*';
          const cron = `${m} ${h} * * ${daysPart}`;
          const schedulerId = `user-${userId}-lesson-${planId}`;

          // Cancel existing schedule for this plan if any
          const existing = await repeatingJobsRepo.findByUser(userId);
          const old = existing.find(j => j.schedulerId === schedulerId);
          if (old) await cancelRepeatingJob(schedulerId);

          await scheduleRepeatingJob(
            schedulerId,
            {
              userId,
              telegramUserId,
              telegramChatId,
              kind: 'lesson_session',
              context: JSON.stringify({ planId, subject: plan.subject, topic: plan.topic, planText: plan.plan }),
            },
            cron,
            timezone,
          );

          await lessonPlansRepo.updateSchedule(planId, userId, { scheduledDays: days, scheduledTime: time, durationMinutes });

          const dayNames = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
          const daysStr = days.map(d => dayNames[d]).join(', ');
          log.info({ userId, planId, cron }, 'Lesson scheduled');
          return { scheduled: true, schedulerId, cron, summary: `Уроки по теме «${plan.topic}» запланированы: ${daysStr} в ${time}` };
        } catch (err) {
          log.error({ err }, 'Failed to schedule lesson');
          return { error: 'Не удалось поставить урок в расписание.' };
        }
      },
    }),

    education_unschedule: tool({
      description: 'Отменить расписание уроков по учебному плану. Если расписание не было активным — всё равно вернётся cancelled: true, это нормально. Не говори "отменил" до получения ответа.',
      inputSchema: z.object({
        planId: z.number().describe('ID учебного плана'),
      }),
      execute: async ({ planId }) => {
        try {
          const schedulerId = `user-${userId}-lesson-${planId}`;
          await cancelRepeatingJob(schedulerId);
          log.info({ userId, planId }, 'Lesson unscheduled');
          return { cancelled: true, schedulerId };
        } catch (err) {
          log.error({ err }, 'Failed to unschedule lesson');
          return { error: 'Не удалось отменить расписание.' };
        }
      },
    }),
  };
}
