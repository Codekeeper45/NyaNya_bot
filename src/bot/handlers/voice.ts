import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { transcribeVoice, isSTTAvailable } from '../../voice/stt.js';
import { runOrchestrator } from '../../agent/orchestrator.js';
import { createChildLogger } from '../../lib/logger.js';
import { handleError } from '../../lib/errors.js';
import { withTyping } from '../typing.js';

const log = createChildLogger('handler:voice');

export function registerVoiceHandler(botInstance: Bot<BotContext>): void {
  botInstance.on('message:voice', async (ctx) => {
    if (!ctx.dbUser) return;

    if (!isSTTAvailable()) {
      await ctx.reply('Голосовые сообщения пока не поддерживаются (нет ключа OpenAI). Напиши текстом! 📝');
      return;
    }

    log.debug({ userId: ctx.dbUser.id }, 'Incoming voice message');

    try {
      const text =       await withTyping(ctx.api, ctx.chat.id, () => transcribeVoice(ctx.message.voice.file_id), 'upload_voice');
      log.debug({ text: text.slice(0, 50) }, 'Voice transcribed');

      await withTyping(ctx.api, ctx.chat.id, () => runOrchestrator({
        userId: ctx.dbUser!.id,
        telegramUserId: ctx.from.id,
        telegramChatId: ctx.chat.id,
        userName: ctx.dbUser!.name,
        userTimezone: ctx.dbUser!.timezone,
        wakeTime: ctx.dbUser!.wakeTime ?? undefined,
        sleepTime: ctx.dbUser!.sleepTime ?? undefined,
        preferences: (ctx.dbUser!.preferences as Record<string, unknown>) ?? {},
        mode: 'reactive',
        userMessage: text,
      }));
    } catch (err) {
      handleError(err, 'voice handler');
      await ctx.reply('Не разобрала голосовуху, можешь текстом? 🙏');
    }
  });
}
