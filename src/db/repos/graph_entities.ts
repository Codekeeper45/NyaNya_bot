import { eq, sql, and } from 'drizzle-orm';
import { getDb } from '../client.js';
import { graphEntities } from '../schema.js';
import type { NewGraphEntity } from '../schema.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('graphrag:entities');

function db() {
  return getDb(config.databaseUrl);
}

export const graphEntitiesRepo = {
  async create(data: NewGraphEntity & { embedding: number[] }): Promise<string> {
    const result = await db()
      .insert(graphEntities)
      .values({
        ...data,
        embedding: sql`${JSON.stringify(data.embedding)}::vector(1536)` as unknown as number[],
      })
      .returning({ id: graphEntities.id });
    const id = result[0]?.id;
    if (!id) throw new Error('Failed to insert graph entity');
    return id;
  },

  async findByName(userId: number, name: string) {
    const result = await db()
      .select()
      .from(graphEntities)
      .where(and(eq(graphEntities.userId, userId), eq(graphEntities.name, name)))
      .limit(1);
    return result[0];
  },

  async searchSimilar(userId: number, embedding: number[], limit = 5): Promise<Array<{ id: string; name: string; description: string; distance: number }>> {
    return db()
      .select({
        id: graphEntities.id,
        name: graphEntities.name,
        description: graphEntities.description,
        distance: sql<number>`${graphEntities.embedding} <=> ${JSON.stringify(embedding)}::vector(1536)`,
      })
      .from(graphEntities)
      .where(eq(graphEntities.userId, userId))
      .orderBy(sql`${graphEntities.embedding} <=> ${JSON.stringify(embedding)}::vector(1536)`)
      .limit(limit);
  },

  async findById(id: string) {
    const result = await db().select().from(graphEntities).where(eq(graphEntities.id, id)).limit(1);
    return result[0];
  },

  async updateDescription(id: string, description: string, embedding: number[]) {
    await db()
      .update(graphEntities)
      .set({
        description,
        embedding: sql`${JSON.stringify(embedding)}::vector(1536)` as unknown as number[],
      })
      .where(eq(graphEntities.id, id));
  },

  async deleteAllForUser(userId: number) {
    await db().delete(graphEntities).where(eq(graphEntities.userId, userId));
    log.info({ userId }, 'Deleted all entities for user');
  },

  async findAllForUser(userId: number) {
    return db()
      .select()
      .from(graphEntities)
      .where(eq(graphEntities.userId, userId))
      .orderBy(graphEntities.createdAt);
  },
};
