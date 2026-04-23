// T-08..T-10: text, photo, voice message handling through orchestrator
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTextUpdate, makePhotoUpdate, makeVoiceUpdate, makeUser } from '../test/fixtures.js';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
  getFile: vi.fn().mockResolvedValue({ file_path: 'voice/test.ogg' }),
  runOrchestrator: vi.fn().mockResolvedValue(undefined),
  transcribeVoice: vi.fn().mockResolvedValue('транскрибированный текст'),
  isSTTAvailable: vi.fn().mockReturnValue(true),
  findByTelegramId: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../agent/orchestrator.js', () => ({
  runOrchestrator: mocks.runOrchestrator,
}));

vi.mock('../voice/stt.js', () => ({
  transcribeVoice: mocks.transcribeVoice,
  isSTTAvailable: mocks.isSTTAvailable,
}));

vi.mock('../db/repos/users.js', () => ({
  usersRepo: {
    findByTelegramId: mocks.findByTelegramId,
    upsert: mocks.upsert,
    update: vi.fn(),
  },
}));

vi.mock('../db/repos/messages.js', () => ({
  messagesRepo: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    getRecent: vi.fn().mockResolvedValue([]),
    getLastUserReplyTime: vi.fn().mockResolvedValue(null),
    deleteAllForUser: vi.fn(),
  },
}));

vi.mock('../graphrag/index.js', () => ({
  graphRag: { retrieve: vi.fn().mockResolvedValue(''), indexUser: vi.fn(), deleteAllForUser: vi.fn() },
}));

vi.mock('../scheduler/jobs.js', () => ({
  listRepeatingJobs: vi.fn().mockResolvedValue([]),
  scheduleJob: vi.fn().mockResolvedValue('j1'),
  scheduleRepeatingJob: vi.fn(),
  cancelJob: vi.fn(),
  cancelRepeatingJob: vi.fn(),
}));

vi.mock('../oauth/google.js', () => ({
  isOAuthCallbackUrl: vi.fn().mockReturnValue(false),
  generateAuthUrl: vi.fn(),
  isGoogleOAuthConfigured: vi.fn().mockReturnValue(false),
  extractCodeFromInput: vi.fn(),
  exchangeCode: vi.fn(),
}));

vi.mock('../scheduler/queue.js', () => ({
  redisConnection: {},
  opekuQueue: { add: vi.fn().mockResolvedValue({ id: 'j1' }), on: vi.fn(), getJobSchedulers: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../db/client.js', () => ({ db: {} }));

import { Bot } from 'grammy';
import type { BotContext } from '../bot/bot.js';
import { authMiddleware } from '../bot/middleware/auth.js';
import { contextMiddleware } from '../bot/middleware/context.js';
import { registerCommands } from '../bot/handlers/commands.js';
import { registerMessageHandler } from '../bot/handlers/message.js';
import { registerVoiceHandler } from '../bot/handlers/voice.js';

function createTestBot() {
  const bot = new Bot<BotContext>('test:token', {
    botInfo: { id: 42, first_name: "Bot", is_bot: true as const, username: "bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_manage_bots: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false },
  });
  bot.api.config.use((_prev, method, payload) => {
    if (method === 'sendMessage') {
      mocks.sendMessage(payload.chat_id, payload.text, payload);
      return Promise.resolve({ ok: true, result: { message_id: 1 } }) as any;
    }
    if (method === 'getFile') {
      return Promise.resolve({ ok: true, result: { file_path: 'voice/test.ogg' } }) as any;
    }
    return Promise.resolve({ ok: true, result: true }) as any;
  });
  bot.use(authMiddleware);
  bot.use(contextMiddleware);
  registerCommands(bot);
  registerMessageHandler(bot);
  registerVoiceHandler(bot);
  return bot;
}

describe('T-08: Text message handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByTelegramId.mockResolvedValue(makeUser());
    mocks.upsert.mockResolvedValue(makeUser());
    mocks.runOrchestrator.mockResolvedValue(undefined);
  });

  it('passes text message to orchestrator', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(makeTextUpdate('привет, как дела?'));

    expect(mocks.runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'привет, как дела?',
        mode: 'reactive',
      }),
    );
  });

  it('includes userId and chatId in orchestrator call', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(makeTextUpdate('привет'));

    expect(mocks.runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        telegramChatId: 200,
      }),
    );
  });
});

describe('T-09: Photo message handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByTelegramId.mockResolvedValue(makeUser());
    mocks.upsert.mockResolvedValue(makeUser());
    mocks.runOrchestrator.mockResolvedValue(undefined);
    // Mock fetch for photo download
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(100),
    }));
  });

  it('passes photo to orchestrator with image data', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(makePhotoUpdate('file-id-123', 'Что это?'));

    expect(mocks.runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'reactive',
        images: expect.arrayContaining([expect.objectContaining({ mimeType: 'image/jpeg' })]),
      }),
    );
  });
});

describe('T-10: Voice message handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByTelegramId.mockResolvedValue(makeUser());
    mocks.upsert.mockResolvedValue(makeUser());
    mocks.runOrchestrator.mockResolvedValue(undefined);
    mocks.transcribeVoice.mockResolvedValue('голосовое сообщение');
    mocks.isSTTAvailable.mockReturnValue(true);
  });

  it('transcribes voice and passes to orchestrator when STT available', async () => {
    const bot = createTestBot();
    await bot.handleUpdate(makeVoiceUpdate('voice-file-123'));

    expect(mocks.transcribeVoice).toHaveBeenCalled();
    expect(mocks.runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'голосовое сообщение',
        mode: 'reactive',
      }),
    );
  });

  it('replies about unavailability when STT not configured', async () => {
    mocks.isSTTAvailable.mockReturnValue(false);
    const bot = createTestBot();
    await bot.handleUpdate(makeVoiceUpdate('voice-no-stt'));

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('не поддерживаются'),
      expect.any(Object),
    );
    expect(mocks.runOrchestrator).not.toHaveBeenCalled();
  });

  it('sends error message when transcription fails', async () => {
    mocks.transcribeVoice.mockRejectedValue(new Error('STT failed'));
    const bot = createTestBot();
    await bot.handleUpdate(makeVoiceUpdate('voice-fail'));

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      expect.stringContaining('разобрала'),
      expect.any(Object),
    );
  });
});
