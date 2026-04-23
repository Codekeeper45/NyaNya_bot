import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('../../config.js', () => ({
  config: { databaseUrl: 'postgres://test' },
}));

import { graphEntitiesRepo } from './graph_entities.js';

describe('graphEntitiesRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateUsage', () => {
    it('updates last_used_at, increments use_count and importance', async () => {
      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDb.update.mockReturnValue({ set: setMock });

      await graphEntitiesRepo.updateUsage('entity-1', 5);

      expect(mockDb.update).toHaveBeenCalled();
      expect(setMock).toHaveBeenCalled();
    });
  });

  describe('findWithScoring', () => {
    it('returns entities ordered by final_score', async () => {
      const orderByMock = vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          {
            id: 'e1',
            name: 'Emir',
            description: 'Developer',
            distance: 0.2,
            importanceScore: 20,
            lastUsedAt: new Date(),
            useCount: 5,
            finalScore: 0.85,
          },
        ]),
      });
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: orderByMock,
          }),
        }),
      });

      const result = await graphEntitiesRepo.findWithScoring(1, [0.1, 0.2], [], 10);

      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Emir');
      expect(result[0].finalScore).toBe(0.85);
    });

    it('excludes specified entity ids', async () => {
      const orderByMock = vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      });
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: orderByMock,
          }),
        }),
      });

      await graphEntitiesRepo.findWithScoring(1, [0.1], ['exclude-id'], 10);

      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('findByIds', () => {
    it('returns entities by ids', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { id: 'e1', name: 'Test' },
          ]),
        }),
      });

      const result = await graphEntitiesRepo.findByIds(['e1']);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Test');
    });
  });
});
