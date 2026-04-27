import { tool } from 'ai';
import { z } from 'zod';
import { messagesRepo } from '../../db/repos/messages.js';

const STOP_WORDS = new Set([
  'факт', 'пользователе', 'пользователь', 'эмир', 'я', 'ты', 'он', 'она',
  'ходит', 'ходить', 'посещает', 'посещать', 'занимается', 'заниматься',
  'в', 'во', 'на', 'и', 'а', 'что', 'это', 'мой', 'моя', 'мое', 'моё', 'мои',
]);

function factTokens(value: string): Set<string> {
  return new Set(value
    .toLowerCase()
    .replace(/^факт о пользователе:\s*/i, '')
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token)));
}

function isNearDuplicateFact(nextFact: string, existingContent: string): boolean {
  const next = factTokens(nextFact);
  const existing = factTokens(existingContent);
  if (next.size === 0 || existing.size === 0) return false;

  let intersection = 0;
  for (const token of next) {
    if (existing.has(token)) intersection++;
  }
  const smaller = Math.min(next.size, existing.size);
  return intersection >= 3 || intersection / smaller >= 0.75;
}

export function memoryTools(userId: number) {
  return {
    memory_save: tool({
      description: 'Сохранить важный факт о пользователе в долгосрочную память. Используй когда пользователь рассказывает что-то о себе (семья, работа, предпочтения, цели). Факт будет проиндексирован в граф знаний автоматически.',
      inputSchema: z.object({
        fact: z.string().describe('Факт для запоминания'),
        category: z.enum(['profile', 'preference', 'goal', 'schedule', 'health', 'study', 'relationship', 'misc']).optional().describe('Категория факта'),
      }),
      execute: async ({ fact, category }) => {
        const existingFacts = await messagesRepo.getSavedFacts(userId, 100);
        if (existingFacts.some(existing => isNearDuplicateFact(fact, existing.content))) {
          return { saved: false, duplicate: true };
        }

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
