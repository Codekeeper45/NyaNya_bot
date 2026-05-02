import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db/repos/messages.js', () => ({
  messagesRepo: {
    searchSavedFacts: vi.fn(),
  },
}));

vi.mock('../db/repos/graph_chunks.js', () => ({
  graphChunksRepo: {
    searchSimilar: vi.fn(),
  },
}));

vi.mock('../graphrag/embeddings.js', () => ({
  embedText: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

import { messagesRepo } from '../db/repos/messages.js';
import { graphChunksRepo } from '../db/repos/graph_chunks.js';
import { searchMemoryArchive } from './archive-search.js';

const mockSearchSavedFacts = messagesRepo.searchSavedFacts as ReturnType<typeof vi.fn>;
const mockSearchSimilar = graphChunksRepo.searchSimilar as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('searchMemoryArchive', () => {
  it('returns saved facts before raw chunks and strips memory_save prefix', async () => {
    mockSearchSavedFacts.mockResolvedValueOnce([
      {
        id: 10,
        content: 'Факт о пользователе: Эмир занимается в Big Nation',
        createdAt: new Date('2026-04-27T03:05:00.000Z'),
      },
    ]);
    mockSearchSimilar.mockResolvedValueOnce([
      {
        id: 'chunk-1',
        content: 'Пользователь: Эмир сказал, что ходит в Big Nation по утрам.',
        distance: 0.2,
        createdAt: new Date('2026-04-26T03:05:00.000Z'),
      },
    ]);

    const result = await searchMemoryArchive(1, 'спортзал Big Nation');

    expect(result.found).toBe(true);
    expect(result.context).toContain('Эмир занимается в Big Nation');
    expect(result.context).not.toContain('Факт о пользователе:');
    // keyword fact [K] should appear before the vector chunk [V]
    expect(result.context.indexOf('Эмир занимается в Big Nation')).toBeLessThan(result.context.indexOf('Big Nation по утрам'));
  });

  it('returns not found when saved facts and chunks are empty', async () => {
    mockSearchSavedFacts.mockResolvedValueOnce([]);
    mockSearchSimilar.mockResolvedValueOnce([]);

    const result = await searchMemoryArchive(1, 'несуществующий факт');

    expect(result).toEqual({ found: false, context: '' });
  });
});
