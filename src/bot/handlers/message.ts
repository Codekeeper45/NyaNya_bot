import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { runOrchestrator } from '../../agent/orchestrator.js';
import { createChildLogger } from '../../lib/logger.js';
import { handleError } from '../../lib/errors.js';

const log = createChildLogger('handler:message');

export function registerMessageHandler(botInstance: Bot<BotContext>): void {
  botInstance.on('message:text', async (ctx) => {
    if (!ctx.dbUser) return;
    if (ctx.message.text.startsWith('/')) return; // Commands handled separately

    log.debug({ userId: ctx.dbUser.id, text: ctx.message.text.slice(0, 50) }, 'Incoming message');

    await ctx.replyWithChatAction('typing');

    try {
      await runOrchestrator({
        userId: ctx.dbUser.id,
        telegramUserId: ctx.from.id,
        telegramChatId: ctx.chat.id,
        userName: ctx.dbUser.name,
        userTimezone: ctx.dbUser.timezone,
        wakeTime: ctx.dbUser.wakeTime ?? undefined,
        sleepTime: ctx.dbUser.sleepTime ?? undefined,
        preferences: (ctx.dbUser.preferences as Record<string, unknown>) ?? {},
        mode: 'reactive',
        userMessage: ctx.message.text,
      });
    } catch (err) {
      handleError(err, 'message handler');
      await ctx.reply('Ой, у меня сейчас мысли путаются 🥲 Попробуй через минуту.');
    }
  });
}
