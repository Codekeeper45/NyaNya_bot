import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./queue.js', () => ({
  opekuQueue: {
    add: vi.fn(),
    getJob: vi.fn(),
    upsertJobScheduler: vi.fn(),
    removeJobScheduler: vi.fn(),
    getJobSchedulers: vi.fn(),
  },
}));
vi.mock('../db/repos/jobs.js', () => ({
  jobsRepo: { create: vi.fn() },
}));
vi.mock('../db/repos/repeating_jobs.js', () => ({
  repeatingJobsRepo: { upsert: vi.fn(), remove: vi.fn() },
}));

import { opekuQueue } from './queue.js';
import { jobsRepo } from '../db/repos/jobs.js';
import {
  scheduleJob,
  cancelJob,
  scheduleRepeatingJob,
  cancelRepeatingJob,
  listRepeatingJobs,
  type JobPayload,
} from './jobs.js';

const mockAdd = opekuQueue.add as ReturnType<typeof vi.fn>;
const mockGetJob = opekuQueue.getJob as ReturnType<typeof vi.fn>;
const mockUpsert = opekuQueue.upsertJobScheduler as ReturnType<typeof vi.fn>;
const mockRemove = opekuQueue.removeJobScheduler as ReturnType<typeof vi.fn>;
const mockGetSchedulers = opekuQueue.getJobSchedulers as ReturnType<typeof vi.fn>;
const mockJobsCreate = jobsRepo.create as ReturnType<typeof vi.fn>;

const payload: JobPayload = {
  userId: 1,
  telegramUserId: 100,
  telegramChatId: 200,
  kind: 'custom_reminder',
  context: 'Выпить воды',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockJobsCreate.mockResolvedValue({});
});

describe('scheduleJob', () => {
  it('adds job to BullMQ queue and creates DB record', async () => {
    mockAdd.mockResolvedValue({ id: 'job-42' });

    const jobId = await scheduleJob(payload, 60_000);

    expect(mockAdd).toHaveBeenCalledWith('custom_reminder', payload, { delay: 60_000 });
    expect(mockJobsCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      bullJobId: 'job-42',
      kind: 'custom_reminder',
      status: 'scheduled',
    }));
    expect(jobId).toBe('job-42');
  });

  it('returns empty string when BullMQ job has no id', async () => {
    mockAdd.mockResolvedValue({ id: undefined });

    const jobId = await scheduleJob(payload, 1000);
    expect(jobId).toBe('');
  });
});

describe('cancelJob', () => {
  it('removes job from queue when found', async () => {
    const mockJob = { remove: vi.fn().mockResolvedValue(undefined) };
    mockGetJob.mockResolvedValue(mockJob);

    await cancelJob('job-42');

    expect(mockGetJob).toHaveBeenCalledWith('job-42');
    expect(mockJob.remove).toHaveBeenCalled();
  });

  it('does nothing when job not found', async () => {
    mockGetJob.mockResolvedValue(null);

    await expect(cancelJob('nonexistent')).resolves.toBeUndefined();
  });
});

describe('scheduleRepeatingJob', () => {
  it('calls upsertJobScheduler with cron pattern and timezone', async () => {
    mockUpsert.mockResolvedValue(undefined);

    await scheduleRepeatingJob('user-1-sport', payload, '0 9 * * 1', 'Asia/Almaty');

    expect(mockUpsert).toHaveBeenCalledWith(
      'user-1-sport',
      { pattern: '0 9 * * 1', tz: 'Asia/Almaty' },
      { name: 'custom_reminder', data: payload },
    );
  });
});

describe('cancelRepeatingJob', () => {
  it('calls removeJobScheduler with the schedulerId', async () => {
    mockRemove.mockResolvedValue(undefined);

    await cancelRepeatingJob('user-1-sport');

    expect(mockRemove).toHaveBeenCalledWith('user-1-sport');
  });
});

describe('listRepeatingJobs', () => {
  it('returns only jobs for the given userId by prefix', async () => {
    mockGetSchedulers.mockResolvedValue([
      { id: 'user-1-sport', pattern: '0 9 * * 1', template: { data: { context: 'Тренировка' } } },
      { id: 'user-2-water', pattern: '0 */2 * * *', template: { data: { context: 'Вода' } } },
      { id: 'user-1-water', pattern: '30 8 * * *', template: { data: { context: 'Стакан воды' } } },
    ]);

    const jobs = await listRepeatingJobs(1);

    expect(jobs).toHaveLength(2);
    expect(jobs.map(j => j.schedulerId)).toEqual(['user-1-sport', 'user-1-water']);
  });

  it('returns schedulerId, cron, and name for each job', async () => {
    mockGetSchedulers.mockResolvedValue([
      { id: 'user-1-morning', pattern: '0 7 * * *', template: { data: { context: 'Доброе утро' } } },
    ]);

    const jobs = await listRepeatingJobs(1);

    expect(jobs[0]).toEqual({ schedulerId: 'user-1-morning', cron: '0 7 * * *', name: 'Доброе утро' });
  });
});
