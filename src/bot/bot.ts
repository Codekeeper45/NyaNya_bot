import { Bot, Context } from 'grammy';
import { config } from '../config.js';
import type { User } from '../db/schema.js';

export interface BotContext extends Context {
  dbUser?: User;
}

export const bot = new Bot<BotContext>(config.telegramBotToken);
