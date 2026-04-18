import { tool } from 'ai';
import { z } from 'zod';
import { webSearch } from '../../research/search.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:weather');

export function weatherTools() {
  return {
    weather_get_forecast: tool({
      description: 'Узнать прогноз погоды для конкретного города и получить советы по одежде/планам. Используй в утреннем приветствии.',
      inputSchema: z.object({
        city: z.string().describe('Город пользователя (например, Алматы, Москва)'),
        date: z.string().optional().describe('Дата (например, сегодня, завтра)'),
      }),
      execute: async ({ city, date = 'сегодня' }) => {
        const query = `погода в ${city} ${date} прогноз на день советы по одежде`;
        log.info({ city, date }, 'Fetching weather forecast via search');
        
        try {
          const results = await webSearch(query, 3);
          if (results.length === 0) return { error: 'Не удалось найти прогноз погоды.' };
          
          return {
            city,
            date,
            sources: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
          };
        } catch (err) {
          log.error({ err }, 'Weather search failed');
          return { error: 'Ошибка при получении прогноза.' };
        }
      },
    }),
  };
}
