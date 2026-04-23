import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { embedText } from './embeddings.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('graphrag:query-expansion');

/**
 * Expand user query with seed entity names for better semantic search.
 * If semantic search finds < 2 seeds, falls back to LLM expansion.
 */
export async function expandQuery(
  userId: number,
  query: string,
  _recentMessages: unknown[],
): Promise<string> {
  // Step 1: Heuristic — semantic search for seed entities
  const queryEmbedding = await embedText(query);
  const seeds = await graphEntitiesRepo.searchSimilar(userId, queryEmbedding, 5);

  if (seeds.length >= 2) {
    // Enough seeds — append entity names to query
    const names = seeds.map(s => s.name).join(' ');
    return `${query} ${names}`;
  }

  // Step 2: Fallback — LLM expansion when seeds < 2
  log.debug({ userId, seedCount: seeds.length }, 'Too few seeds, using LLM expansion');
  return quickLlmExpand(query);
}

/**
 * Quick LLM call to expand query with synonyms and context.
 * Uses fast model (google/gemini-2.5-flash) for speed.
 */
export async function quickLlmExpand(query: string): Promise<string> {
  // TODO: Implement actual LLM call
  // For now, return query as-is (will be enhanced in next iteration)
  return query;
}
