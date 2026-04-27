import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../client.js';
import { graphEntityAliases } from '../schema.js';
import type { NewGraphEntityAlias } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const graphEntityAliasesRepo = {
  async upsert(data: NewGraphEntityAlias): Promise<string | null> {
    const result = await db()
      .insert(graphEntityAliases)
      .values(data)
      .onConflictDoNothing()
      .returning({ id: graphEntityAliases.id });
    return result[0]?.id ?? null;
  },

  async findByNormalizedAlias(userId: number, normalizedAlias: string) {
    const result = await db()
      .select()
      .from(graphEntityAliases)
      .where(and(
        eq(graphEntityAliases.userId, userId),
        eq(graphEntityAliases.normalizedAlias, normalizedAlias),
      ))
      .limit(1);
    return result[0];
  },

  async findByEntityIds(entityIds: string[]) {
    if (entityIds.length === 0) return [];
    return db()
      .select()
      .from(graphEntityAliases)
      .where(inArray(graphEntityAliases.entityId, entityIds));
  },

  async deleteAllForUser(userId: number) {
    await db().delete(graphEntityAliases).where(eq(graphEntityAliases.userId, userId));
  },
};
