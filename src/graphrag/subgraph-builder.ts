import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { graphRelationshipsRepo } from '../db/repos/graph_relationships.js';
import { graphEntityUsagesRepo } from '../db/repos/graph_entity_usages.js';
import { expandQuery } from './query-expansion.js';
import { embedText } from './embeddings.js';
import { contextCache, getLastQuery, isSimilarToRecentQuery, recordLastQuery } from './cache.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('graphrag:subgraph');
const CONTEXT_BUDGET = 1500; // chars
const MIN_ENTITY_FINAL_SCORE = 0.05;

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
}

function contextCacheKey(userId: number, query: string): string {
  return `${userId}:${normalizeQuery(query)}`;
}

export interface SubgraphResult {
  context: string;
  entityIds: string[];
}

export async function buildFloatingSubgraph(
  userId: number,
  query: string,
  recentMessages: unknown[],
  _currentMessageId: number,
): Promise<SubgraphResult> {
  // 1. Query Expansion
  const expandedQuery = await expandQuery(userId, query, recentMessages);

  // 2. Get seed entities from expanded query
  const queryEmbedding = await embedText(expandedQuery);

  const cacheKey = contextCacheKey(userId, query);
  const cached = contextCache.get(cacheKey);
  if (cached) {
    log.info({ userId, contextLen: cached.context.length, entityCount: cached.entityIds.length }, 'Subgraph cache hit');
    return cached;
  }
  log.info({ userId }, 'Subgraph cache miss');

  // 2a. Dedup: if query is very similar to recent one, reuse cached context
  if (isSimilarToRecentQuery(userId, queryEmbedding)) {
    const lastQuery = getLastQuery(userId);
    const previousCached = lastQuery ? contextCache.get(contextCacheKey(userId, lastQuery.text)) : undefined;
    if (previousCached) {
      log.info({ userId }, 'Query similar to recent — reusing cached subgraph');
      return previousCached;
    }
    log.info({ userId }, 'Query similar to recent but cache unavailable — rebuilding subgraph');
  }
  recordLastQuery(userId, query, queryEmbedding);

  const seedEntities = await graphEntitiesRepo.findWithScoring(
    userId,
    queryEmbedding,
    [],
    5,
  );

  const seedIds = seedEntities.map(e => e.id);

  // 3. Get history entities (last 5 messages)
  const historyEntityIds = await graphEntityUsagesRepo.findRecentForUser(userId, 5);

  // 4. Combine active entities
  const activeIds = [...new Set([...seedIds, ...historyEntityIds])];

  if (activeIds.length === 0) {
    log.info({ userId }, 'No active entities for subgraph');
    return { context: '', entityIds: [] };
  }

  // 5. Graph traversal (1-2 hops)
  const neighbors = await graphRelationshipsRepo.getNeighborsMultiHop(
    userId,
    activeIds,
    2,
    20,
  );

  // 6. Collect all entity IDs in subgraph
  const subgraphEntityIds = [...new Set([
    ...activeIds,
    ...neighbors.map(n => n.targetId),
    ...neighbors.map(n => n.sourceId),
  ])];

  // 7. Score all subgraph entities
  const scoredEntities = await graphEntitiesRepo.findWithScoring(
    userId,
    queryEmbedding,
    [],
    40,
  );

  // 8. Filter to subgraph only
  const subgraphEntities = scoredEntities.filter(
    e => subgraphEntityIds.includes(e.id) && e.finalScore >= MIN_ENTITY_FINAL_SCORE,
  );

  // 9. Sort by finalScore
  subgraphEntities.sort((a, b) => b.finalScore - a.finalScore);

  // 10. Format with budget
  const context = formatSubgraphContext(subgraphEntities, neighbors, CONTEXT_BUDGET);

  log.info({
    userId,
    seedCount: seedEntities.length,
    neighborCount: neighbors.length,
    subgraphEntityCount: subgraphEntities.length,
    contextLen: context.length,
  }, 'Subgraph built');

  // Return both context and entity IDs for usage tracking
  const usedEntityIds = subgraphEntities.map(e => e.id);
  const result: SubgraphResult = { context, entityIds: usedEntityIds };

  // Cache result for this user
  contextCache.set(cacheKey, result);

  return result;
}

function formatSubgraphContext(
  entities: Array<{ name: string; description: string }>,
  relationships: Array<{ sourceName: string; description: string; targetName: string }>,
  maxChars: number,
): string {
  const lines: string[] = [];
  let chars = 0;

  // Entities first
  const seenLines = new Set<string>();
  for (const e of entities) {
    const line = `— ${e.name}: ${e.description}`;
    if (seenLines.has(line)) continue;
    if (chars + line.length > maxChars) break;
    seenLines.add(line);
    lines.push(line);
    chars += line.length + 1;
  }

  // Relationships (top 10)
  const topRels = relationships.slice(0, 10);
  for (const r of topRels) {
    const line = `— ${r.sourceName} → ${r.description} → ${r.targetName}`;
    if (seenLines.has(line)) continue;
    if (chars + line.length > maxChars) break;
    seenLines.add(line);
    lines.push(line);
    chars += line.length + 1;
  }

  return lines.join('\n');
}
