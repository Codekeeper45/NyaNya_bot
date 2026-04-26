import { eq, ne, desc, asc, and, gte, gt, count } from 'drizzle-orm';
import { getDb } from '../client.js';
import { messages, type Message } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const messagesRepo = {
  async create(data: {
    userId: number;
    role: string;
    content: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Message> {
    const result = await db().insert(messages).values({
      userId: data.userId,
      role: data.role,
      content: data.content,
      source: data.source ?? 'text',
      metadata: data.metadata ?? {},
    }).returning();
    const row = result[0];
    if (!row) throw new Error('DB insert returned no rows');
    return row;
  },

  async getRecent(userId: number, limit = 20): Promise<Message[]> {
    return db()
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  },

  async getRecentConversation(userId: number, limit = 20): Promise<Message[]> {
    return db()
      .select()
      .from(messages)
      .where(and(eq(messages.userId, userId), ne(messages.source, 'memory_save')))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  },

  async getAfterId(userId: number, afterId: number, limit = 500): Promise<Message[]> {
    return db()
      .select()
      .from(messages)
      .where(and(eq(messages.userId, userId), gt(messages.id, afterId)))
      .orderBy(asc(messages.id))
      .limit(limit);
  },

  async getWeeklyStats(userId: number): Promise<{ totalMessages: number }> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const result = await db()
      .select({ value: count() })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          eq(messages.role, 'user'),
          gte(messages.createdAt, sevenDaysAgo)
        )
      );

    return { totalMessages: Number(result[0]?.value ?? 0) };
  },

  async getLastUserReplyTime(userId: number): Promise<Date | null> {
    const result = await db()
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.role, 'user')))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    return result[0]?.createdAt ?? null;
  },

  async getLastBotMessageTime(userId: number): Promise<Date | null> {
    const result = await db()
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.role, 'assistant')))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    return result[0]?.createdAt ?? null;
  },

  async deleteAllForUser(userId: number): Promise<void> {
    await db().delete(messages).where(eq(messages.userId, userId));
  },
};
