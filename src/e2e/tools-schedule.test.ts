// T-21..T-26: schedule tools — reminder, repeating, cancel, list
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TEST_DB_USER_ID, TEST_USER_ID, TEST_CHAT_ID } from '../test/fixtures.js';

const mocks = vi.hoisted(() => ({
  scheduleJob: vi.fn().mockResolvedValue('job-123'),
  scheduleRepeatingJob: vi.fn().mockResolvedValue(undefined),
  cancelJob: vi.fn().mockResolvedValue(undefined),
  cancelRepeatingJob: vi.fn().mockResolvedValue(undefined),
  listRepeatingJobs: vi.fn().mockResolvedValue([]),
  setupUserSchedules: vi.fn().mockResolvedValue(undefined),
  usersUpdate: vi.fn().mockResolvedValue(undefined),
  belongsToUser: vi.fn().mockResolvedValue(true),
  jobsCreate: vi.fn().mockResolvedValue({ id: 1 }),
  repeatingUpsert: vi.fn().mockResolvedValue({ id: 1 }),
  repeatingRemove: vi.fn().mockResolvedValue(undefined),
  queueAdd: vi.fn().mockResolvedValue({ id: 'j1' }),
  queueUpsert: vi.fn().mockResolvedValue(undefined),
  queueRemove: vi.fn().mockResolvedValue(undefined),
  queueGetSchedulers: vi.fn().mockResolvedValue([]),
}));

vi.mock('../scheduler/jobs.js', () => ({
  scheduleJob: mocks.scheduleJob,
  scheduleRepeatingJob: mocks.scheduleRepeatingJob,
  cancelJob: mocks.cancelJob,
  cancelRepeatingJob: mocks.cancelRepeatingJob,
  listRepeatingJobs: mocks.listRepeatingJobs,
}));

vi.mock('../scheduler/proactive.js', () => ({
  setupUserSchedules: mocks.setupUserSchedules,
}));

vi.mock('../db/repos/users.js', () => ({
  usersRepo: { update: mocks.usersUpdate, findById: vi.fn() },
}));

vi.mock('../db/repos/jobs.js', () => ({
  jobsRepo: { 
    belongsToUser: mocks.belongsToUser, 
    create: mocks.jobsCreate,
    findPendingByUser: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn().mockResolvedValue(undefined)
  },
}));

vi.mock('../scheduler/queue.js', () => ({
  opekuQueue: {
    add: mocks.queueAdd,
    upsertJobScheduler: mocks.queueUpsert,
    removeJobScheduler: mocks.queueRemove,
    getJobSchedulers: mocks.queueGetSchedulers,
    on: vi.fn(),
  },
  redisConnection: {},
}));

vi.mock('../db/repos/repeating_jobs.js', () => ({
  repeatingJobsRepo: {
    upsert: mocks.repeatingUpsert,
    remove: mocks.repeatingRemove,
    findByUser: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../db/client.js', () => ({ db: {}, getDb: () => ({}) }));
vi.mock('../db/repos/job_skip_once.js', () => ({
  jobSkipOnceRepo: { set: vi.fn(), shouldSkip: vi.fn().mockResolvedValue(false), clear: vi.fn() },
}));

import { scheduleTools } from '../agent/tools/schedule.js';

const TZ = 'Asia/Almaty';

function makeTools(setOnboardingDone?: () => void) {
  return scheduleTools(TEST_DB_USER_ID, TEST_USER_ID, TEST_CHAT_ID, TZ, setOnboardingDone);
}

describe('T-21: schedule_reminder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('schedules a one-time job with correct delay', async () => {
    const tools = makeTools();
    const result = await tools.schedule_reminder.execute(
      { message: 'Попей воды', delayMinutes: 30 },
      {} as any,
    );

    expect(mocks.scheduleJob).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'custom_reminder', context: 'Попей воды' }),
      30 * 60 * 1000,
    );
    expect(result).toMatchObject({ scheduled: true, inMinutes: 30 });
  });
});

describe('T-22: schedule_repeating', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates repeating job with user-scoped schedulerId', async () => {
    const tools = makeTools();
    const result = await tools.schedule_repeating.execute(
      { schedulerId: 'morning-sport', message: 'Время тренировки', cron: '0 7 * * *' },
      {} as any,
    );

    expect(mocks.scheduleRepeatingJob).toHaveBeenCalledWith(
      `user-${TEST_DB_USER_ID}-morning-sport`,
      expect.objectContaining({ context: 'Время тренировки' }),
      '0 7 * * *',
      TZ,
    );
    expect(result).toMatchObject({ scheduled: true });
  });
});

describe('T-23: schedule_repeating_cancel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cancels own repeating job', async () => {
    const tools = makeTools();
    const result = await tools.schedule_repeating_cancel.execute(
      { schedulerId: `user-${TEST_DB_USER_ID}-morning-sport` },
      {} as any,
    );

    expect(mocks.cancelRepeatingJob).toHaveBeenCalledWith(`user-${TEST_DB_USER_ID}-morning-sport`);
    expect(result).toMatchObject({ cancelled: true });
  });

  it("rejects cancel of another user's job", async () => {
    const tools = makeTools();
    const result = await tools.schedule_repeating_cancel.execute(
      { schedulerId: 'user-999-hacked' },
      {} as any,
    );

    expect(mocks.cancelRepeatingJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: expect.stringContaining('Unauthorized') });
  });
});

describe('T-24: schedule_list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty list message when no reminders', async () => {
    mocks.listRepeatingJobs.mockResolvedValue([]);
    const tools = makeTools();
    const result = await tools.schedule_list.execute({}, {} as any);
    expect(result).toMatchObject({ oneTime: [], repeating: [] });
  });

  it('returns reminders when present', async () => {
    mocks.listRepeatingJobs.mockResolvedValue([
      { schedulerId: 'user-1-sport', cron: '0 7 * * *', name: 'Спорт' },
    ]);
    const tools = makeTools();
    const result = await tools.schedule_list.execute({}, {} as any);
    expect((result as any).repeating).toHaveLength(1);
  });
});

describe('T-25: schedule_cancel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cancels one-time job when it belongs to user', async () => {
    mocks.belongsToUser.mockResolvedValue(true);
    const tools = makeTools();
    const result = await tools.schedule_cancel.execute({ jobId: 'job-123' }, {} as any);

    expect(mocks.cancelJob).toHaveBeenCalledWith('job-123');
    expect(result).toMatchObject({ cancelled: true });
  });

  it('rejects cancel when job does not belong to user', async () => {
    mocks.belongsToUser.mockResolvedValue(false);
    const tools = makeTools();
    const result = await tools.schedule_cancel.execute({ jobId: 'job-other' }, {} as any);

    expect(mocks.cancelJob).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cancelled: false });
  });
});

describe('T-26: setup_daily_schedule (onboarding)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets up schedules and updates user profile', async () => {
    const tools = makeTools();

    await tools.setup_daily_schedule.execute(
      { wakeTime: '07:00', sleepTime: '22:00', breakfastTime: '08:00', lunchTime: '13:00', dinnerTime: '19:00' },
      {} as any,
    );

    expect(mocks.setupUserSchedules).toHaveBeenCalled();
    expect(mocks.usersUpdate).toHaveBeenCalledWith(TEST_DB_USER_ID, expect.objectContaining({
      wakeTime: '07:00',
    }));
  });
});
