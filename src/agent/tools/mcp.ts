import { tool } from 'ai';
import { z } from 'zod';
import * as calendar from '../../calendar/client.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:calendar');

const NOT_CONNECTED = { error: 'Google Calendar не подключён. Скажи пользователю использовать /gcal.' };
const AUTH_REVOKED = { error: 'Токен Google Calendar отозван. Скажи пользователю выполнить /gcal для повторного подключения.' };

async function checkConnection(userId: number) {
  const token = await calendar.getRefreshToken(userId);
  if (!token) throw new Error('NOT_CONNECTED');
}

function calendarError(err: unknown): typeof NOT_CONNECTED {
  if (err instanceof Error && err.message === 'GOOGLE_AUTH_REVOKED') return AUTH_REVOKED;
  return NOT_CONNECTED;
}

export function mcpCalendarTools(userId: number, userTimezone: string) {
  return {
    gcal_list_calendars: tool({
      description: 'Список календарей Google. WHEN: нужно узнать доступные календари. CHAIN: прямой запрос → этот инструмент. RETURNS: { calendars }.',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          await checkConnection(userId);
          const calendars = await calendar.listCalendars(userId);
          return { calendars };
        } catch (err) {
          log.warn({ userId, err }, 'Failed to list calendars');
          return calendarError(err);
        }
      },
    }),

    gcal_list_all_events: tool({
      description: 'События из всех календарей за период. WHEN: утреннее приветствие, планирование дня, "что у меня на завтра". CHAIN: этот инструмент → message_send_text. RETURNS: { events } или { events: [], message }. Всегда указывай timeMin/timeMax в ISO 8601.',
      inputSchema: z.object({
        timeMin: z.string().describe('ISO 8601 начало диапазона (например, 2024-05-24T00:00:00Z)'),
        timeMax: z.string().describe('ISO 8601 конец диапазона'),
        maxResults: z.number().optional().default(20),
      }),
      execute: async ({ timeMin, timeMax, maxResults }) => {
        try {
          await checkConnection(userId);
          const events = await calendar.listAllEvents(userId, timeMin, timeMax, maxResults);
          if (events.length === 0) return { events: [], message: 'Событий в этот период нет.' };
          return { events };
        } catch (err) {
          log.warn({ userId, err }, 'Failed to list all events');
          return calendarError(err);
        }
      },
    }),

    gcal_create_event: tool({
      description: 'Создать событие. WHEN: пользователь просит добавить встречу. CHAIN: прямой запрос → этот инструмент → message_send_text. RETURNS: { created: true, event }. start/end в локальном времени пользователя.',
      inputSchema: z.object({
        summary: z.string().describe('Заголовок события'),
        start: z.string().describe('ISO 8601 в локальном времени, напр. 2025-04-17T10:00:00. Для дня целиком: 2025-04-17T00:00:00'),
        end: z.string().describe('ISO 8601 в локальном времени, напр. 2025-04-17T11:00:00. Для дня целиком: 2025-04-17T23:59:00'),
        description: z.string().optional().describe('Описание события'),
        location: z.string().optional().describe('Место проведения'),
        calendarId: z.string().optional().default('primary').describe('ID календаря (по умолчанию основной)'),
      }),
      execute: async ({ calendarId, ...event }) => {
        try {
          await checkConnection(userId);
          const result = await calendar.createEvent(userId, { ...event, timeZone: userTimezone }, calendarId);
          return { created: true, event: result };
        } catch (err) {
          log.error({ userId, err }, 'Failed to create event');
          return calendarError(err);
        }
      },
    }),

    gcal_update_event: tool({
      description: 'Изменить событие. WHEN: пользователь просит перенести/изменить встречу. CHAIN: gcal_list_all_events (найди eventId) → этот инструмент → message_send_text. RETURNS: { updated: true, event }.',
      inputSchema: z.object({
        eventId: z.string().describe('ID события'),
        calendarId: z.string().optional().default('primary').describe('ID календаря'),
        summary: z.string().optional(),
        start: z.string().optional().describe('ISO 8601 в локальном времени, напр. 2025-04-17T10:00:00'),
        end: z.string().optional().describe('ISO 8601 в локальном времени, напр. 2025-04-17T11:00:00'),
        description: z.string().optional(),
        location: z.string().optional(),
      }),
      execute: async ({ eventId, calendarId, ...patch }) => {
        try {
          await checkConnection(userId);
          const result = await calendar.updateEvent(userId, eventId, { ...patch, timeZone: userTimezone }, calendarId);
          return { updated: true, event: result };
        } catch (err) {
          log.error({ userId, eventId, err }, 'Failed to update event');
          return calendarError(err);
        }
      },
    }),

    gcal_delete_event: tool({
      description: 'Удалить событие. WHEN: пользователь просит отменить встречу. CHAIN: gcal_list_all_events (найди eventId) → этот инструмент → message_send_text. RETURNS: { deleted: true, eventId }.',
      inputSchema: z.object({
        eventId: z.string().describe('ID события'),
        calendarId: z.string().optional().default('primary').describe('ID календаря'),
      }),
      execute: async ({ eventId, calendarId }) => {
        try {
          await checkConnection(userId);
          await calendar.deleteEvent(userId, eventId, calendarId);
          return { deleted: true, eventId };
        } catch (err) {
          log.error({ userId, eventId, err }, 'Failed to delete event');
          return calendarError(err);
        }
      },
    }),
  };
}
