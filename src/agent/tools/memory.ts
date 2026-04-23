import { tool } from 'ai';
import { z } from 'zod';
import { messagesRepo } from '../../db/repos/messages.js';

export function memoryTools(userId: number) {
  return {
    memory_save: tool({
      description: 'Сохранить важный факт о пользователе в долгосрочную память. Используй когда пользователь рассказывает что-то о себе (семья, работа, предпочтения, цели). Факт будет проиндексирован в граф знаний автоматически.',
      inputSchema: z.object({
        fact: z.string().describe('Факт для запоминания'),
        category: z.enum(['profile', 'preference', 'goal', 'schedule', 'health', 'study', 'relationship', 'misc']).optional().describe('Категория факта'),
      }),
      execute: async ({ fact, category }) => {
        await messagesRepo.create({
          userId,
          role: 'user',
          content: `Факт о пользователе: ${fact}`,
          source: 'memory_save',
          metadata: category ? { category } : undefined,
        });
        return { saved: true };
      },
    }),
  };
}
