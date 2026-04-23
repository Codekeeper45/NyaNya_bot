import { embedText } from './embeddings.js';
import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { graphRelationshipsRepo } from '../db/repos/graph_relationships.js';
import { graphChunksRepo } from '../db/repos/graph_chunks.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('graphrag:retrieval');

const SEED_ENTITIES_LIMIT = 5;
const CHUNKS_LIMIT = 2;

export async function retrieveContext(userId: number, query: string): Promise<string> {
  try {
    const queryEmbedding = await embedText(query);

    // 1. Semantic entry: find seed entities
    const seedEntities = await graphEntitiesRepo.searchSimilar(userId, queryEmbedding, SEED_ENTITIES_LIMIT);
    if (seedEntities.length === 0) {
      log.debug({ userId }, 'No seed entities found');
      // Fallback: search chunks directly
      const chunks = await graphChunksRepo.searchSimilar(userId, queryEmbedding, CHUNKS_LIMIT);
      return chunks.map(c => `— ${c.content}`).join('\n');
    }

    // 2. Graph traversal: 1-2 hops neighbors
    const seedIds = seedEntities.map(e => e.id);
    const neighbors = await graphRelationshipsRepo.getNeighbors(userId, seedIds);

    // 3. Find relevant chunks
    const chunks = await graphChunksRepo.searchSimilar(userId, queryEmbedding, CHUNKS_LIMIT);

    // 4. Construct context
    const lines: string[] = [];

    if (seedEntities.length > 0) {
      lines.push('Релевантные сущности:');
      for (const e of seedEntities) {
        lines.push(`— ${e.name}: ${e.description}`);
      }
    }

    if (neighbors.length > 0) {
      lines.push('\nСвязи:');
      for (const n of neighbors.slice(0, 10)) {
        lines.push(`— ${n.sourceName} → ${n.description} → ${n.targetName}`);
      }
    }

    if (chunks.length > 0) {
      lines.push('\nИсходные фрагменты:');
      for (const c of chunks) {
        lines.push(`— ${c.content}`);
      }
    }

    const context = lines.join('\n');
    log.debug({ userId, seedCount: seedEntities.length, neighborCount: neighbors.length, chunkCount: chunks.length }, 'Retrieved context');
    return context;
  } catch (err) {
    log.error({ err, userId }, 'Retrieval failed');
    return '';
  }
}
