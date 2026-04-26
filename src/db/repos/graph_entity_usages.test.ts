import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('../../config.js', () => ({
  config: { databaseUrl: 'postgres://test' },
}));

import { graphEntityUsagesRepo } from './graph_entity_usages.js';

describe('graphEntityUsagesRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordUsage', () => {
    it('creates usage record', async () => {
      mockDb.select
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'entity-1' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 42 }]),
            }),
          }),
        });
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      });

      await graphEntityUsagesRepo.recordUsage(1, 'entity-1', 42);

      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('findRecentForUser', () => {
    it('returns unique entity ids from last N messages', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                { entityId: 'e1', messageId: 10 },
                { entityId: 'e2', messageId: 9 },
                { entityId: 'e1', messageId: 8 }, // duplicate
              ]),
            }),
          }),
        }),
      });

      const result = await graphEntityUsagesRepo.findRecentForUser(1, 5);

      expect(result).toEqual(['e1', 'e2']);
    });

    it('returns empty array when no usages', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      const result = await graphEntityUsagesRepo.findRecentForUser(1, 5);

      expect(result).toEqual([]);
    });
  });

  describe('findLastUsedWithin', () => {
    it('returns entity ids used within cooldown period', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([
              { entityId: 'e1' },
              { entityId: 'e2' },
            ]),
          }),
        }),
      });

      const result = await graphEntityUsagesRepo.findLastUsedWithin(1, 5);

      expect(result).toEqual(['e1', 'e2']);
    });
  });
});
