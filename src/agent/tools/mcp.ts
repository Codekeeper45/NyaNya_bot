import { tool } from 'ai';
import { z } from 'zod';
import { mcpManager } from '../../mcp/client.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:mcp');

export function mcpCalendarTools() {
  return {
    mcp_gcal_list_events: tool({
      description: 'Список предстоящих событий Google Calendar',
      inputSchema: z.object({
        timeMin: z.string().optional().describe('ISO 8601 начало диапазона'),
        timeMax: z.string().optional().describe('ISO 8601 конец диапазона'),
        maxResults: z.number().optional().default(10),
      }),
      execute: async (args) => {
        try {
          const result = await mcpManager.callTool('google-calendar', 'list-events', args);
          return result.content;
        } catch (err) {
          log.error({ err }, 'GCal list-events failed');
          return { error: 'Google Calendar недоступен' };
        }
      },
    }),

    mcp_gcal_create_event: tool({
      description: 'Создать событие в Google Calendar',
      inputSchema: z.object({
        summary: z.string().describe('Название события'),
        start: z.string().describe('ISO 8601 начало'),
        end: z.string().describe('ISO 8601 конец'),
        description: z.string().optional(),
      }),
      execute: async (args) => {
        try {
          const result = await mcpManager.callTool('google-calendar', 'create-event', args);
          return result.content;
        } catch (err) {
          log.error({ err }, 'GCal create-event failed');
          return { error: 'Не удалось создать событие' };
        }
      },
    }),
  };
}
