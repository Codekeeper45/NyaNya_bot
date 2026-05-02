import { eq, sql } from 'drizzle-orm';
import { getDb } from '../client.js';
import { graphChunks } from '../schema.js';
import type { NewGraphChunk } from '../schema.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('graphrag:chunks');

function db() {
  return getDb(config.databaseUrl);
}

/** Remove invalid UTF-8 sequences, null bytes, and lone surrogates that PostgreSQL text rejects. */
function sanitizeText(text: string): string {
  return text
    .replace(/\x00/g, '')                    // null bytes
    .replace(/[\uD800-\uDFFF]/g, '');        // lone UTF-16 surrogates
}

export const graphChunksRepo = {
  async create(data: NewGraphChunk & { embedding: number[] }): Promise<string> {
    const cleanContent = sanitizeText(data.content);
    const result = await db()
      .insert(graphChunks)
      .values({
        ...data,
        content: cleanContent,
        embedding: sql`${JSON.stringify(data.embedding)}::vector(1536)` as unknown as number[],
      })
      .returning({ id: graphChunks.id });
    const id = result[0]?.id;
    if (!id) throw new Error('Failed to insert graph chunk');
    return id;
  },

  async searchSimilar(userId: number, embedding: number[], limit = 5): Promise<Array<{ id: string; content: string; distance: number; createdAt: Date }>> {
    return db()
      .select({
        id: graphChunks.id,
        content: graphChunks.content,
        distance: sql<number>`${graphChunks.embedding} <=> ${JSON.stringify(embedding)}::vector(1536)`,
        createdAt: graphChunks.createdAt,
      })
      .from(graphChunks)
      .where(eq(graphChunks.userId, userId))
      .orderBy(sql`${graphChunks.embedding} <=> ${JSON.stringify(embedding)}::vector(1536)`)
      .limit(limit);
  },

  async findById(id: string) {
    const result = await db().select().from(graphChunks).where(eq(graphChunks.id, id)).limit(1);
    return result[0];
  },

  async findByUser(userId: number) {
    return db().select({ id: graphChunks.id }).from(graphChunks).where(eq(graphChunks.userId, userId));
  },

  async deleteAllForUser(userId: number) {
    await db().delete(graphChunks).where(eq(graphChunks.userId, userId));
  },
};
