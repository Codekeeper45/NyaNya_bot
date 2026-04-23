import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('../../config.js', () => ({
  config: { databaseUrl: 'postgres://test' },
}));

import { jobExecutionsRepo } from './job_executions.js';

describe('jobExecutionsRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates execution record', async () => {
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    await jobExecutionsRepo.create({
      userId: 1,
      schedulerId: 'user-1-morning',
      kind: 'morning_greeting',
      attemptNumber: 1,
      wasSkipped: false,
    });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('finds recent executions by user', async () => {
    const mockData = [{ id: 1, userId: 1, kind: 'morning_greeting' }];
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue(mockData),
        }),
      }),
    });
    const result = await jobExecutionsRepo.findRecentByUser(1, 7);
    expect(result).toEqual(mockData);
  });

  it('calculates skip rate by day of week', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue([
            { dayOfWeek: 6, total: '10', skipped: '8' },
          ]),
        }),
      }),
    });
    const result = await jobExecutionsRepo.getSkipRateByDayOfWeek(1, 'morning_greeting');
    expect(result[6]).toEqual({ total: 10, skipped: 8 });
  });

  it('calculates followup response stats', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue([
            { attempt: 2, total: '5', replied: '0' },
          ]),
        }),
      }),
    });
    const result = await jobExecutionsRepo.getFollowupResponseStats(1);
    expect(result).toEqual([{ attempt: 2, total: 5, replied: 0 }]);
  });
});
