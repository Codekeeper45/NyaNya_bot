import { tool } from 'ai';
import { z } from 'zod';
import { InputFile } from 'grammy';
import { webSearch } from '../../research/search.js';
import { webFetch, webFetchMany } from '../../research/fetch.js';
import { bot } from '../../bot/bot.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:research');

export function researchTools(chatId?: number) {
  return {
    web_search: tool({
      description: 'Выполнить прямой поиск в интернете для получения актуальной информации. Использует Tavily Search (надёжный) с Brave fallback.',
      inputSchema: z.object({
        query: z.string().describe('Поисковый запрос'),
        count: z.number().optional().default(5).describe('Количество результатов'),
      }),
      execute: async ({ query, count }) => {
        log.info({ query }, 'Performing web search');
        const results = await webSearch(query, count);
        if (results.length === 0) return { message: 'Ничего не найдено.' };
        return { results };
      },
    }),

    web_read: tool({
      description: 'Прочитать содержимое веб-страницы по URL. Использует Tavily Extract (серверный, надёжный) с JSDOM fallback. Подходит для получения полного текста статьи, документации.',
      inputSchema: z.object({
        url: z.string().url().describe('URL страницы для чтения'),
      }),
      execute: async ({ url }) => {
        log.info({ url }, 'Fetching page');
        try {
          const result = await webFetch(url);
          return result;
        } catch (err) {
          log.warn({ err, url }, 'Failed to fetch page');
          return { error: 'Не удалось прочитать страницу.' };
        }
      },
    }),

    web_read_many: tool({
      description: 'Прочитать 2-20 веб-страниц параллельно. Использует Tavily batch extract (один API вызов). Предпочтительнее нескольких web_read вызовов.',
      inputSchema: z.object({
        urls: z.array(z.string().url()).min(1).max(20).describe('URLs для параллельного чтения'),
      }),
      execute: async ({ urls }) => {
        log.info({ count: urls.length }, 'Fetching multiple pages');
        try {
          const results = await webFetchMany(urls);
          return results;
        } catch (err) {
          log.warn({ err, count: urls.length }, 'Failed to fetch pages');
          return { error: 'Не удалось прочитать страницы.' };
        }
      },
    }),

    web_fetch_image: tool({
      description: 'Скачать изображение по URL и показать пользователю. Используй когда нашёл полезную картинку/инфографику для урока.',
      inputSchema: z.object({
        url: z.string().url().describe('Прямая ссылка на изображение'),
        caption: z.string().optional().describe('Подпись к изображению'),
      }),
      execute: async ({ url, caption }) => {
        if (!chatId) return { error: 'Нет chatId для отправки.' };
        try {
          log.info({ url }, 'Fetching image');
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) return { error: `HTTP ${res.status}` };
          const contentType = res.headers.get('content-type') ?? '';
          if (!contentType.startsWith('image/')) {
            return { error: 'URL не является изображением.' };
          }
          const buf = Buffer.from(await res.arrayBuffer());
          const ext = contentType.includes('png') ? 'image.png' : 'image.jpg';
          await bot.api.sendPhoto(chatId, new InputFile(buf, ext), caption ? { caption } : undefined);
          return { sent: true, mimeType: contentType };
        } catch (err) {
          log.warn({ err, url }, 'Failed to fetch image');
          return { error: 'Не удалось загрузить изображение.' };
        }
      },
    }),
  };
}
