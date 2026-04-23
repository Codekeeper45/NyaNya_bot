import { eq, sql } from 'drizzle-orm';
import { getDb } from '../client.js';
import { users, type User, type NewUser } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const usersRepo = {
  async findByTelegramId(telegramUserId: number): Promise<User | undefined> {
    const result = await db().select().from(users).where(eq(users.telegramUserId, telegramUserId)).limit(1);
    return result[0];
  },

  async findById(id: number): Promise<User | undefined> {
    const result = await db().select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  },

  async upsert(data: { telegramUserId: number; name?: string }): Promise<User> {
    const result = await db()
      .insert(users)
      .values({ telegramUserId: data.telegramUserId, name: data.name ?? 'User' })
      .onConflictDoUpdate({
        target: users.telegramUserId,
        set: { updatedAt: sql`now()` },
      })
      .returning();
    const row = result[0];
    if (!row) throw new Error('DB upsert returned no rows');
    return row;
  },

  async update(id: number, data: Partial<Omit<NewUser, 'id' | 'createdAt'>>): Promise<void> {
    await db().update(users).set({ ...data, updatedAt: new Date() }).where(eq(users.id, id));
  },

  async findAllActive(): Promise<User[]> {
    return db().select().from(users).where(eq(users.paused, false));
  },
};
