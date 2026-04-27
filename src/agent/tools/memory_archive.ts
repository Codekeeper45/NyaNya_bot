import { tool } from 'ai';
import { z } from 'zod';
import { searchMemoryArchive } from '../../memory/archive-search.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tools:memory-archive');

export const memoryArchiveTools = (userId: number) => ({
  memory_search_archive: tool({
    description: 'Осознанный глубокий поиск по архивной памяти: сначала явно сохранённые факты, затем фрагменты переписки. Используй для точных деталей, старых событий, проверки GraphRAG и поиска первоисточника.',
    inputSchema: z.object({
      query: z.string().describe('Что найти в архиве памяти. Формулируй конкретно: объект, дата, тема, человек, событие.'),
    }),
    execute: async ({ query }) => {
      log.info({ userId, query }, 'memory_search_archive called');
      const result = await searchMemoryArchive(userId, query);
      if (!result.found || result.context.trim().length === 0) {
        return { found: false, context: 'Ничего не найдено в архивной памяти по этому запросу.' };
      }
      return { found: true, context: result.context };
    },
  }),
});
