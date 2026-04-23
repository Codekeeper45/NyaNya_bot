import { Bot, Context } from 'grammy';
import { config } from '../config.js';
import type { User } from '../db/schema.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('bot');

export interface BotContext extends Context {
  dbUser?: User;
}

export const bot = new Bot<BotContext>(config.telegramBotToken);

bot.catch((err) => {
  log.error({ err }, 'Unhandled bot error');
});
