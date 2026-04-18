// Central E2E harness. Import this in e2e tests AFTER vi.mock calls.
// The harness wires together a real grammy Bot instance with mocked external dependencies.
import { vi } from 'vitest';
import { Bot } from 'grammy';
import type { BotContext } from '../bot/bot.js';
import { registerCommands } from '../bot/handlers/commands.js';
import { authMiddleware } from '../bot/middleware/auth.js';
import { rateLimitMiddleware } from '../bot/middleware/ratelimit.js';
import { contextMiddleware } from '../bot/middleware/context.js';
import type { Update } from '@grammyjs/types';
import { makeTextUpdate, makeCommandUpdate } from './fixtures.js';

export function createBotHarness(mockBotApi: Record<string, ReturnType<typeof vi.fn>>) {
  const bot = new Bot<BotContext>('test:token', {
    botInfo: {
      id: 42,
      first_name: 'OpekunBot',
      is_bot: true,
      username: 'opekunbot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_manage_bots: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    },
  });

  // Replace bot.api methods with mocks
  Object.assign(bot.api, mockBotApi);

  // Register middleware stack
  bot.use(authMiddleware);
  bot.use(rateLimitMiddleware);
  bot.use(contextMiddleware);

  // Register command handlers
  registerCommands(bot);

  // Register message handlers (imported dynamically to avoid circular deps)
  bot.on('message:text', async (ctx, next) => {
    // Commands handler already handles OAuth callback + reset — pass rest to orchestrator
    await next();
  });

  return {
    bot,
    send: (update: Update) => bot.handleUpdate(update),
    sendText: (text: string) => bot.handleUpdate(makeTextUpdate(text)),
    sendCommand: (cmd: string) => bot.handleUpdate(makeCommandUpdate(cmd)),
    api: mockBotApi,
    sentMessages: () => (mockBotApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls,
    lastMessage: () => {
      const calls = (mockBotApi.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      return calls[calls.length - 1]?.[1] as string | undefined;
    },
  };
}
