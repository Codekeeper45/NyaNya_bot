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
  async create(data: NewGraphRelationship): Promise<string | null> {
    const result = await db()
      .insert(graphRelationships)
      .values(data)
      .onConflictDoNothing()
      .returning({ id: graphRelationships.id });
    return result[0]?.id ?? null;
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

  async getNeighborsMultiHop(
    userId: number,
    entityIds: string[],
    maxDepth = 2,
    maxPerHop = 20,
  ): Promise<Array<{
    sourceId: string;
    sourceName: string;
    targetId: string;
    targetName: string;
    description: string;
    weight: number;
    hop: number;
  }>> {
    if (entityIds.length === 0) return [];

    const visited = new Set<string>(entityIds);
    const allRels: Array<{
      sourceId: string;
      targetId: string;
      description: string;
      weight: number;
      hop: number;
    }> = [];

    let currentIds = [...entityIds];

    for (let hop = 1; hop <= maxDepth && currentIds.length > 0; hop++) {
      const rels = await db()
        .select()
        .from(graphRelationships)
        .where(
          and(
            eq(graphRelationships.userId, userId),
            or(
              inArray(graphRelationships.sourceId, currentIds),
              inArray(graphRelationships.targetId, currentIds),
            ),
          ),
        )
        .limit(maxPerHop);

      const currentSet = new Set(currentIds);
      const nextIds: string[] = [];
      for (const r of rels) {
        const otherId = currentSet.has(r.sourceId) ? r.targetId : r.sourceId;
        if (!visited.has(otherId)) {
          visited.add(otherId);
          nextIds.push(otherId);
        }
        allRels.push({
          sourceId: r.sourceId,
          targetId: r.targetId,
          description: r.description,
          weight: r.weight,
          hop,
        });
      }
      currentIds = nextIds;
    }

    if (allRels.length === 0) return [];

    const allEntityIds = [...new Set([...allRels.map(r => r.sourceId), ...allRels.map(r => r.targetId)])];
    const entities = await db()
      .select({ id: graphEntities.id, name: graphEntities.name })
      .from(graphEntities)
      .where(inArray(graphEntities.id, allEntityIds));

    const nameMap = new Map(entities.map(e => [e.id, e.name]));

    return allRels.map(r => ({
      sourceId: r.sourceId,
      sourceName: nameMap.get(r.sourceId) ?? 'Unknown',
      targetId: r.targetId,
      targetName: nameMap.get(r.targetId) ?? 'Unknown',
      description: r.description,
      weight: r.weight,
      hop: r.hop,
    }));
  },
};
