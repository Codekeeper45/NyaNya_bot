import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../client.js';
import { graphEntityMentions } from '../schema.js';
import type { NewGraphEntityMention } from '../schema.js';
import { config } from '../../config.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('graphrag:mentions');

function db() {
  return getDb(config.databaseUrl);
}

export const graphEntityMentionsRepo = {
  async create(data: NewGraphEntityMention): Promise<string> {
    const result = await db()
      .insert(graphEntityMentions)
      .values(data)
      .returning({ id: graphEntityMentions.id });
    const id = result[0]?.id;
    if (!id) throw new Error('Failed to insert entity mention');
    return id;
  },

  async findByEntityId(entityId: string) {
    return db()
      .select()
      .from(graphEntityMentions)
      .where(eq(graphEntityMentions.entityId, entityId));
  },

  async deleteAllForChunks(chunkIds: string[]) {
    if (chunkIds.length === 0) return;
    await db()
      .delete(graphEntityMentions)
      .where(inArray(graphEntityMentions.chunkId, chunkIds));
  },
};
