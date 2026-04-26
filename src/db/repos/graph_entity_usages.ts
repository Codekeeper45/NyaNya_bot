import { and, eq, sql, desc } from 'drizzle-orm';
import { getDb } from '../client.js';
import { graphEntities, graphEntityUsages, messages } from '../schema.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('graphrag:usages');

function db() {
  return getDb(config.databaseUrl);
}

export const graphEntityUsagesRepo = {
  async recordUsage(userId: number, entityId: string, messageId: number): Promise<void> {
    const [entity] = await db()
      .select({ id: graphEntities.id })
      .from(graphEntities)
      .where(and(eq(graphEntities.userId, userId), eq(graphEntities.id, entityId)))
      .limit(1);
    const [message] = await db()
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.id, messageId)))
      .limit(1);
    if (!entity || !message) {
      throw new Error('Cross-user graph usage rejected');
    }

    await db()
      .insert(graphEntityUsages)
      .values({ userId, entityId, messageId })
      .returning({ id: graphEntityUsages.id });
    log.debug({ userId, entityId, messageId }, 'Recorded entity usage');
  },

  async findRecentForUser(userId: number, messageLimit = 5): Promise<string[]> {
    const usages = await db()
      .select({ entityId: graphEntityUsages.entityId, messageId: graphEntityUsages.messageId })
      .from(graphEntityUsages)
      .where(eq(graphEntityUsages.userId, userId))
      .orderBy(desc(graphEntityUsages.messageId))
      .limit(messageLimit * 3); // Get more than limit since we dedupe

    // Return unique entity IDs preserving order of first appearance
    const seen = new Set<string>();
    const result: string[] = [];
    for (const u of usages) {
      if (!seen.has(u.entityId)) {
        seen.add(u.entityId);
        result.push(u.entityId);
      }
    }
    return result;
  },

  async findLastUsedWithin(userId: number, minutes: number): Promise<string[]> {
    const safeMinutes = Math.max(1, Math.floor(minutes));
    const rows = await db()
      .select({ entityId: graphEntityUsages.entityId })
      .from(graphEntityUsages)
      .where(and(
        eq(graphEntityUsages.userId, userId),
        sql`${graphEntityUsages.usedAt} > NOW() - (${safeMinutes} * interval '1 minute')`,
      ))
      .groupBy(graphEntityUsages.entityId);

    return rows.map(r => r.entityId);
  },

  async deleteAllForUser(userId: number): Promise<void> {
    await db().delete(graphEntityUsages).where(eq(graphEntityUsages.userId, userId));
    log.info({ userId }, 'Deleted all entity usages for user');
  },
};
