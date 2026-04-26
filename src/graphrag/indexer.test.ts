import type { Message } from '../db/schema.js';

vi.mock('./embeddings.js', () => ({
  embedTexts: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
}));

vi.mock('./extraction.js', () => ({
  extractTriplets: vi.fn().mockResolvedValue([]),
}));

vi.mock('./chunking.js', () => ({
  chunkText: vi.fn().mockReturnValue(['chunk']),
}));

vi.mock('../db/repos/graph_chunks.js', () => ({
  graphChunksRepo: {
    create: vi.fn().mockResolvedValue('chunk-1'),
  },
}));

vi.mock('../db/repos/graph_entities.js', () => ({
  graphEntitiesRepo: {
    searchSimilar: vi.fn(),
    findById: vi.fn(),
    updateDescription: vi.fn(),
    updateUsage: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../db/repos/graph_relationships.js', () => ({
  graphRelationshipsRepo: {
    create: vi.fn(),
  },
}));

vi.mock('../db/repos/graph_entity_mentions.js', () => ({
  graphEntityMentionsRepo: {
    create: vi.fn(),
  },
}));

vi.mock('../db/repos/graph_index_state.js', () => ({
  graphIndexStateRepo: {
    get: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../db/repos/messages.js', () => ({
  messagesRepo: {
    getAfterId: vi.fn(),
  },
}));

import { indexUserMessages } from './indexer.js';
import { embedTexts } from './embeddings.js';
import { extractTriplets } from './extraction.js';
import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { graphIndexStateRepo } from '../db/repos/graph_index_state.js';
import { messagesRepo } from '../db/repos/messages.js';

function message(id: number): Message {
  return {
    id,
    userId: 1,
    role: 'user',
    content: `message ${id}`,
    source: 'text',
    metadata: {},
    createdAt: new Date(id * 1000),
  };
}

describe('indexUserMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the next batch after last indexed id in ascending order', async () => {
    vi.mocked(graphIndexStateRepo.get).mockResolvedValue({
      id: 1,
      userId: 1,
      lastIndexedMessageId: 100,
      updatedAt: new Date(),
    });
    vi.mocked(messagesRepo.getAfterId).mockResolvedValue([message(101), message(102)]);

    await indexUserMessages(1);

    expect(messagesRepo.getAfterId).toHaveBeenCalledWith(1, 100, 500);
    expect(graphIndexStateRepo.upsert).toHaveBeenCalledWith(1, 102);
  });

  it('does not update index state when there are no new messages', async () => {
    vi.mocked(graphIndexStateRepo.get).mockResolvedValue(undefined);
    vi.mocked(messagesRepo.getAfterId).mockResolvedValue([]);

    await indexUserMessages(1);

    expect(messagesRepo.getAfterId).toHaveBeenCalledWith(1, 0, 500);
    expect(graphIndexStateRepo.upsert).not.toHaveBeenCalled();
  });

  it('compacts duplicate entity descriptions when merging duplicates', async () => {
    vi.mocked(graphIndexStateRepo.get).mockResolvedValue(undefined);
    vi.mocked(messagesRepo.getAfterId).mockResolvedValue([message(1)]);
    vi.mocked(embedTexts)
      .mockResolvedValueOnce([[0.1, 0.2, 0.3]])
      .mockResolvedValueOnce([[0.4, 0.5, 0.6], [0.7, 0.8, 0.9]])
      .mockResolvedValueOnce([[0.9, 0.8, 0.7]]);
    vi.mocked(extractTriplets).mockResolvedValue([
      { subject: 'Emir', predicate: 'любит', object: 'чай' },
    ]);
    vi.mocked(graphEntitiesRepo.searchSimilar).mockResolvedValue([{ id: 'entity-1', name: 'Emir', description: 'old', distance: 0.01 }]);
    vi.mocked(graphEntitiesRepo.findById).mockResolvedValue({
      id: 'entity-1',
      userId: 1,
      name: 'Emir',
      description: 'Emir любит чай; Emir любит чай; Старый факт',
      embedding: [] as unknown as number[],
      lastUsedAt: null,
      useCount: 0,
      importanceScore: 10,
      createdAt: new Date(),
    });

    await indexUserMessages(1);

    expect(graphEntitiesRepo.updateDescription).toHaveBeenCalledWith(
      'entity-1',
      'Emir любит чай; Старый факт',
      [0.9, 0.8, 0.7],
    );
  });
});
