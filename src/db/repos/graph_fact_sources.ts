import { inArray } from 'drizzle-orm';
import { getDb } from '../client.js';
import { graphFactSources } from '../schema.js';
import type { NewGraphFactSource } from '../schema.js';
import { config } from '../../config.js';

function db() {
  return getDb(config.databaseUrl);
}

export const graphFactSourcesRepo = {
  async create(data: NewGraphFactSource): Promise<string | null> {
    const result = await db()
      .insert(graphFactSources)
      .values(data)
      .onConflictDoNothing()
      .returning({ id: graphFactSources.id });
    return result[0]?.id ?? null;
  },

  async deleteAllForChunks(chunkIds: string[]) {
    if (chunkIds.length === 0) return;
    await db().delete(graphFactSources).where(inArray(graphFactSources.chunkId, chunkIds));
  },
};
