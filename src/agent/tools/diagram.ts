import { deflateSync } from 'node:zlib';
import { tool } from 'ai';
import { z } from 'zod';
import { InputFile } from 'grammy';
import { bot } from '../../bot/bot.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:diagram');

// Supported diagram types via Mermaid on kroki.io
const DIAGRAM_TYPES = ['flowchart', 'sequence', 'class', 'mindmap', 'timeline', 'gantt', 'er', 'pie'] as const;

export function diagramTools(chatId: number) {
  return {
    diagram_render: tool({
      description: `Нарисовать диаграмму и отправить пользователю как изображение. Используй для визуализации: схем процессов (flowchart), временных линий (timeline), диаграмм классов (class), интеллект-карт (mindmap), графиков Ганта (gantt), ER-диаграмм (er), круговых диаграмм (pie), sequence-диаграмм.
Пиши Mermaid-код корректно. Пример flowchart:
flowchart TD
  A[Начало] --> B{Условие}
  B -->|Да| C[Результат 1]
  B -->|Нет| D[Результат 2]`,
      inputSchema: z.object({
        mermaidCode: z.string().describe('Корректный Mermaid-код диаграммы'),
        caption: z.string().optional().describe('Подпись к изображению'),
      }),
      execute: async ({ mermaidCode, caption }) => {
        try {
          // kroki.io GET endpoint requires zlib-deflated then base64url-encoded source
          const encoded = deflateSync(Buffer.from(mermaidCode)).toString('base64url');
          const url = `https://kroki.io/mermaid/png/${encoded}`;

          log.debug({ chatId, url }, 'Rendering diagram via kroki.io');

          const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) {
            log.warn({ status: res.status }, 'kroki.io returned error');
            return { error: `Не удалось отрисовать диаграмму (kroki.io: ${res.status}). Проверь синтаксис Mermaid.` };
          }

          const buf = Buffer.from(await res.arrayBuffer());
          await bot.api.sendPhoto(chatId, new InputFile(buf, 'diagram.png'), caption ? { caption } : undefined);
          log.info({ chatId }, 'Diagram sent');
          return { sent: true };
        } catch (err) {
          log.error({ err }, 'Failed to render diagram');
          return { error: 'Не удалось нарисовать диаграмму. Попробуй упростить схему.' };
        }
      },
    }),
  };
}
