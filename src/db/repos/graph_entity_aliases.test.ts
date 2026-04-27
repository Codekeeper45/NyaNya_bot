import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../client.js', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('../../config.js', () => ({
  config: { databaseUrl: 'postgres://test' },
}));

import { graphEntityAliasesRepo } from './graph_entity_aliases.js';

describe('graphEntityAliasesRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('looks up aliases by user and normalized alias', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ entityId: 'entity-1', alias: 'Emir' }]),
        }),
      }),
    });

    const result = await graphEntityAliasesRepo.findByNormalizedAlias(1, 'emir');

    expect(result?.entityId).toBe('entity-1');
    expect(result?.alias).toBe('Emir');
  });

  it('upserts aliases without failing on duplicates', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'alias-1' }]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    mockDb.insert.mockReturnValue({ values });

    const id = await graphEntityAliasesRepo.upsert({
      userId: 1,
      entityId: 'entity-1',
      alias: 'Эмир',
      normalizedAlias: 'эмир',
      source: 'resolver',
      confidence: 100,
    });

    expect(id).toBe('alias-1');
    expect(onConflictDoNothing).toHaveBeenCalled();
  });
});
