import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn(() => vi.fn(() => 'mock-model')),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(() => Symbol('stop-when')),
}));

vi.mock('../config.js', () => ({
  config: {
    openrouterApiKey: 'test-key',
    primaryModel: 'test-primary-model',
  },
}));

vi.mock('./prompts/system.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system-prompt'),
}));

vi.mock('./prompts/proactive.js', () => ({
  buildProactivePrompt: vi.fn(() => 'proactive-prompt'),
}));



vi.mock('../db/repos/messages.js', () => ({
  messagesRepo: {
    getRecent: vi.fn(async () => []),
    getRecentConversation: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
  },
}));

vi.mock('../scheduler/jobs.js', () => ({
  listRepeatingJobs: vi.fn(async () => []),
}));

vi.mock('./tools/index.js', () => ({
  allTools: vi.fn(() => ({
    tools: {},
    wasSent: () => false,
    getOnboardingCompleted: () => false,
  })),
}));

vi.mock('../bot/bot.js', () => ({
  bot: {
    api: {
      sendMessage: vi.fn(async () => ({})),
    },
  },
}));

vi.mock('./tools/messaging.js', () => ({
  markdownToHtml: vi.fn((text: string) => text),
}));

import { generateText } from 'ai';
import { bot } from '../bot/bot.js';
import { messagesRepo } from '../db/repos/messages.js';
import { runOrchestrator } from './orchestrator.js';

const mockGenerateText = generateText as ReturnType<typeof vi.fn>;
const mockSendMessage = bot.api.sendMessage as ReturnType<typeof vi.fn>;
const mockMessagesCreate = messagesRepo.create as ReturnType<typeof vi.fn>;
const mockGetRecentConversation = messagesRepo.getRecentConversation as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runOrchestrator timeout behavior', () => {
  it('sends short fallback message when orchestrator run aborts by timeout', async () => {
    mockGenerateText.mockImplementationOnce(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    await runOrchestrator({
      userId: 1,
      telegramUserId: 2,
      telegramChatId: 3,
      userName: 'Emir',
      userTimezone: 'Asia/Almaty',
      mode: 'reactive',
      userMessage: 'Расскажи про тренды',
      preferences: {},
      onboardingComplete: true,
    });

    expect(mockSendMessage).toHaveBeenCalledWith(
      3,
      'Извини, запрос получился слишком объёмным. Я сократила исследование и готова ответить точнее, если сузим тему.',
      { parse_mode: 'HTML' },
    );
    expect(mockMessagesCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      role: 'assistant',
      source: 'text',
    }));
  });

  it('loads conversation history without synthetic memory_save facts', async () => {
    mockGenerateText.mockResolvedValueOnce({ text: '', toolCalls: [], toolResults: [], steps: [] });

    await runOrchestrator({
      userId: 1,
      telegramUserId: 2,
      telegramChatId: 3,
      userName: 'Emir',
      userTimezone: 'Asia/Almaty',
      mode: 'reactive',
      userMessage: 'Расскажи, что ты помнишь про мои рабочие проекты',
      preferences: {},
      onboardingComplete: true,
    });

    expect(mockGetRecentConversation).toHaveBeenCalledWith(1, 20);
  });
});
