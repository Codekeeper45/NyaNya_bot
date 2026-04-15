import { tool } from 'ai';
import { z } from 'zod';
import { mem0 } from '../../memory/mem0.js';

export function memoryTools(telegramUserId: number) {
  const uid = String(telegramUserId);

  return {
    memory_search: tool({
      description: 'Поиск в памяти о пользователе. Используй перед ответом на вопросы о предпочтениях, истории или фактах о пользователе.',
      inputSchema: z.object({
        query: z.string().describe('Что искать в памяти'),
      }),
      execute: async ({ query }) => {
        const results = await mem0.search(query, uid);
        return { memories: results.map((r: { memory?: string }) => r.memory ?? '') };
      },
    }),

    memory_save: tool({
      description: 'Сохранить важный факт о пользователе в долговременную память. Используй когда пользователь рассказывает что-то о себе.',
      inputSchema: z.object({
        fact: z.string().describe('Факт для запоминания'),
        category: z.enum(['profile', 'preference', 'goal', 'schedule', 'health', 'study', 'relationship', 'misc']).optional().describe('Категория факта'),
      }),
      execute: async ({ fact, category }) => {
        await mem0.add(
          [{ role: 'assistant', content: `Важный факт: ${fact}` }],
          uid,
          category ? { category } : undefined,
        );
        return { saved: true };
      },
    }),
  };
}
