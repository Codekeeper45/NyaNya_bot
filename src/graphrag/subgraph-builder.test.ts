import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contextCache, lastQueryCache, embeddingCache } from './cache.js';

vi.mock('/src/db/repos/graph_entities.js', () => ({
  graphEntitiesRepo: {
    findWithScoring: vi.fn(),
  },
}));

vi.mock('/src/db/repos/graph_relationships.js', () => ({
  graphRelationshipsRepo: {
    getNeighborsMultiHop: vi.fn(),
  },
}));

vi.mock('/src/db/repos/graph_entity_usages.js', () => ({
  graphEntityUsagesRepo: {
    findRecentForUser: vi.fn(),
  },
}));

vi.mock('./query-expansion.js', () => ({
  expandQuery: vi.fn(),
}));

vi.mock('./embeddings.js', () => ({
  embedText: vi.fn(),
}));

import { buildFloatingSubgraph } from './subgraph-builder.js';
import { graphEntitiesRepo } from '/src/db/repos/graph_entities.js';
import { graphRelationshipsRepo } from '/src/db/repos/graph_relationships.js';
import { graphEntityUsagesRepo } from '/src/db/repos/graph_entity_usages.js';
import { expandQuery } from './query-expansion.js';
import { embedText } from './embeddings.js';

describe('buildFloatingSubgraph', () => {
  beforeEach(() => {
    contextCache.clear();
    lastQueryCache.clear();
    embeddingCache.clear();
  });
  it('returns formatted context with entities and relationships', async () => {
    (expandQuery as ReturnType<typeof vi.fn>).mockResolvedValue('расскажи обо мне Emir');
    (embedText as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2]);

    (graphEntitiesRepo.findWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'e1', name: 'Emir', description: 'Developer', finalScore: 0.9 },
      { id: 'e2', name: 'Almaty', description: 'City', finalScore: 0.8 },
    ]);

    (graphEntityUsagesRepo.findRecentForUser as ReturnType<typeof vi.fn>).mockResolvedValue(['e3']);

    (graphRelationshipsRepo.getNeighborsMultiHop as ReturnType<typeof vi.fn>).mockResolvedValue([
      { sourceId: 'e1', sourceName: 'Emir', targetId: 'e2', targetName: 'Almaty', description: 'живёт в', weight: 1, hop: 1 },
    ]);

    const result = await buildFloatingSubgraph(1, 'расскажи обо мне', [], 999);

    expect(expandQuery).toHaveBeenCalledWith(1, 'расскажи обо мне', []);
    expect(embedText).toHaveBeenCalledWith('расскажи обо мне Emir');
    expect(result.context).toContain('Emir: Developer');
    expect(result.context).toContain('Almaty: City');
    expect(result.context).toContain('Emir → живёт в → Almaty');
    expect(result.entityIds).toContain('e1');
    expect(result.entityIds).toContain('e2');
  });

  it('returns empty string when no entities found', async () => {
    (expandQuery as ReturnType<typeof vi.fn>).mockResolvedValue('unknown query');
    (embedText as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);
    (graphEntitiesRepo.findWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (graphEntityUsagesRepo.findRecentForUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (graphRelationshipsRepo.getNeighborsMultiHop as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await buildFloatingSubgraph(1, 'unknown', [], 999);

    expect(result.context).toBe('');
    expect(result.entityIds).toEqual([]);
  });

  it('respects context budget of 1500 chars', async () => {
    (expandQuery as ReturnType<typeof vi.fn>).mockResolvedValue('query');
    (embedText as ReturnType<typeof vi.fn>).mockResolvedValue([0.1]);

    const longEntities = Array.from({ length: 50 }, (_, i) => ({
      id: `e${i}`,
      name: `Entity${i}`,
      description: 'A'.repeat(100),
      finalScore: 1.0 - i * 0.01,
    }));

    (graphEntitiesRepo.findWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue(longEntities);
    (graphEntityUsagesRepo.findRecentForUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (graphRelationshipsRepo.getNeighborsMultiHop as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await buildFloatingSubgraph(1, 'query', [], 999);

    expect(result.context.length).toBeLessThanOrEqual(1500);
  });
});
