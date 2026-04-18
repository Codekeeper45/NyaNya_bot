// T-11: auth middleware, T-51: ratelimit, T-52: context middleware
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTextUpdate, makeUser } from '../test/fixtures.js';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  findByTelegramId: vi.fn().mockResolvedValue(null),
  upsert: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../db/repos/users.js', () => ({
  usersRepo: {
    findByTelegramId: mocks.findByTelegramId,
    upsert: mocks.upsert,
    update: mocks.update,
  },
}));

vi.mock('../db/client.js', () => ({ db: {} }));

import { Bot } from 'grammy';
import type { BotContext } from '../bot/bot.js';
import { authMiddleware } from '../bot/middleware/auth.js';
import { rateLimitMiddleware } from '../bot/middleware/ratelimit.js';
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
  return bot;
}

describe('T-11: Auth middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks unauthorized user (userId not in allowedUserIds)', async () => {
    const bot = createTestBot();
    const next = vi.fn();
    bot.use(authMiddleware);
    bot.on('message', next);

    // userId 999 is not in allowed list (TELEGRAM_ALLOWED_USER_IDS = '100' from env.ts)
    await bot.handleUpdate(makeTextUpdate('привет', 999));

    expect(next).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('личный бот'),
      expect.any(Object),
    );
  });

  it('passes authorized user through', async () => {
    const bot = createTestBot();
    const next = vi.fn();
    bot.use(authMiddleware);
    bot.on('message', next);

    await bot.handleUpdate(makeTextUpdate('привет', 100));
    expect(next).toHaveBeenCalled();
  });
});

describe('T-51: Rate limit middleware', () => {
  it('blocks user after exceeding 20 messages within 1 minute', async () => {
    // Use a unique userId per test run to avoid state leakage between test files
    const uniqueUserId = 7777;
    const bot = createTestBot();
    const next = vi.fn();
    bot.use(rateLimitMiddleware);
    bot.on('message', next);

    for (let i = 0; i < 20; i++) {
      await bot.handleUpdate(makeTextUpdate(`msg ${i}`, uniqueUserId));
    }
    expect(next).toHaveBeenCalledTimes(20);

    await bot.handleUpdate(makeTextUpdate('msg 21', uniqueUserId));
    expect(next).toHaveBeenCalledTimes(20);
    expect(mocks.sendMessage).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.stringContaining('много'),
      expect.any(Object),
    );
  });
});

describe('T-52: Context middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates new user when not found in DB', async () => {
    mocks.findByTelegramId.mockResolvedValue(null);
    mocks.upsert.mockResolvedValue(makeUser({}));

    const bot = createTestBot();
    const next = vi.fn();
    bot.use(contextMiddleware);
    bot.on('message', next);

    await bot.handleUpdate(makeTextUpdate('привет', 100));

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ telegramUserId: 100 }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('loads existing user without creating new one', async () => {
    mocks.findByTelegramId.mockResolvedValue(makeUser({}));

    const bot = createTestBot();
    const next = vi.fn();
    bot.use(contextMiddleware);
    bot.on('message', next);

    await bot.handleUpdate(makeTextUpdate('привет', 100));

    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
