import { eq } from 'drizzle-orm';
import { getDb } from '../client.js';
import { graphIndexState } from '../schema.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('graphrag:state');

function db() {
  return getDb(config.databaseUrl);
}

export const graphIndexStateRepo = {
  async get(userId: number) {
    const result = await db()
      .select()
      .from(graphIndexState)
      .where(eq(graphIndexState.userId, userId))
      .limit(1);
    return result[0];
  },

  async upsert(userId: number, lastIndexedMessageId: number) {
    await db()
      .insert(graphIndexState)
      .values({ userId, lastIndexedMessageId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: graphIndexState.userId,
        set: { lastIndexedMessageId, updatedAt: new Date() },
      });
  },

  async deleteForUser(userId: number): Promise<void> {
    await db().delete(graphIndexState).where(eq(graphIndexState.userId, userId));
  },
};
