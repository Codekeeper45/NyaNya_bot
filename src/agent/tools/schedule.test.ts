import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../scheduler/jobs.js', () => ({
  scheduleJob: vi.fn(),
  cancelJob: vi.fn(),
  scheduleRepeatingJob: vi.fn(),
  cancelRepeatingJob: vi.fn(),
  listRepeatingJobs: vi.fn(),
}));
vi.mock('../../scheduler/proactive.js', () => ({
  setupUserSchedules: vi.fn(),
}));
vi.mock('../../db/repos/users.js', () => ({
  usersRepo: { update: vi.fn() },
}));
vi.mock('../../db/repos/jobs.js', () => ({
  jobsRepo: { belongsToUser: vi.fn().mockResolvedValue(true) },
}));
vi.mock('../../db/repos/repeating_jobs.js', () => ({
  repeatingJobsRepo: { findByUser: vi.fn().mockResolvedValue([]), upsert: vi.fn(), remove: vi.fn(), findAll: vi.fn().mockResolvedValue([]) },
}));

import {
  scheduleJob,
  cancelJob,
  scheduleRepeatingJob,
  cancelRepeatingJob,
  listRepeatingJobs,
} from '../../scheduler/jobs.js';
import { setupUserSchedules } from '../../scheduler/proactive.js';
import { scheduleTools } from './schedule.js';

const mockScheduleJob = scheduleJob as ReturnType<typeof vi.fn>;
const mockCancelJob = cancelJob as ReturnType<typeof vi.fn>;
const mockScheduleRepeating = scheduleRepeatingJob as ReturnType<typeof vi.fn>;
const mockCancelRepeating = cancelRepeatingJob as ReturnType<typeof vi.fn>;
const mockListRepeating = listRepeatingJobs as ReturnType<typeof vi.fn>;
const mockSetupSchedules = setupUserSchedules as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

const TZ = 'Asia/Almaty';

describe('schedule_reminder', () => {
  it('schedules a one-time job with correct delay and returns jobId', async () => {
    mockScheduleJob.mockResolvedValue('job-123');

    const tools = scheduleTools(1, 100, 200, TZ);
    const result = await tools.schedule_reminder.execute({ message: 'Выпить воды', delayMinutes: 30 }, {} as never);

    expect(mockScheduleJob).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, telegramUserId: 100, telegramChatId: 200, kind: 'custom_reminder', context: 'Выпить воды' }),
      30 * 60 * 1000,
    );
    expect(result).toEqual({ scheduled: true, inMinutes: 30, jobId: 'job-123' });
  });
});

describe('schedule_cancel', () => {
  it('cancels job by ID', async () => {
    mockCancelJob.mockResolvedValue(undefined);

    const tools = scheduleTools(1, 100, 200, TZ);
    const result = await tools.schedule_cancel.execute({ jobId: 'job-123' }, {} as never);

    expect(mockCancelJob).toHaveBeenCalledWith('job-123');
    expect(result).toEqual({ cancelled: true });
  });
});

describe('schedule_repeating', () => {
  it('creates repeating job with user-{userId}- prefix', async () => {
    mockScheduleRepeating.mockResolvedValue(undefined);

    const tools = scheduleTools(5, 100, 200, TZ);
    const result = await tools.schedule_repeating.execute(
      { schedulerId: 'sport', message: 'Тренировка', cron: '0 9 * * 1' },
      {} as never,
    );

    expect(mockScheduleRepeating).toHaveBeenCalledWith(
      'user-5-sport',
      expect.objectContaining({ context: 'Тренировка' }),
      '0 9 * * 1',
      TZ,
    );
    expect(result).toEqual({ scheduled: true, schedulerId: 'user-5-sport', cron: '0 9 * * 1' });
  });
});

describe('schedule_repeating_cancel', () => {
  it('cancels repeating job by full schedulerId', async () => {
    mockCancelRepeating.mockResolvedValue(undefined);

    const tools = scheduleTools(5, 100, 200, TZ);
    const result = await tools.schedule_repeating_cancel.execute({ schedulerId: 'user-5-sport' }, {} as never);

    expect(mockCancelRepeating).toHaveBeenCalledWith('user-5-sport');
    expect(result).toEqual({ cancelled: true, schedulerId: 'user-5-sport' });
  });
});

describe('schedule_list', () => {
  it('returns list of repeating jobs for user', async () => {
    mockListRepeating.mockResolvedValue([
      { schedulerId: 'user-5-sport', cron: '0 9 * * 1', name: 'Тренировка' },
    ]);

    const tools = scheduleTools(5, 100, 200, TZ);
    const result = await tools.schedule_list.execute({}, {} as never);

    expect(mockListRepeating).toHaveBeenCalledWith(5);
    expect(result).toEqual({ reminders: [{ schedulerId: 'user-5-sport', cron: '0 9 * * 1', name: 'Тренировка' }] });
  });
});

describe('setup_daily_schedule', () => {
  it('calls setupUserSchedules and updates onboardingComplete', async () => {
    mockSetupSchedules.mockResolvedValue(undefined);

    const tools = scheduleTools(1, 100, 200, TZ);
    const result = await tools.setup_daily_schedule.execute({
      wakeTime: '07:00',
      sleepTime: '23:00',
      breakfastTime: '08:00',
      lunchTime: '13:00',
      dinnerTime: '19:00',
    }, {} as never);

    expect(mockSetupSchedules).toHaveBeenCalledWith(
      { id: 1, telegramUserId: 100, timezone: TZ, wakeTime: '07:00', sleepTime: '23:00' },
      200,
      { breakfastTime: '08:00', lunchTime: '13:00', dinnerTime: '19:00' },
    );
    expect(result).toEqual({ done: true, jobs: expect.any(Array) });
  });
});

describe('followup_ask', () => {
  it('schedules a followup_check job', async () => {
    mockScheduleJob.mockResolvedValue('job-456');

    const tools = scheduleTools(1, 100, 200, TZ);
    const result = await tools.followup_ask.execute({ delayMinutes: 5, context: 'Check onboarding' }, {} as never);

    expect(mockScheduleJob).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'followup_check', context: 'Check onboarding' }),
      5 * 60_000,
    );
    expect(result).toEqual({ scheduled: true, inMinutes: 5, jobId: 'job-456' });
  });
});
