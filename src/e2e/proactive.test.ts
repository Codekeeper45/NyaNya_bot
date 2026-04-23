// T-27..T-32: Proactive job processing via worker
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeJobPayload } from '../test/fixtures.js';

const state = vi.hoisted(() => ({
  capturedProcessor: null as ((job: any) => Promise<void>) | null,
  workerOn: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn(function (_name: string, processor: (job: any) => Promise<void>) {
    state.capturedProcessor = processor;
    return { on: state.workerOn };
  }),
}));

vi.mock('../agent/orchestrator.js', () => ({
  runOrchestrator: vi.fn(),
}));

vi.mock('../scheduler/proactive.js', () => ({
  scheduleFollowup: vi.fn(),
  setupUserSchedules: vi.fn(),
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

vi.mock('../db/repos/lesson_plans.js', () => ({
  lessonPlansRepo: { getWeeklyStats: vi.fn() },
}));

vi.mock('../scheduler/queue.js', () => ({
  redisConnection: {},
  opekuQueue: { add: vi.fn().mockResolvedValue({ id: 'j1' }), on: vi.fn() },
}));

vi.mock('../db/client.js', () => ({ db: {} }));

import { startWorker } from '../scheduler/worker.js';
import { runOrchestrator } from '../agent/orchestrator.js';
import { usersRepo } from '../db/repos/users.js';
import { messagesRepo } from '../db/repos/messages.js';
import { lessonPlansRepo } from '../db/repos/lesson_plans.js';
import { scheduleFollowup } from '../scheduler/proactive.js';

const mockRunOrchestrator = runOrchestrator as ReturnType<typeof vi.fn>;
const mockFindById = usersRepo.findById as ReturnType<typeof vi.fn>;
const mockGetLastUserReplyTime = messagesRepo.getLastUserReplyTime as ReturnType<typeof vi.fn>;
const mockGetLastBotMessageTime = messagesRepo.getLastBotMessageTime as ReturnType<typeof vi.fn>;
const mockGetWeeklyStats = messagesRepo.getWeeklyStats as ReturnType<typeof vi.fn>;
const mockGetLessonStats = lessonPlansRepo.getWeeklyStats as ReturnType<typeof vi.fn>;
const mockScheduleFollowup = scheduleFollowup as ReturnType<typeof vi.fn>;

const baseUser = {
  id: 1, telegramUserId: 100, name: 'Тест', timezone: 'Asia/Almaty',
  wakeTime: '08:00', sleepTime: '23:00', breakfastTime: null, lunchTime: null,
  dinnerTime: null, paused: false, onboardingComplete: true,
  googleRefreshToken: null, preferences: {}, createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  state.capturedProcessor = null;
  state.workerOn.mockReset();
  mockFindById.mockResolvedValue(baseUser);
  mockGetLastUserReplyTime.mockResolvedValue(null);
  mockGetLastBotMessageTime.mockResolvedValue(null);
  mockGetWeeklyStats.mockResolvedValue({ totalMessages: 5 });
  mockGetLessonStats.mockResolvedValue({ totalPlans: 2, completedPlans: 1 });
  startWorker();
});

describe('T-27: Morning greeting job', () => {
  it('calls orchestrator with morning_greeting kind', async () => {
    await state.capturedProcessor!({
      id: 'job-morning',
      data: makeJobPayload({ kind: 'morning_greeting', context: 'Доброе утро!' }),
      timestamp: Date.now(),
    });

    expect(mockRunOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'proactive', proactiveKind: 'morning_greeting' }),
    );
  });
});

describe('T-28: Paused user skips job', () => {
  it('does not call orchestrator when user is paused', async () => {
    mockFindById.mockResolvedValue({ ...baseUser, paused: true });

    await state.capturedProcessor!({
      id: 'job-paused',
      data: makeJobPayload({ kind: 'morning_greeting' }),
      timestamp: Date.now(),
    });

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });
});

describe('T-29: Missing user skips job', () => {
  it('does not call orchestrator when user not found', async () => {
    mockFindById.mockResolvedValue(null);

    await state.capturedProcessor!({
      id: 'job-missing',
      data: makeJobPayload(),
      timestamp: Date.now(),
    });

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });
});

describe('T-30: Weekly digest includes stats', () => {
  it('appends weekly stats to proactiveContext', async () => {
    mockGetWeeklyStats.mockResolvedValue({ totalMessages: 42 });
    mockGetLessonStats.mockResolvedValue({ totalPlans: 3, completedPlans: 2 });

    await state.capturedProcessor!({
      id: 'job-digest',
      data: makeJobPayload({ kind: 'weekly_digest', context: 'Итоги недели' }),
      timestamp: Date.now(),
    });

    expect(mockRunOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ proactiveContext: expect.stringContaining('42') }),
    );
  });
});

describe('T-31: Followup skip when user already replied', () => {
  it('skips followup if user replied after job was scheduled', async () => {
    const jobTimestamp = Date.now() - 5 * 60_000;
    const lastReply = new Date(Date.now() - 2 * 60_000);
    mockGetLastUserReplyTime.mockResolvedValue(lastReply);

    await state.capturedProcessor!({
      id: 'job-followup-skip',
      data: makeJobPayload({ kind: 'followup_check', attemptNumber: 1 }),
      timestamp: jobTimestamp,
    });

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
  });
});

describe('T-32: Followup escalation stops at attempt 3', () => {
  it('does NOT auto-schedule next followup for attempts 1-2 — only model decides', async () => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      vi.clearAllMocks();
      mockFindById.mockResolvedValue(baseUser);
      mockGetLastUserReplyTime.mockResolvedValue(null);

      await state.capturedProcessor!({
        id: `job-fu-${attempt}`,
        data: makeJobPayload({ kind: 'followup_check', attemptNumber: attempt }),
        timestamp: Date.now() - 10_000,
      });

      expect(mockRunOrchestrator).toHaveBeenCalled();
      expect(mockScheduleFollowup).not.toHaveBeenCalled();
    }
  });

  it('does not schedule next followup on attempt 3 (at limit)', async () => {
    vi.clearAllMocks();
    mockFindById.mockResolvedValue(baseUser);
    mockGetLastUserReplyTime.mockResolvedValue(null);

    await state.capturedProcessor!({
      id: 'job-fu-3',
      data: makeJobPayload({ kind: 'followup_check', attemptNumber: 3 }),
      timestamp: Date.now() - 10_000,
    });

    expect(mockRunOrchestrator).toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });

  it('does not run orchestrator on attempt 4 (above limit)', async () => {
    await state.capturedProcessor!({
      id: 'job-fu-4',
      data: makeJobPayload({ kind: 'followup_check', attemptNumber: 4 }),
      timestamp: Date.now() - 10_000,
    });

    expect(mockRunOrchestrator).not.toHaveBeenCalled();
    expect(mockScheduleFollowup).not.toHaveBeenCalled();
  });
});
