import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../client.js';
import { graphFacts } from '../schema.js';
import type { NewGraphFact } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

function sanitizeText(text: string): string {
  return text.replace(/\x00/g, '').replace(/[\uD800-\uDFFF]/g, '');
}

export const graphFactsRepo = {
  async upsert(data: NewGraphFact & { embedding: number[] }): Promise<string | null> {
    const result = await db()
      .insert(graphFacts)
      .values({
        ...data,
        statement: sanitizeText(data.statement),
        objectText: sanitizeText(data.objectText),
        embedding: sql`${JSON.stringify(data.embedding)}::vector(1536)` as unknown as number[],
      })
      .onConflictDoUpdate({
        target: [graphFacts.userId, graphFacts.factKey],
        set: { confidence: sql`GREATEST(${graphFacts.confidence}, excluded.confidence)` },
      })
      .returning({ id: graphFacts.id });
    return result[0]?.id ?? null;
  },

  async findByFactKey(userId: number, factKey: string) {
    const result = await db()
      .select()
      .from(graphFacts)
      .where(and(eq(graphFacts.userId, userId), eq(graphFacts.factKey, factKey)))
      .limit(1);
    return result[0];
  },

  async searchSimilar(userId: number, embedding: number[], limit = 5): Promise<Array<{ id: string; statement: string; createdAt: Date; distance: number }>> {
    const embeddingJson = JSON.stringify(embedding);
    const distanceExpr = sql<number>`${graphFacts.embedding} <=> ${embeddingJson}::vector(1536)`;
    return db()
      .select({
        id: graphFacts.id,
        statement: graphFacts.statement,
        createdAt: graphFacts.createdAt,
        distance: distanceExpr,
      })
      .from(graphFacts)
      .where(eq(graphFacts.userId, userId))
      .orderBy(sql`${distanceExpr} ASC`)
      .limit(limit);
  },

  async deleteAllForUser(userId: number) {
    await db().delete(graphFacts).where(eq(graphFacts.userId, userId));
  },
};
