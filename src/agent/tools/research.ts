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
      description: 'Поиск в интернете через Tavily (200+ источников). WHEN: нужна актуальная информация, новости, факты, цены, погода, примеры для урока. CHAIN: web_search → web_read_many(urls из результатов) → message_send_text. RETURNS: { results: [{ title, url, snippet }] } или { message: "Ничего не найдено" }.',
      inputSchema: z.object({
        query: z.string().describe('Поисковый запрос'),
        count: z.number().optional().default(5).describe('Количество результатов'),
      }),
      execute: async ({ query, count }) => {
        log.info({ query }, 'Performing Tavily web search');
        try {
          const results = await webSearch(query, count);
          if (results.length === 0) return { message: 'Ничего не найдено.' };
          return { results };
        } catch (err) {
          log.error({ err, query }, 'Web search failed');
          throw new Error(`Ошибка поиска: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`);
        }
      },
    }),

    web_read: tool({
      description: 'Прочитать веб-страницу по URL через Tavily Extract. WHEN: нужен полный текст конкретной статьи или документации. CHAIN: web_search (найди URL) → этот инструмент → message_send_text. RETURNS: { title, content, url } или ошибку.',
      inputSchema: z.object({
        url: z.string().url().describe('URL страницы для чтения'),
      }),
      execute: async ({ url }) => {
        log.info({ url }, 'Fetching page via Tavily');
        try {
          const result = await webFetch(url);
          return result;
        } catch (err) {
          log.error({ err, url }, 'Failed to fetch page');
          throw new Error(`Не удалось прочитать ${url}: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`);
        }
      },
    }),

    web_read_many: tool({
      description: 'Прочитать 2-20 веб-страниц параллельно через Tavily batch. WHEN: нужно проанализировать несколько источников. CHAIN: web_search → этот инструмент (передай urls) → message_send_text. RETURNS: { results: [{ url, title, content }] }. ПРЕИМУЩЕСТВО: быстрее и дешевле, чем N × web_read.',
      inputSchema: z.object({
        urls: z.array(z.string().url()).min(1).max(20).describe('URLs для параллельного чтения'),
      }),
      execute: async ({ urls }) => {
        log.info({ count: urls.length }, 'Fetching multiple pages via Tavily batch');
        try {
          const results = await webFetchMany(urls);
          return results;
        } catch (err) {
          log.error({ err, count: urls.length }, 'Failed to fetch pages');
          throw new Error(`Не удалось прочитать страницы: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`);
        }
      },
    }),

    web_fetch_image: tool({
      description: 'Скачать изображение по URL и отправить в чат. WHEN: нашёл полезную картинку/инфографику для урока или ответа. CHAIN: web_search (найди URL картинки) → этот инструмент. RETURNS: { sent: true, mimeType } или { error }.',
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
