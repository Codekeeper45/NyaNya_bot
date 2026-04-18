import { tool } from 'ai';
import { z } from 'zod';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:maps');
const REQUEST_TIMEOUT_MS = 8000;

export function mapsTools() {
  return {
    maps_search_place: tool({
      description: 'Поиск мест, зданий, адресов или достопримечательностей через OpenStreetMap (Nominatim). Возвращает координаты и описание.',
      inputSchema: z.object({
        query: z.string().describe('Поисковый запрос (например, кафе рядом с метро Аль-Фараби, Москва Красная площадь)'),
        limit: z.number().optional().default(3),
      }),
      execute: async ({ query, limit }) => {
        log.info({ query }, 'Searching OSM place');
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}`;
          const res = await fetch(url, {
            headers: { 'User-Agent': 'OpekunBot/1.0' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          
          if (!res.ok) return { error: 'Ошибка сервиса карт OSM.' };
          
          const data = await res.json() as any[];
          if (data.length === 0) return { message: 'Ничего не найдено по этому запросу.' };

          return {
            results: data.map(item => ({
              name: item.display_name,
              lat: item.lat,
              lon: item.lon,
              type: item.type,
              importance: item.importance
            }))
          };
        } catch (err) {
          log.error({ err }, 'OSM search failed');
          return { error: 'Не удалось выполнить поиск на карте.' };
        }
      },
    }),

    maps_get_route: tool({
      description: 'Проложить маршрут между двумя точками (авто, велосипед или пешком) через OSRM.',
      inputSchema: z.object({
        startLat: z.string().describe('Широта старта'),
        startLon: z.string().describe('Долгота старта'),
        endLat: z.string().describe('Широта финиша'),
        endLon: z.string().describe('Долгота финиша'),
        profile: z.enum(['car', 'bike', 'foot']).optional().default('foot').describe('Способ передвижения'),
      }),
      execute: async ({ startLat, startLon, endLat, endLon, profile }) => {
        log.info({ profile }, 'Calculating OSM route');
        try {
          const osrmProfile = profile === 'car' ? 'driving' : profile === 'bike' ? 'cycling' : 'walking';
          const url = `https://router.project-osrm.org/route/v1/${osrmProfile}/${startLon},${startLat};${endLon},${endLat}?overview=false&steps=true`;
          
          const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
          if (!res.ok) return { error: 'Ошибка построения маршрута.' };
          
          const data = await res.json() as any;
          if (!data.routes || data.routes.length === 0) return { message: 'Маршрут не найден.' };

          const route = data.routes[0];
          return {
            distance: `${(route.distance / 1000).toFixed(2)} км`,
            duration: `${Math.round(route.duration / 60)} мин`,
            steps: route.legs[0].steps.map((s: any) => s.maneuver.instruction).filter(Boolean)
          };
        } catch (err) {
          log.error({ err }, 'OSRM routing failed');
          return { error: 'Не удалось построить маршрут.' };
        }
      },
    }),

    maps_get_static_url: tool({
      description: 'Сгенерировать ссылку на карту для просмотра места.',
      inputSchema: z.object({
        lat: z.string(),
        lon: z.string(),
        zoom: z.number().optional().default(15),
      }),
      execute: async ({ lat, lon, zoom }) => {
        // OSM не предоставляет официальный статический API без ключей, 
        // поэтому возвращаем ссылку на интерактивную карту или один из бесплатных рендереров
        return {
          osmUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`,
          googleMapsUrl: `https://www.google.com/maps?q=${lat},${lon}`
        };
      },
    }),
  };
}
