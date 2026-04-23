import { eq, and, or, inArray } from 'drizzle-orm';
import { getDb } from '../client.js';
import { graphRelationships, graphEntities } from '../schema.js';
import type { NewGraphRelationship } from '../schema.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('graphrag:relationships');

function db() {
  return getDb(config.databaseUrl);
}

export const graphRelationshipsRepo = {
  async create(data: NewGraphRelationship): Promise<string> {
    const result = await db()
      .insert(graphRelationships)
      .values(data)
      .returning({ id: graphRelationships.id });
    const id = result[0]?.id;
    if (!id) throw new Error('Failed to insert graph relationship');
    return id;
  },

  async findBySource(userId: number, sourceId: string) {
    return db()
      .select()
      .from(graphRelationships)
      .where(and(eq(graphRelationships.userId, userId), eq(graphRelationships.sourceId, sourceId)));
  },

  async getNeighbors(userId: number, entityIds: string[]): Promise<Array<{
    sourceId: string;
    sourceName: string;
    targetId: string;
    targetName: string;
    description: string;
    weight: number;
  }>> {
    if (entityIds.length === 0) return [];

    const rels = await db()
      .select()
      .from(graphRelationships)
      .where(
        and(
          eq(graphRelationships.userId, userId),
          or(
            inArray(graphRelationships.sourceId, entityIds),
            inArray(graphRelationships.targetId, entityIds),
          ),
        ),
      )
      .limit(50);

    const allEntityIds = [...new Set([...rels.map((r: typeof graphRelationships.$inferSelect) => r.sourceId), ...rels.map((r: typeof graphRelationships.$inferSelect) => r.targetId)])];
    if (allEntityIds.length === 0) return [];

    const entities = await db()
      .select({ id: graphEntities.id, name: graphEntities.name })
      .from(graphEntities)
      .where(inArray(graphEntities.id, allEntityIds));

    const nameMap = new Map(entities.map(e => [e.id, e.name]));

    return rels.map((r: typeof graphRelationships.$inferSelect) => ({
      sourceId: r.sourceId,
      sourceName: nameMap.get(r.sourceId) ?? 'Unknown',
      targetId: r.targetId,
      targetName: nameMap.get(r.targetId) ?? 'Unknown',
      description: r.description,
      weight: r.weight,
    }));
  },

  async deleteAllForUser(userId: number) {
    await db().delete(graphRelationships).where(eq(graphRelationships.userId, userId));
  },

  async getAllForUser(userId: number) {
    const rels = await db()
      .select()
      .from(graphRelationships)
      .where(eq(graphRelationships.userId, userId))
      .limit(50);

    const allEntityIds = [...new Set([...rels.map(r => r.sourceId), ...rels.map(r => r.targetId)])];
    if (allEntityIds.length === 0) return [];

    const entities = await db()
      .select({ id: graphEntities.id, name: graphEntities.name })
      .from(graphEntities)
      .where(inArray(graphEntities.id, allEntityIds));

    const nameMap = new Map(entities.map(e => [e.id, e.name]));

    return rels.map(r => ({
      sourceId: r.sourceId,
      sourceName: nameMap.get(r.sourceId) ?? 'Unknown',
      targetId: r.targetId,
      targetName: nameMap.get(r.targetId) ?? 'Unknown',
      description: r.description,
      weight: r.weight,
    }));
  },
};
