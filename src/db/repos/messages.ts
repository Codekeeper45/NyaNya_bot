import { eq, desc } from 'drizzle-orm';
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
    return result[0];
  },

  async getRecent(userId: number, limit = 20): Promise<Message[]> {
    return db()
      .select()
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  },

  async getLastUserMessageTime(userId: number): Promise<Date | null> {
    const result = await db()
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    return result[0]?.createdAt ?? null;
  },
};
