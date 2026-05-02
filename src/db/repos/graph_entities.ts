import { eq, sql, and, inArray, notInArray } from 'drizzle-orm';
import { getDb } from '../client.js';
import { graphEntities } from '../schema.js';
import type { NewGraphEntity } from '../schema.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('graphrag:entities');

function db() {
  return getDb(config.databaseUrl);
}

function sanitizeText(text: string): string {
  return text.replace(/\x00/g, '').replace(/[\uD800-\uDFFF]/g, '');
}

export const graphEntitiesRepo = {
  async create(data: NewGraphEntity & { embedding: number[] }): Promise<string> {
    const result = await db()
      .insert(graphEntities)
      .values({
        ...data,
        name: sanitizeText(data.name),
        description: sanitizeText(data.description),
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

  async findByIdForUser(userId: number, id: string) {
    const result = await db()
      .select()
      .from(graphEntities)
      .where(and(eq(graphEntities.userId, userId), eq(graphEntities.id, id)))
      .limit(1);
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

  async updateUsage(id: string, importanceDelta = 1) {
    await db()
      .update(graphEntities)
      .set({
        lastUsedAt: new Date(),
        useCount: sql`${graphEntities.useCount} + 1`,
        importanceScore: sql`LEAST(${graphEntities.importanceScore} + ${importanceDelta}, 100)`,
      })
      .where(eq(graphEntities.id, id));
  },

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return db()
      .select()
      .from(graphEntities)
      .where(inArray(graphEntities.id, ids));
  },

  async findByIdsForUser(userId: number, ids: string[]) {
    if (ids.length === 0) return [];
    return db()
      .select()
      .from(graphEntities)
      .where(and(eq(graphEntities.userId, userId), inArray(graphEntities.id, ids)));
  },

  async findWithScoring(
    userId: number,
    embedding: number[],
    excludeIds: string[] = [],
    limit = 20,
  ): Promise<Array<{
    id: string;
    name: string;
    description: string;
    distance: number;
    importanceScore: number;
    lastUsedAt: Date | null;
    useCount: number;
    finalScore: number;
  }>> {
    const embeddingJson = JSON.stringify(embedding);
    const distanceExpr = sql<number>`${graphEntities.embedding} <=> ${embeddingJson}::vector(1536)`;
    const finalScoreExpr = sql<number>`
      ((1 - (${distanceExpr})) * (${graphEntities.importanceScore} / 100.0))
      - CASE WHEN NOW() - ${graphEntities.lastUsedAt} < interval '5 minutes' THEN 0.3 ELSE 0 END
    `;

    // Build where clause
    let whereClause = eq(graphEntities.userId, userId);
    if (excludeIds.length > 0) {
      whereClause = and(whereClause, notInArray(graphEntities.id, excludeIds))!;
    }

    return db()
      .select({
        id: graphEntities.id,
        name: graphEntities.name,
        description: graphEntities.description,
        distance: distanceExpr,
        importanceScore: graphEntities.importanceScore,
        lastUsedAt: graphEntities.lastUsedAt,
        useCount: graphEntities.useCount,
        finalScore: finalScoreExpr,
      })
      .from(graphEntities)
      .where(whereClause)
      .orderBy(sql`${finalScoreExpr} DESC`, sql`${distanceExpr} ASC`)
      .limit(limit);
  },

  async findByIdsWithScoring(
    userId: number,
    ids: string[],
    embedding: number[],
  ): Promise<Array<{
    id: string;
    name: string;
    description: string;
    distance: number;
    importanceScore: number;
    lastUsedAt: Date | null;
    useCount: number;
    finalScore: number;
  }>> {
    if (ids.length === 0) return [];
    const embeddingJson = JSON.stringify(embedding);
    const distanceExpr = sql<number>`${graphEntities.embedding} <=> ${embeddingJson}::vector(1536)`;
    const finalScoreExpr = sql<number>`
      ((1 - (${distanceExpr})) * (${graphEntities.importanceScore} / 100.0))
      - CASE WHEN NOW() - ${graphEntities.lastUsedAt} < interval '5 minutes' THEN 0.3 ELSE 0 END
    `;
    return db()
      .select({
        id: graphEntities.id,
        name: graphEntities.name,
        description: graphEntities.description,
        distance: distanceExpr,
        importanceScore: graphEntities.importanceScore,
        lastUsedAt: graphEntities.lastUsedAt,
        useCount: graphEntities.useCount,
        finalScore: finalScoreExpr,
      })
      .from(graphEntities)
      .where(and(eq(graphEntities.userId, userId), inArray(graphEntities.id, ids)))
      .orderBy(sql`${finalScoreExpr} DESC`, sql`${distanceExpr} ASC`);
  },
};
