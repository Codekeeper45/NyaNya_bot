import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { graphRelationshipsRepo } from '../db/repos/graph_relationships.js';
import { graphEntityUsagesRepo } from '../db/repos/graph_entity_usages.js';
import { expandQuery } from './query-expansion.js';
import { embedText } from './embeddings.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('graphrag:subgraph');
const CONTEXT_BUDGET = 1500; // chars

export async function buildFloatingSubgraph(
  userId: number,
  query: string,
  recentMessages: unknown[],
  _currentMessageId: number,
): Promise<string> {
  // 1. Query Expansion
  const expandedQuery = await expandQuery(userId, query, recentMessages);

  // 2. Get seed entities from expanded query
  const queryEmbedding = await embedText(expandedQuery);
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
    log.debug({ userId }, 'No active entities for subgraph');
    return '';
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
  const subgraphEntities = scoredEntities.filter(e => subgraphEntityIds.includes(e.id));

  // 9. Sort by finalScore
  subgraphEntities.sort((a, b) => b.finalScore - a.finalScore);

  // 10. Format with budget
  return formatSubgraphContext(subgraphEntities, neighbors, CONTEXT_BUDGET);
}

function formatSubgraphContext(
  entities: Array<{ name: string; description: string }>,
  relationships: Array<{ sourceName: string; description: string; targetName: string }>,
  maxChars: number,
): string {
  const lines: string[] = [];
  let chars = 0;

  // Entities first
  for (const e of entities) {
    const line = `— ${e.name}: ${e.description}`;
    if (chars + line.length > maxChars) break;
    lines.push(line);
    chars += line.length + 1;
  }

  // Relationships (top 10)
  const topRels = relationships.slice(0, 10);
  for (const r of topRels) {
    const line = `— ${r.sourceName} → ${r.description} → ${r.targetName}`;
    if (chars + line.length > maxChars) break;
    lines.push(line);
    chars += line.length + 1;
  }

  return lines.join('\n');
}
