import { tool } from 'ai';
import { z } from 'zod';
import { scheduleJob, cancelJob, type JobPayload } from '../../scheduler/jobs.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:schedule');

export function scheduleTools(userId: number, telegramUserId: number, chatId: number) {
  return {
    schedule_reminder: tool({
      description: 'Запланировать напоминание пользователю через указанное количество минут.',
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
      description: 'Отменить ранее запланированную задачу по ID.',
      inputSchema: z.object({
        jobId: z.string().describe('ID задачи для отмены'),
      }),
      execute: async ({ jobId }) => {
        await cancelJob(jobId);
        return { cancelled: true };
      },
    }),
  };
}
