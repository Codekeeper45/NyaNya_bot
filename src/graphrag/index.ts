import { indexUserMessages, indexAllUsers } from './indexer.js';
import { retrieveContext } from './retrieval.js';
import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { graphRelationshipsRepo } from '../db/repos/graph_relationships.js';
import { graphChunksRepo } from '../db/repos/graph_chunks.js';
import { graphEntityMentionsRepo } from '../db/repos/graph_entity_mentions.js';
import { graphEntityUsagesRepo } from '../db/repos/graph_entity_usages.js';
import { createChildLogger } from '../lib/logger.js';
import type { GraphEntity } from '../db/schema.js';

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
   * Retrieve ALL entities and relationships for a user.
   * Used by /who — no semantic filtering, just dumps everything.
   */
  async retrieveAll(userId: number): Promise<string> {
    try {
      const entities = await graphEntitiesRepo.findAllForUser(userId);
      const relationships = await graphRelationshipsRepo.getAllForUser(userId);

      if (entities.length === 0 && relationships.length === 0) {
        return '';
      }

      const lines: string[] = [];
      if (entities.length > 0) {
        lines.push('🧠 Сущности:');
        for (const e of entities) {
          lines.push(`— ${e.name}: ${e.description}`);
        }
      }
      if (relationships.length > 0) {
        lines.push('\n🔗 Связи:');
        for (const r of relationships.slice(0, 20)) {
          lines.push(`— ${r.sourceName} → ${r.description} → ${r.targetName}`);
        }
      }
      return lines.join('\n');
    } catch (err) {
      log.error({ err, userId }, 'retrieveAll failed');
      return '';
    }
  },

  /**
   * Retrieve ALL raw entities and relationships for a user.
   * Returns structured data for custom formatting.
   */
  async retrieveAllRaw(userId: number): Promise<{ entities: GraphEntity[]; relationships: Awaited<ReturnType<typeof graphRelationshipsRepo.getAllForUser>> } | null> {
    try {
      const entities = await graphEntitiesRepo.findAllForUser(userId);
      const relationships = await graphRelationshipsRepo.getAllForUser(userId);

      if (entities.length === 0 && relationships.length === 0) {
        return null;
      }

      return { entities, relationships };
    } catch (err) {
      log.error({ err, userId }, 'retrieveAllRaw failed');
      return null;
    }
  },

  /**
   * Delete all graph data for a user.
   */
  async deleteAllForUser(userId: number): Promise<void> {
    const chunks = await graphChunksRepo.findByUser(userId);
    await graphEntityMentionsRepo.deleteAllForChunks(chunks.map((c: { id: string }) => c.id));
    await graphEntityUsagesRepo.deleteAllForUser(userId);
    await graphRelationshipsRepo.deleteAllForUser(userId);
    await graphEntitiesRepo.deleteAllForUser(userId);
    await graphChunksRepo.deleteAllForUser(userId);
    log.info({ userId }, 'GraphRAG data deleted');
  },
};
