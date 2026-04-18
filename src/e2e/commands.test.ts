// T-03..T-07: Command handlers (/pause, /resume, /who, /reset, /gcal)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeCommandUpdate, makeTextUpdate, makeUser, TEST_DB_USER_ID } from '../test/fixtures.js';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  findByTelegramId: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  getAll: vi.fn().mockResolvedValue([]),
  deleteAll: vi.fn().mockResolvedValue(undefined),
  deleteAllForUser: vi.fn().mockResolvedValue(undefined),
  create: vi.fn().mockResolvedValue({ id: 1 }),
  getRecent: vi.fn().mockResolvedValue([]),
  generateAuthUrl: vi.fn().mockReturnValue('https://oauth.example.com/auth'),
  isGoogleOAuthConfigured: vi.fn().mockReturnValue(false),
  isOAuthCallbackUrl: vi.fn().mockReturnValue(false),
  extractCodeFromInput: vi.fn(),
  exchangeCode: vi.fn(),
  runOrchestrator: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/repos/users.js', () => ({
  usersRepo: {
    findByTelegramId: mocks.findByTelegramId,
    findById: vi.fn().mockResolvedValue(makeUser()),
    upsert: mocks.upsert,
    update: mocks.update,
  },
}));

vi.mock('../db/repos/messages.js', () => ({
  messagesRepo: {
    create: mocks.create,
    getRecent: mocks.getRecent,
    getLastUserReplyTime: vi.fn().mockResolvedValue(null),
    deleteAllForUser: mocks.deleteAllForUser,
  },
}));

vi.mock('../memory/mem0.js', () => ({
  mem0: {
    search: vi.fn().mockResolvedValue([]),
    add: vi.fn().mockResolvedValue(undefined),
    getAll: mocks.getAll,
    deleteAll: mocks.deleteAll,
  },
}));

vi.mock('../scheduler/jobs.js', () => ({
  listRepeatingJobs: vi.fn().mockResolvedValue([]),
  scheduleJob: vi.fn().mockResolvedValue('job-1'),
  scheduleRepeatingJob: vi.fn().mockResolvedValue(undefined),
  cancelJob: vi.fn().mockResolvedValue(undefined),
  cancelRepeatingJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../agent/orchestrator.js', () => ({
  runOrchestrator: mocks.runOrchestrator,
}));

vi.mock('../oauth/google.js', () => ({
  generateAuthUrl: mocks.generateAuthUrl,
  isGoogleOAuthConfigured: mocks.isGoogleOAuthConfigured,
  isOAuthCallbackUrl: mocks.isOAuthCallbackUrl,
  extractCodeFromInput: mocks.extractCodeFromInput,
  exchangeCode: mocks.exchangeCode,
}));

vi.mock('../scheduler/queue.js', () => ({
  redisConnection: {},
  opekuQueue: {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    getJob: vi.fn().mockResolvedValue(null),
    getJobSchedulers: vi.fn().mockResolvedValue([]),
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    removeJobScheduler: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  },
}));

vi.mock('../db/client.js', () => ({ db: {} }));

import { Bot } from 'grammy';
import type { BotContext } from '../bot/bot.js';
import { registerCommands } from '../bot/handlers/commands.js';
import { authMiddleware } from '../bot/middleware/auth.js';
import { contextMiddleware } from '../bot/middleware/context.js';

function createTestBot() {
  const bot = new Bot<BotContext>('test:token', {
    botInfo: { id: 42, first_name: "Bot", is_bot: true as const, username: "bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_manage_bots: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false },
  });
  bot.api.config.use((_prev, method, payload) => {
    if (method === 'sendMessage') {
      mocks.sendMessage(payload.chat_id, payload.text, payload);
      return Promise.resolve({ ok: true, result: { message_id: 1 } }) as any;
    }
    return Promise.resolve({ ok: true, result: true }) as any;
  });
  bot.use(authMiddleware);
  bot.use(contextMiddleware);
  registerCommands(bot);
  return bot;
}

describe('T-03: /pause command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue(makeUser());
    mocks.findByTelegramId.mockResolvedValue(makeUser());
    mocks.upsert.mockResolvedValue(makeUser());
    mocks.isOAuthCallbackUrl.mockReturnValue(false);
  });

  it('marks user as paused and replies', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(makeCommandUpdate('pause'));

    expect(mocks.update).toHaveBeenCalledWith(TEST_DB_USER_ID, { paused: true });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('/resume'),
      expect.any(Object),
    );
  });
});

