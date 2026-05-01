import { vi, describe, it, expect, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  workerOn: vi.fn(),
  capturedProcessor: null as null | ((job: any) => Promise<void>),
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn(function (_name: string, processor: (job: any) => Promise<void>) {
    state.capturedProcessor = processor;
    return { on: state.workerOn };
  }),
}));

vi.mock('./queue.js', () => ({
  redisConnection: {},
  workerRedisConnection: {},
}));

vi.mock('../agent/orchestrator.js', () => ({
  runOrchestrator: vi.fn(),
}));

vi.mock('../db/repos/users.js', () => ({
  usersRepo: { findById: vi.fn() },
}));

vi.mock('../db/repos/messages.js', () => ({
  messagesRepo: {
    getLastUserReplyTime: vi.fn(),
    getWeeklyStats: vi.fn(),
    getLastBotMessageTime: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../db/repos/repeating_jobs.js', () => ({
  repeatingJobsRepo: { findBySchedulerId: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../db/repos/job_executions.js', () => ({
  jobExecutionsRepo: { create: vi.fn() },
}));

vi.mock('../db/repos/lesson_plans.js', () => ({
  lessonPlansRepo: {
    getWeeklyStats: vi.fn(),
  },
}));

vi.mock('./proactive.js', () => ({
  scheduleFollowup: vi.fn(),
}));

import { startWorker } from './worker.js';
import { runOrchestrator } from '../agent/orchestrator.js';
import { usersRepo } from '../db/repos/users.js';
import { messagesRepo } from '../db/repos/messages.js';
import { scheduleFollowup } from './proactive.js';

const mockRunOrchestrator = runOrchestrator as ReturnType<typeof vi.fn>;
const mockFindById = usersRepo.findById as ReturnType<typeof vi.fn>;
const mockGetLastUserReplyTime = messagesRepo.getLastUserReplyTime as ReturnType<typeof vi.fn>;
const mockScheduleFollowup = scheduleFollowup as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  state.capturedProcessor = null;
});

function makeFollowupJob(attemptNumber: number, metadata?: Record<string, unknown>) {
  return {
    id: 'job-1',
    timestamp: Date.now(),
    data: {
      userId: 1,
      telegramUserId: 100,
      telegramChatId: 200,
      kind: 'followup_check',
      context: 'check in',
      attemptNumber,
      metadata,
    },
  };
}

describe('worker followup attempt limit', () => {
  it('skips orchestrator for followup attempt 4 (default global limit 3)', async () => {
    mockFindById.mockResolvedValue({
      id: 1,
      name: 'User',
      timezone: 'Asia/Almaty',
      wakeTime: '08:00',
      sleepTime: '23:00',
      preferences: {},
      onboardingComplete: true,
      paused: false,
    });
    mockGetLastUserReplyTime.mockResolvedValue(null);

    startWorker();

    expect(state.capturedProcessor).toBeTruthy();
    await state.capturedProcessor!(makeFollowupJob(4));

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });

  it('allows attempt 3 but does not schedule next followup when at limit', async () => {
    mockFindById.mockResolvedValue({
      id: 1,
      name: 'User',
      timezone: 'Asia/Almaty',
      wakeTime: '08:00',
      sleepTime: '23:00',
      preferences: {},
      onboardingComplete: true,
      paused: false,
    });
    mockGetLastUserReplyTime.mockResolvedValue(null);

    startWorker();

    await state.capturedProcessor!(makeFollowupJob(3));

    expect(mockRunOrchestrator).toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });

  it('does NOT auto-schedule next followup — only model via followup_ask decides', async () => {
    mockFindById.mockResolvedValue({
      id: 1,
      name: 'User',
      timezone: 'Asia/Almaty',
      wakeTime: '08:00',
      sleepTime: '23:00',
      preferences: {},
      onboardingComplete: true,
      paused: false,
    });
    mockGetLastUserReplyTime.mockResolvedValue(null);

    startWorker();

    await state.capturedProcessor!(makeFollowupJob(1));

    expect(mockRunOrchestrator).toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });

  it('respects global followup limit from preferences', async () => {
    mockFindById.mockResolvedValue({
      id: 1,
      name: 'User',
      timezone: 'Asia/Almaty',
      wakeTime: '08:00',
      sleepTime: '23:00',
      preferences: { followup_max_attempts: 1 },
      onboardingComplete: true,
      paused: false,
    });
    mockGetLastUserReplyTime.mockResolvedValue(null);

    startWorker();

    await state.capturedProcessor!(makeFollowupJob(2));

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });

  it('respects per-kind followup limit lower than global', async () => {
    mockFindById.mockResolvedValue({
      id: 1,
      name: 'User',
      timezone: 'Asia/Almaty',
      wakeTime: '08:00',
      sleepTime: '23:00',
      preferences: { followup_max_attempts: 3, followup_by_kind: { morning_greeting: 1 } },
      onboardingComplete: true,
      paused: false,
    });
    mockGetLastUserReplyTime.mockResolvedValue(null);

    startWorker();

    await state.capturedProcessor!(makeFollowupJob(2, { followupForKind: 'morning_greeting' }));

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });

  it('uses global limit when per-kind limit is higher', async () => {
    mockFindById.mockResolvedValue({
      id: 1,
      name: 'User',
      timezone: 'Asia/Almaty',
      wakeTime: '08:00',
      sleepTime: '23:00',
      preferences: { followup_max_attempts: 2, followup_by_kind: { morning_greeting: 5 } },
      onboardingComplete: true,
      paused: false,
    });
    mockGetLastUserReplyTime.mockResolvedValue(null);

    startWorker();

    await state.capturedProcessor!(makeFollowupJob(3, { followupForKind: 'morning_greeting' }));

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });

  it('never exceeds hard ceiling of 3 even if preferences say 5', async () => {
    mockFindById.mockResolvedValue({
      id: 1,
      name: 'User',
      timezone: 'Asia/Almaty',
      wakeTime: '08:00',
      sleepTime: '23:00',
      preferences: { followup_max_attempts: 5 },
      onboardingComplete: true,
      paused: false,
    });
    mockGetLastUserReplyTime.mockResolvedValue(null);

    startWorker();

    await state.capturedProcessor!(makeFollowupJob(4));

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });

  it('skips follow-up if bot sent message < 2 min ago', async () => {
    const mockGetLastBotMessageTime = messagesRepo.getLastBotMessageTime as ReturnType<typeof vi.fn>;
    mockGetLastBotMessageTime.mockResolvedValue(new Date(Date.now() - 30_000)); // 30 sec ago
    mockFindById.mockResolvedValue({
      id: 1,
      name: 'User',
      timezone: 'Asia/Almaty',
      wakeTime: '08:00',
      sleepTime: '23:00',
      preferences: {},
      onboardingComplete: true,
      paused: false,
    });
    mockGetLastUserReplyTime.mockResolvedValue(null);

    startWorker();

    await state.capturedProcessor!(makeFollowupJob(1));

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });
});
