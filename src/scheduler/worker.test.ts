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
  },
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

describe('worker followup attempt limit', () => {
  it('skips orchestrator for followup attempt 4', async () => {
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
    await state.capturedProcessor!({
      id: 'job-1',
      timestamp: Date.now(),
      data: {
        userId: 1,
        telegramUserId: 100,
        telegramChatId: 200,
        kind: 'followup_check',
        context: 'check in',
        attemptNumber: 4,
      },
    });

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });
});