describe('T-04: /resume command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue(makeUser());
    mocks.findByTelegramId.mockResolvedValue(makeUser({ paused: true }));
    mocks.upsert.mockResolvedValue(makeUser());
    mocks.isOAuthCallbackUrl.mockReturnValue(false);
  });

  it('unpauses user and replies', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(makeCommandUpdate('resume'));

    expect(mocks.update).toHaveBeenCalledWith(TEST_DB_USER_ID, { paused: false });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('снова'),
      expect.any(Object),
    );
  });
});

describe('T-05: /who command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue(makeUser());
    mocks.findByTelegramId.mockResolvedValue(makeUser());
    mocks.upsert.mockResolvedValue(makeUser());
    mocks.isOAuthCallbackUrl.mockReturnValue(false);
  });

  it('shows "no memories" when mem0 is empty', async () => {
    mocks.getAll.mockResolvedValue([]);
    const bot = createTestBot();
    await bot.handleUpdate(makeCommandUpdate('who'));

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('мало'),
      expect.any(Object),
    );
  });

  it('lists top memories when present', async () => {
    mocks.getAll.mockResolvedValue([
      { memory: 'Любит кофе' },
      { memory: 'Студент' },
    ]);
    const bot = createTestBot();
    await bot.handleUpdate(makeCommandUpdate('who'));

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('Любит кофе'),
      expect.any(Object),
    );
  });
});

describe('T-06: /reset command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue(makeUser());
    mocks.findByTelegramId.mockResolvedValue(makeUser());
    mocks.upsert.mockResolvedValue(makeUser());
    mocks.isOAuthCallbackUrl.mockReturnValue(false);
  });

  it('prompts for confirmation on /reset', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(makeCommandUpdate('reset'));

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('да, сброс'),
      expect.any(Object),
    );
  });

  it('executes reset when confirmed with "да, сброс"', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(makeCommandUpdate('reset'));
    vi.clearAllMocks();
    mocks.findByTelegramId.mockResolvedValue(makeUser());

    await bot.handleUpdate(makeTextUpdate('да, сброс'));

    expect(mocks.deleteAll).toHaveBeenCalled();
    expect(mocks.deleteAllForUser).toHaveBeenCalledWith(TEST_DB_USER_ID);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('забыла'),
      expect.any(Object),
    );
  });
});

describe('T-07: /gcal command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue(makeUser());
    mocks.findByTelegramId.mockResolvedValue(makeUser());
    mocks.upsert.mockResolvedValue(makeUser());
    mocks.isOAuthCallbackUrl.mockReturnValue(false);
  });

  it('reports OAuth not configured when env missing', async () => {
    mocks.isGoogleOAuthConfigured.mockReturnValue(false);
    const bot = createTestBot();
    await bot.handleUpdate(makeCommandUpdate('gcal'));

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('не настроен'),
      expect.any(Object),
    );
  });

  it('shows already connected message when token exists', async () => {
    mocks.isGoogleOAuthConfigured.mockReturnValue(true);
    mocks.findByTelegramId.mockResolvedValue(makeUser({ googleRefreshToken: 'refresh-token' }));

    const bot = createTestBot();
    await bot.handleUpdate(makeCommandUpdate('gcal'));

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('подключён'),
      expect.any(Object),
    );
  });

  it('sends auth URL when OAuth configured and no token', async () => {
    mocks.isGoogleOAuthConfigured.mockReturnValue(true);
    mocks.findByTelegramId.mockResolvedValue(makeUser({ googleRefreshToken: null }));

    const bot = createTestBot();
    await bot.handleUpdate(makeCommandUpdate('gcal'));

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('oauth.example.com'),
      expect.any(Object),
    );
  });
});
