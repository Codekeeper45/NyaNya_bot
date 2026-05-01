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
  },
}));

vi.mock('../db/repos/graph_entity_aliases.js', () => ({
  graphEntityAliasesRepo: {
    findByEntityIds: vi.fn(),
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

vi.mock('../db/repos/graph_facts.js', () => ({
  graphFactsRepo: {
    upsert: vi.fn(),
    findByFactKey: vi.fn(),
  },
}));

vi.mock('../db/repos/graph_fact_sources.js', () => ({
  graphFactSourcesRepo: {
    create: vi.fn(),
  },
}));

vi.mock('../db/repos/users.js', () => ({
  usersRepo: {
    findById: vi.fn(),
    findAllActive: vi.fn(),
  },
}));

vi.mock('./entity-resolver.js', () => ({
  normalizeEntityAlias: vi.fn((value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')),
  resolveEntityCandidate: vi.fn(),
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
import { graphEntityAliasesRepo } from '../db/repos/graph_entity_aliases.js';
import { graphRelationshipsRepo } from '../db/repos/graph_relationships.js';
import { graphFactsRepo } from '../db/repos/graph_facts.js';
import { graphFactSourcesRepo } from '../db/repos/graph_fact_sources.js';
import { graphIndexStateRepo } from '../db/repos/graph_index_state.js';
import { messagesRepo } from '../db/repos/messages.js';
import { usersRepo } from '../db/repos/users.js';
import { resolveEntityCandidate } from './entity-resolver.js';

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
    vi.mocked(usersRepo.findById).mockResolvedValue({
      id: 1,
      telegramUserId: 2,
      name: 'Эмир',
      timezone: 'Asia/Almaty',
      wakeTime: null,
      sleepTime: null,
      weekendWakeTime: null,
      weekendSleepTime: null,
      breakfastTime: null,
      lunchTime: null,
      dinnerTime: null,
      phoneNumber: null,
      paused: false,
      onboardingComplete: true,
      googleRefreshToken: null,
      preferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
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

  it('passes known canonical entities and aliases into extraction', async () => {
    vi.mocked(graphIndexStateRepo.get).mockResolvedValue(undefined);
    vi.mocked(messagesRepo.getAfterId).mockResolvedValue([message(1)]);
    vi.mocked(embedTexts).mockResolvedValueOnce([[0.1, 0.2, 0.3]]);
    vi.mocked(graphEntitiesRepo.searchSimilar).mockResolvedValue([
      { id: 'entity-1', name: 'Эмир', description: 'Эмир пользователь', distance: 0.1 },
    ]);
    vi.mocked(graphEntityAliasesRepo.findByEntityIds).mockResolvedValue([
      { id: 'alias-1', userId: 1, entityId: 'entity-1', alias: 'Emir', normalizedAlias: 'emir', source: 'resolver', confidence: 100, createdAt: new Date() },
    ]);

    await indexUserMessages(1);

    expect(extractTriplets).toHaveBeenCalledWith('chunk', {
      knownEntities: [{ name: 'Эмир', aliases: ['Emir'] }],
    });
  });

  it('uses resolver canonical ids for relationships, facts, and source links', async () => {
    vi.mocked(graphIndexStateRepo.get).mockResolvedValue(undefined);
    vi.mocked(messagesRepo.getAfterId).mockResolvedValue([message(1)]);
    vi.mocked(embedTexts)
      .mockResolvedValueOnce([[0.1, 0.2, 0.3]])
      .mockResolvedValueOnce([[0.4, 0.5, 0.6], [0.7, 0.8, 0.9]])
      .mockResolvedValueOnce([[0.9, 0.8, 0.7]]);
    vi.mocked(graphEntitiesRepo.searchSimilar).mockResolvedValue([]);
    vi.mocked(graphEntityAliasesRepo.findByEntityIds).mockResolvedValue([]);
    vi.mocked(extractTriplets).mockResolvedValue([
      { subject: 'Emir', predicate: 'принимает', object: 'Итоприд' },
    ]);
    vi.mocked(resolveEntityCandidate)
      .mockResolvedValueOnce({ entityId: 'entity-user', name: 'Эмир' })
      .mockResolvedValueOnce({ entityId: 'entity-med', name: 'Итоприд' });
    vi.mocked(graphFactsRepo.upsert).mockResolvedValue('fact-1');

    await indexUserMessages(1);

    expect(resolveEntityCandidate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      userName: 'Эмир',
      name: 'Emir',
      description: 'Emir принимает Итоприд',
      embedding: [0.4, 0.5, 0.6],
    }));
    expect(graphRelationshipsRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      sourceId: 'entity-user',
      targetId: 'entity-med',
      description: 'Эмир принимает Итоприд',
    }));
    expect(graphFactsRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      subjectId: 'entity-user',
      predicate: 'принимает',
      objectId: 'entity-med',
      objectText: 'Итоприд',
      statement: 'Эмир принимает Итоприд',
      embedding: [0.9, 0.8, 0.7],
    }));
    expect(graphFactSourcesRepo.create).toHaveBeenCalledWith({ factId: 'fact-1', chunkId: 'chunk-1' });
  });
});
