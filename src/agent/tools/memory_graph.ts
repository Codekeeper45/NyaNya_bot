import { tool } from 'ai';
import { z } from 'zod';
import { graphRag } from '../../graphrag/index.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tools:memory-graph');

export const memoryGraphTools = (userId: number) => ({
  memory_search_graph: tool({
    description: 'Поиск в структурированной базе знаний (GraphRAG) — связи между сущностями, долгосрочные факты, история событий. Используй когда нужно найти связанные факты, отношения или долгосрочную информацию о пользователе (работа, семья, хобби, прошлые события). Не используй для общих вопросов (погода, новости, переводы).',
    inputSchema: z.object({
      query: z.string().describe('Что искать (на русском). Примеры: "где работает пользователь", "любимые животные", "что делал вчера", "семья", "хобби")'),
    }),
    execute: async ({ query }) => {
      log.info({ userId, query }, 'memory_search_graph called');
      const context = await graphRag.retrieve(userId, query);
      if (!context || context.trim().length === 0) {
        return { found: false, context: 'Ничего не найдено в памяти по этому запросу.' };
      }
      return { found: true, context };
    },
  }),
});
