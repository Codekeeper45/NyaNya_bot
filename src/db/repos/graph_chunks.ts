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

export const graphChunksRepo = {
  async create(data: NewGraphChunk & { embedding: number[] }): Promise<string> {
    const result = await db()
      .insert(graphChunks)
      .values({
        ...data,
        embedding: sql`${JSON.stringify(data.embedding)}::vector(1536)` as unknown as number[],
      })
      .returning({ id: graphChunks.id });
    const id = result[0]?.id;
    if (!id) throw new Error('Failed to insert graph chunk');
    return id;
  },

  async searchSimilar(userId: number, embedding: number[], limit = 5): Promise<Array<{ id: string; content: string; distance: number }>> {
    return db()
      .select({
        id: graphChunks.id,
        content: graphChunks.content,
        distance: sql<number>`${graphChunks.embedding} <=> ${JSON.stringify(embedding)}::vector(1536)`,
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
