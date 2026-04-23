import { indexUserMessages, indexAllUsers } from './indexer.js';
import { retrieveContext } from './retrieval.js';
import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { graphRelationshipsRepo } from '../db/repos/graph_relationships.js';
import { graphChunksRepo } from '../db/repos/graph_chunks.js';
import { graphEntityMentionsRepo } from '../db/repos/graph_entity_mentions.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('graphrag');

export const graphRag = {
  /**
   * Index new messages for a single user.
   */
  async indexUser(userId: number): Promise<void> {
    await indexUserMessages(userId);
  },

  /**
   * Index all active users (called by scheduled job).
   */
  async indexAll(): Promise<void> {
    await indexAllUsers();
  },

  /**
   * Retrieve relevant context for a user query.
   * Returns empty string if retrieval fails (graceful degradation).
   */
  async retrieve(userId: number, query: string): Promise<string> {
    return retrieveContext(userId, query);
  },

  /**
   * Delete all graph data for a user.
   */
  async deleteAllForUser(userId: number): Promise<void> {
    const chunks = await graphChunksRepo.findByUser(userId);
    await graphEntityMentionsRepo.deleteAllForChunks(chunks.map((c: { id: string }) => c.id));
    await graphRelationshipsRepo.deleteAllForUser(userId);
    await graphEntitiesRepo.deleteAllForUser(userId);
    await graphChunksRepo.deleteAllForUser(userId);
    log.info({ userId }, 'GraphRAG data deleted');
  },
};
