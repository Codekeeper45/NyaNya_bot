import { vi, describe, it, expect, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  getJobSchedulers: vi.fn(),
  removeJobScheduler: vi.fn(),
  upsertJobScheduler: vi.fn(),
}));

vi.mock('../db/repos/repeating_jobs.js', () => ({
  repeatingJobsRepo: {
    findAll: mocks.findAll,
  },
}));

vi.mock('./queue.js', () => ({
  opekuQueue: {
    getJobSchedulers: mocks.getJobSchedulers,
    removeJobScheduler: mocks.removeJobScheduler,
    upsertJobScheduler: mocks.upsertJobScheduler,
  },
}));

vi.mock('./jobs.js', () => ({
  scheduleRepeatingJob: vi.fn(),
  scheduleJob: vi.fn(),
}));

import { syncSchedules } from './proactive.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncSchedules', () => {
  it('removes legacy Redis schedulers that are not present in DB even without user- prefix', async () => {
    mocks.findAll.mockResolvedValueOnce([
      {
        schedulerId: 'user-1-lunch',
        kind: 'meal_reminder',
        cronPattern: '0 13 * * *',
        timezone: 'Asia/Almaty',
        payload: { schedulerId: 'user-1-lunch', kind: 'meal_reminder', context: 'обед' },
      },
    ]);
    mocks.getJobSchedulers.mockResolvedValueOnce([
      { key: 'user-1-lunch', pattern: '0 13 * * *', tz: 'Asia/Almaty' },
      { key: 'lunch-1', pattern: '0 13 * * *', tz: 'Asia/Almaty' },
    ]);

    await syncSchedules();

    expect(mocks.removeJobScheduler).toHaveBeenCalledWith('lunch-1');
    expect(mocks.removeJobScheduler).not.toHaveBeenCalledWith('user-1-lunch');
  });
});
