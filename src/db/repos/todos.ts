import { eq, and, asc } from 'drizzle-orm';
import { getDb } from '../client.js';
import { todos, type Todo } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const todosRepo = {
  async add(data: {
    userId: number;
    text: string;
    deadline?: Date | null;
  }): Promise<Todo> {
    const [row] = await db().insert(todos).values(data).returning();
    return row;
  },

  async list(userId: number, includeDone = false): Promise<Todo[]> {
    return db()
      .select()
      .from(todos)
      .where(includeDone ? eq(todos.userId, userId) : and(eq(todos.userId, userId), eq(todos.done, false)))
      .orderBy(asc(todos.createdAt));
  },

  async markDone(id: number, userId: number): Promise<boolean> {
    const result = await db()
      .update(todos)
      .set({ done: true, doneAt: new Date() })
      .where(and(eq(todos.id, id), eq(todos.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  },

  async update(id: number, userId: number, data: { text?: string; deadline?: Date | null }): Promise<boolean> {
    const result = await db()
      .update(todos)
      .set(data)
      .where(and(eq(todos.id, id), eq(todos.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  },

  async delete(id: number, userId: number): Promise<boolean> {
    const result = await db()
      .delete(todos)
      .where(and(eq(todos.id, id), eq(todos.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  },

  async deleteAllForUser(userId: number): Promise<void> {
    await db().delete(todos).where(eq(todos.userId, userId));
  },
};
