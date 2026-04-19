import { tool } from 'ai';
import { z } from 'zod';
import { todosRepo } from '../../db/repos/todos.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:todos');

export function todoTools(userId: number, userTimezone: string) {
  function parseDeadline(deadline: string | undefined): Date | undefined {
    if (!deadline) return undefined;
    const d = new Date(deadline);
    return isNaN(d.getTime()) ? undefined : d;
  }

  function formatDeadline(d: Date | null, tz: string): string | null {
    if (!d) return null;
    return d.toLocaleString('ru-RU', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });
  }

  return {
    todo_add: tool({
      description: 'Добавить задачу в список дел. Используй когда пользователь говорит "напомни сделать", "добавь в список", "не забыть" и т.д.',
      inputSchema: z.object({
        text: z.string().describe('Текст задачи'),
        deadline: z.string().optional().describe('Дедлайн в формате ISO (например "2025-04-25T15:00:00") — если пользователь указал срок'),
      }),
      execute: async ({ text, deadline }) => {
        const todo = await todosRepo.add({
          userId,
          text,
          deadline: parseDeadline(deadline),
        });
        log.info({ userId, todoId: todo.id, text }, 'Todo added');
        return { added: true, id: todo.id, text, deadline: formatDeadline(todo.deadline, userTimezone) };
      },
    }),

    todo_list: tool({
      description: 'Показать список задач пользователя.',
      inputSchema: z.object({
        include_done: z.boolean().optional().default(false).describe('Включить выполненные задачи'),
      }),
      execute: async ({ include_done }) => {
        const rows = await todosRepo.list(userId, include_done);
        return {
          count: rows.length,
          todos: rows.map(t => ({
            id: t.id,
            text: t.text,
            done: t.done,
            deadline: formatDeadline(t.deadline, userTimezone),
            doneAt: t.doneAt ? formatDeadline(t.doneAt, userTimezone) : null,
          })),
        };
      },
    }),

    todo_done: tool({
      description: 'Отметить задачу выполненной по её ID. Проверь результат: done: true — успех. done: false — задача не найдена (уже выполнена или удалена). Не говори "отметил" если done: false.',
      inputSchema: z.object({
        id: z.number().describe('ID задачи'),
      }),
      execute: async ({ id }) => {
        const ok = await todosRepo.markDone(id, userId);
        log.info({ userId, todoId: id, ok }, 'Todo marked done');
        return { done: ok, id };
      },
    }),

    todo_update: tool({
      description: 'Изменить текст или дедлайн существующей задачи по ID. Проверь результат: updated: true — успех. updated: false — задача не найдена. Не говори "изменил" если updated: false.',
      inputSchema: z.object({
        id: z.number().describe('ID задачи'),
        text: z.string().optional().describe('Новый текст задачи'),
        deadline: z.string().nullable().optional().describe('Новый дедлайн ISO, или null чтобы убрать'),
      }),
      execute: async ({ id, text, deadline }) => {
        const data: { text?: string; deadline?: Date | null } = {};
        if (text !== undefined) data.text = text;
        if (deadline !== undefined) {
          if (deadline === null) {
            data.deadline = null;
          } else {
            const parsed = parseDeadline(deadline);
            if (!parsed) return { error: 'Неверный формат дедлайна. Используй ISO: "2025-04-25T15:00:00"' };
            data.deadline = parsed;
          }
        }
        const ok = await todosRepo.update(id, userId, data);
        log.info({ userId, todoId: id, ok }, 'Todo updated');
        return { updated: ok, id };
      },
    }),

    todo_delete: tool({
      description: 'Удалить задачу по ID. Проверь deleted: true — удалена. deleted: false — не найдена. Не говори "удалил" если deleted: false.',
      inputSchema: z.object({
        id: z.number().describe('ID задачи для удаления'),
      }),
      execute: async ({ id }) => {
        const ok = await todosRepo.delete(id, userId);
        return { deleted: ok, id };
      },
    }),
  };
}
