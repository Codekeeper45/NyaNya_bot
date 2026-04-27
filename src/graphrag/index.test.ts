import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/repos/graph_chunks.js', () => ({
  graphChunksRepo: {
    findByUser: vi.fn().mockResolvedValue([{ id: 'chunk-1' }]),
    deleteAllForUser: vi.fn(),
  },
}));

vi.mock('../db/repos/graph_entity_mentions.js', () => ({
  graphEntityMentionsRepo: { deleteAllForChunks: vi.fn() },
}));

vi.mock('../db/repos/graph_entity_usages.js', () => ({
  graphEntityUsagesRepo: { deleteAllForUser: vi.fn() },
}));

vi.mock('../db/repos/graph_relationships.js', () => ({
  graphRelationshipsRepo: {
    deleteAllForUser: vi.fn(),
    getAllForUser: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../db/repos/graph_entities.js', () => ({
  graphEntitiesRepo: {
    deleteAllForUser: vi.fn(),
    findAllForUser: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../db/repos/graph_entity_aliases.js', () => ({
  graphEntityAliasesRepo: { deleteAllForUser: vi.fn() },
}));

vi.mock('../db/repos/graph_facts.js', () => ({
  graphFactsRepo: { deleteAllForUser: vi.fn() },
}));

vi.mock('../db/repos/graph_fact_sources.js', () => ({
  graphFactSourcesRepo: { deleteAllForChunks: vi.fn() },
}));

vi.mock('./indexer.js', () => ({
  indexUserMessages: vi.fn(),
  indexAllUsers: vi.fn(),
}));

vi.mock('./retrieval.js', () => ({
  retrieveContext: vi.fn(),
}));

import { graphRag } from './index.js';
import { graphEntityAliasesRepo } from '../db/repos/graph_entity_aliases.js';
import { graphFactsRepo } from '../db/repos/graph_facts.js';
import { graphFactSourcesRepo } from '../db/repos/graph_fact_sources.js';

describe('graphRag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes aliases, facts, and fact sources during graph reset', async () => {
    await graphRag.deleteAllForUser(1);

    expect(graphFactSourcesRepo.deleteAllForChunks).toHaveBeenCalledWith(['chunk-1']);
    expect(graphFactsRepo.deleteAllForUser).toHaveBeenCalledWith(1);
    expect(graphEntityAliasesRepo.deleteAllForUser).toHaveBeenCalledWith(1);
  });
});
