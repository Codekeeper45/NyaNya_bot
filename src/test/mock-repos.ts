import { vi } from 'vitest';
import { makeUser } from './fixtures.js';

export function createMockUsersRepo() {
  return {
    findByTelegramId: vi.fn().mockResolvedValue(makeUser()),
    findById: vi.fn().mockResolvedValue(makeUser()),
    upsert: vi.fn().mockResolvedValue(makeUser()),
    update: vi.fn().mockResolvedValue(makeUser()),
  };
}

export function createMockMessagesRepo() {
  return {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    getRecent: vi.fn().mockResolvedValue([]),
    getLastUserReplyTime: vi.fn().mockResolvedValue(null),
    deleteAllForUser: vi.fn().mockResolvedValue(undefined),
    getWeeklyStats: vi.fn().mockResolvedValue({ totalMessages: 5 }),
  };
}

export function createMockJobsRepo() {
  return {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    findByUserId: vi.fn().mockResolvedValue([]),
    findPendingByUser: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateBullJobId: vi.fn().mockResolvedValue(undefined),
    belongsToUser: vi.fn().mockResolvedValue(true),
  };
}

export function createMockLessonPlansRepo() {
  return {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    findByUserId: vi.fn().mockResolvedValue([]),
    getWeeklyStats: vi.fn().mockResolvedValue({ totalPlans: 0, completedPlans: 0 }),
  };
}

export function createMockRepeatingJobsRepo() {
  return {
    upsert: vi.fn().mockResolvedValue({ id: 1 }),
    remove: vi.fn().mockResolvedValue(undefined),
    findByUser: vi.fn().mockResolvedValue([]),
  };
}

export function createMockRepos() {
  return {
    usersRepo: createMockUsersRepo(),
    messagesRepo: createMockMessagesRepo(),
    jobsRepo: createMockJobsRepo(),
    lessonPlansRepo: createMockLessonPlansRepo(),
    repeatingJobsRepo: createMockRepeatingJobsRepo(),
  };
}
