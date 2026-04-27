import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contextCache, lastQueryCache, embeddingCache, recordLastQuery } from './cache.js';

vi.mock('/src/db/repos/graph_entities.js', () => ({
  graphEntitiesRepo: {
    findWithScoring: vi.fn(),
    findByIdsWithScoring: vi.fn(),
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
    vi.clearAllMocks();
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

    (graphEntitiesRepo.findByIdsWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'e1', name: 'Emir', description: 'Developer', finalScore: 0.9 },
      { id: 'e2', name: 'Almaty', description: 'City', finalScore: 0.8 },
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
    (graphEntitiesRepo.findByIdsWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue([]);
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
    (graphEntitiesRepo.findByIdsWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue(longEntities);
    (graphEntityUsagesRepo.findRecentForUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (graphRelationshipsRepo.getNeighborsMultiHop as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await buildFloatingSubgraph(1, 'query', [], 999);

    expect(result.context.length).toBeLessThanOrEqual(1500);
  });

  it('does not reuse cached context for a different query from the same user', async () => {
    (expandQuery as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('работа')
      .mockResolvedValueOnce('здоровье');
    (embedText as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([1, 0])
      .mockResolvedValueOnce([0, 1]);

    (graphEntitiesRepo.findWithScoring as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'work', name: 'Работа', description: 'Проекты', finalScore: 0.9 }])
      .mockResolvedValueOnce([{ id: 'health', name: 'Здоровье', description: 'Сон', finalScore: 0.9 }]);
    (graphEntitiesRepo.findByIdsWithScoring as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: 'work', name: 'Работа', description: 'Проекты', finalScore: 0.9 }])
      .mockResolvedValueOnce([{ id: 'health', name: 'Здоровье', description: 'Сон', finalScore: 0.9 }]);
    (graphEntityUsagesRepo.findRecentForUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (graphRelationshipsRepo.getNeighborsMultiHop as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const first = await buildFloatingSubgraph(1, 'что с работой', [], 1);
    const second = await buildFloatingSubgraph(1, 'что со здоровьем', [], 2);

    expect(first.context).toContain('Работа: Проекты');
    expect(second.context).toContain('Здоровье: Сон');
    expect(second.context).not.toContain('Работа: Проекты');
  });

  it('rebuilds similar queries when no cached context is available', async () => {
    recordLastQuery(1, 'что с работой', [0.1, 0.2]);
    (expandQuery as ReturnType<typeof vi.fn>).mockResolvedValue('что с работой');
    (embedText as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2]);
    (graphEntitiesRepo.findWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'work', name: 'Работа', description: 'Проекты', finalScore: 0.9 },
    ]);
    (graphEntitiesRepo.findByIdsWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'work', name: 'Работа', description: 'Проекты', finalScore: 0.9 },
    ]);
    (graphEntityUsagesRepo.findRecentForUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (graphRelationshipsRepo.getNeighborsMultiHop as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await buildFloatingSubgraph(1, 'как дела с работой', [], 3);

    expect(result.context).toContain('Работа: Проекты');
  });

  it('includes low-score entities that are in the subgraph', async () => {
    (expandQuery as ReturnType<typeof vi.fn>).mockResolvedValue('не связанный запрос');
    (embedText as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2]);
    (graphEntitiesRepo.findWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'weak', name: 'Случайный факт', description: 'Нерелевантная деталь', finalScore: -0.3 },
    ]);
    (graphEntitiesRepo.findByIdsWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'weak', name: 'Случайный факт', description: 'Нерелевантная деталь', finalScore: -0.3 },
    ]);
    (graphEntityUsagesRepo.findRecentForUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (graphRelationshipsRepo.getNeighborsMultiHop as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await buildFloatingSubgraph(1, 'не связанный запрос', [], 4);

    // Subgraph entities are included regardless of low finalScore — ordering handles relevance
    expect(result.context).toContain('Случайный факт: Нерелевантная деталь');
    expect(result.entityIds).toContain('weak');
  });

  it('deduplicates repeated context lines before applying the context budget', async () => {
    (expandQuery as ReturnType<typeof vi.fn>).mockResolvedValue('работа');
    (embedText as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2]);
    (graphEntitiesRepo.findWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'e1', name: 'Работа', description: 'Проекты', finalScore: 0.9 },
      { id: 'e2', name: 'Работа', description: 'Проекты', finalScore: 0.8 },
    ]);
    (graphEntitiesRepo.findByIdsWithScoring as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'e1', name: 'Работа', description: 'Проекты', finalScore: 0.9 },
      { id: 'e2', name: 'Работа', description: 'Проекты', finalScore: 0.8 },
    ]);
    (graphEntityUsagesRepo.findRecentForUser as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (graphRelationshipsRepo.getNeighborsMultiHop as ReturnType<typeof vi.fn>).mockResolvedValue([
      { sourceId: 'e1', sourceName: 'Эмир', targetId: 'e2', targetName: 'Работа', description: 'занимается', weight: 1, hop: 1 },
      { sourceId: 'e1', sourceName: 'Эмир', targetId: 'e2', targetName: 'Работа', description: 'занимается', weight: 1, hop: 1 },
    ]);

    const result = await buildFloatingSubgraph(1, 'работа', [], 5);

    expect(result.context.match(/Работа: Проекты/g)).toHaveLength(1);
    expect(result.context.match(/Эмир → занимается → Работа/g)).toHaveLength(1);
  });
});
