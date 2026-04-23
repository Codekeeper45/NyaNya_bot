import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/repos/job_executions.js', () => ({
  jobExecutionsRepo: {
    getSkipRateByDayOfWeek: vi.fn(),
    getFollowupResponseStats: vi.fn(),
  },
}));

vi.mock('../db/repos/users.js', () => ({
  usersRepo: {
    findById: vi.fn(),
    findAllActive: vi.fn(),
  },
}));

vi.mock('../db/repos/repeating_jobs.js', () => ({
  repeatingJobsRepo: {
    findByUser: vi.fn(),
  },
}));

vi.mock('../db/repos/messages.js', () => ({
  messagesRepo: {
    getRecent: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
  },
}));

vi.mock('../bot/bot.js', () => ({
  bot: {
    api: {
      sendMessage: vi.fn(),
    },
  },
}));

import { detectPatternsForUser, sendPatternSuggestion } from './patterns.js';
import { jobExecutionsRepo } from '../db/repos/job_executions.js';
import { usersRepo } from '../db/repos/users.js';
import { repeatingJobsRepo } from '../db/repos/repeating_jobs.js';

const mockGetSkipRate = jobExecutionsRepo.getSkipRateByDayOfWeek as ReturnType<typeof vi.fn>;
const mockGetFollowupStats = jobExecutionsRepo.getFollowupResponseStats as ReturnType<typeof vi.fn>;
const mockFindById = usersRepo.findById as ReturnType<typeof vi.fn>;
const mockFindByUser = repeatingJobsRepo.findByUser as ReturnType<typeof vi.fn>;

describe('detectPatternsForUser', () => {
  it('detects routine skip by day', async () => {
    mockFindById.mockResolvedValue({ id: 1, telegramUserId: 100 });
    mockFindByUser.mockResolvedValue([
      { schedulerId: 'user-1-morning', kind: 'morning_greeting' },
    ]);
    mockGetSkipRate.mockResolvedValue({
      6: { total: 10, skipped: 8 }, // Saturday
    });
    mockGetFollowupStats.mockResolvedValue([]);

    const patterns = await detectPatternsForUser(1);

    expect(patterns).toHaveLength(1);
    expect(patterns[0].type).toBe('routine_skip_by_day');
    expect(patterns[0].confidence).toBe(0.8);
  });

  it('detects followup no-response pattern', async () => {
    mockFindById.mockResolvedValue({ id: 1, telegramUserId: 100 });
    mockFindByUser.mockResolvedValue([]);
    mockGetSkipRate.mockResolvedValue({});
    mockGetFollowupStats.mockResolvedValue([
      { attempt: 2, total: 5, replied: 0 },
    ]);

    const patterns = await detectPatternsForUser(1);

    expect(patterns).toHaveLength(1);
    expect(patterns[0].type).toBe('followup_no_response');
  });

  it('returns empty when no patterns', async () => {
    mockFindById.mockResolvedValue({ id: 1, telegramUserId: 100 });
    mockFindByUser.mockResolvedValue([]);
    mockGetSkipRate.mockResolvedValue({});
    mockGetFollowupStats.mockResolvedValue([]);

    const patterns = await detectPatternsForUser(1);
    expect(patterns).toHaveLength(0);
  });
});

describe('sendPatternSuggestion', () => {
  it('sends suggestion for routine_skip_by_day', async () => {
    mockFindById.mockResolvedValue({ id: 1, telegramUserId: 100 });

    await sendPatternSuggestion({
      type: 'routine_skip_by_day',
      userId: 1,
      telegramChatId: 100,
      schedulerId: 'user-1-morning',
      kind: 'morning_greeting',
      description: 'Пропускает morning_greeting в субботу (80% случаев)',
      suggestedAction: 'Отключить user-1-morning по субботам',
      confidence: 0.8,
    });

    const { bot } = await import('../bot/bot.js');
    expect(bot.api.sendMessage).toHaveBeenCalled();
  });
});
