import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('/src/db/repos/graph_entities.js', () => ({
  graphEntitiesRepo: {
    searchSimilar: vi.fn(),
  },
}));

vi.mock('/src/graphrag/embeddings.js', () => ({
  embedText: vi.fn(),
}));

import { expandQuery } from './query-expansion.js';
import { graphEntitiesRepo } from '/src/db/repos/graph_entities.js';
import { embedText } from '/src/graphrag/embeddings.js';

describe('expandQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (embedText as ReturnType<typeof vi.fn>).mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('returns query with seed entity names when enough seeds found', async () => {
    (graphEntitiesRepo.searchSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'e1', name: 'Emir', description: 'User', distance: 0.2 },
      { id: 'e2', name: 'Almaty', description: 'City', distance: 0.3 },
    ]);

    const result = await expandQuery(1, 'расскажи обо мне', []);

    expect(embedText).toHaveBeenCalledWith('расскажи обо мне');
    expect(graphEntitiesRepo.searchSimilar).toHaveBeenCalledWith(1, [0.1, 0.2, 0.3], 5);
    expect(result).toBe('расскажи обо мне Emir Almaty');
  });

  it('falls back to original query when fewer than 2 seeds', async () => {
    (graphEntitiesRepo.searchSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'e1', name: 'Emir', description: 'User', distance: 0.2 },
    ]);

    const result = await expandQuery(1, 'кто я', []);

    expect(graphEntitiesRepo.searchSimilar).toHaveBeenCalled();
    expect(result).toBe('кто я');
  });

  it('falls back to original query when no seeds found', async () => {
    (graphEntitiesRepo.searchSimilar as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await expandQuery(1, 'что-то непонятное', []);

    expect(result).toBe('что-то непонятное');
  });
});
