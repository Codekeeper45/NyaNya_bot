import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/repos/graph_entity_aliases.js', () => ({
  graphEntityAliasesRepo: {
    findByNormalizedAlias: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../db/repos/graph_entities.js', () => ({
  graphEntitiesRepo: {
    create: vi.fn(),
    findByIdForUser: vi.fn(),
    searchSimilar: vi.fn(),
    updateDescription: vi.fn(),
    updateUsage: vi.fn(),
  },
}));

import { graphEntityAliasesRepo } from '../db/repos/graph_entity_aliases.js';
import { graphEntitiesRepo } from '../db/repos/graph_entities.js';
import { normalizeEntityAlias, resolveEntityCandidate } from './entity-resolver.js';

describe('entity resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes aliases into stable lowercase keys', () => {
    expect(normalizeEntityAlias('  Ёжик   Emir  ')).toBe('ежик emir');
  });

  it('resolves exact existing aliases before creating entities', async () => {
    vi.mocked(graphEntityAliasesRepo.findByNormalizedAlias).mockResolvedValueOnce({
      id: 'alias-1',
      userId: 1,
      entityId: 'entity-1',
      alias: 'Эмир',
      normalizedAlias: 'эмир',
      source: 'resolver',
      confidence: 100,
      createdAt: new Date(),
    });
    vi.mocked(graphEntitiesRepo.findByIdForUser).mockResolvedValueOnce({
      id: 'entity-1',
      userId: 1,
      name: 'Эмир',
      description: 'Эмир пользователь',
      embedding: [],
      lastUsedAt: null,
      useCount: 0,
      importanceScore: 10,
      createdAt: new Date(),
    });

    const result = await resolveEntityCandidate({
      userId: 1,
      userName: 'Эмир',
      name: 'Emir',
      description: 'Emir работает над ботом',
      embedding: [0.1],
    });

    expect(result.entityId).toBe('entity-1');
    expect(result.name).toBe('Эмир');
    expect(graphEntitiesRepo.create).not.toHaveBeenCalled();
    expect(graphEntityAliasesRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'entity-1',
      alias: 'Emir',
      normalizedAlias: 'emir',
    }));
  });

  it('maps self aliases to the user canonical entity name', async () => {
    vi.mocked(graphEntityAliasesRepo.findByNormalizedAlias).mockResolvedValue(undefined);
    vi.mocked(graphEntitiesRepo.searchSimilar).mockResolvedValue([]);
    vi.mocked(graphEntitiesRepo.create).mockResolvedValueOnce('entity-self');

    const result = await resolveEntityCandidate({
      userId: 1,
      userName: 'Эмир',
      name: 'я',
      description: 'я пью итоприд утром',
      embedding: [0.2],
    });

    expect(result).toEqual({ entityId: 'entity-self', name: 'Эмир' });
    expect(graphEntitiesRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      name: 'Эмир',
    }));
    expect(graphEntityAliasesRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'entity-self',
      alias: 'я',
      normalizedAlias: 'я',
    }));
    expect(graphEntityAliasesRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'entity-self',
      alias: 'Эмир',
      normalizedAlias: 'эмир',
    }));
  });

  it('merges conservative vector duplicates and records the extracted alias', async () => {
    vi.mocked(graphEntityAliasesRepo.findByNormalizedAlias).mockResolvedValue(undefined);
    vi.mocked(graphEntitiesRepo.searchSimilar).mockResolvedValueOnce([
      { id: 'entity-1', name: 'Эмир', description: 'Эмир пользователь', distance: 0.12 },
    ]);
    vi.mocked(graphEntitiesRepo.findByIdForUser).mockResolvedValueOnce({
      id: 'entity-1',
      userId: 1,
      name: 'Эмир',
      description: 'Эмир пользователь',
      embedding: [],
      lastUsedAt: null,
      useCount: 0,
      importanceScore: 10,
      createdAt: new Date(),
    });

    const result = await resolveEntityCandidate({
      userId: 1,
      userName: 'Эмир',
      name: 'пользователь Эмир',
      description: 'пользователь Эмир принимает лекарство',
      embedding: [0.3],
    });

    expect(result.entityId).toBe('entity-1');
    expect(graphEntitiesRepo.updateDescription).toHaveBeenCalled();
    expect(graphEntityAliasesRepo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'entity-1',
      alias: 'пользователь Эмир',
    }));
  });
});
