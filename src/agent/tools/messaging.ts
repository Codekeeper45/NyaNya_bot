import { tool } from 'ai';
import { z } from 'zod';
import { InputFile } from 'grammy';
import { bot } from '../../bot/bot.js';
import { messagesRepo } from '../../db/repos/messages.js';
import { synthesizeSpeech } from '../../voice/tts.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:messaging');

export function messagingTools(chatId: number, userId: number) {
  return {
    message_send_text: tool({
      description: 'Отправить текстовое сообщение пользователю. Это ЕДИНСТВЕННЫЙ способ общения. ОБЯЗАТЕЛЬНО используй этот инструмент для каждого ответа.',
      inputSchema: z.object({
        text: z.string().describe('Текст сообщения на русском. Поддерживает Telegram Markdown.'),
      }),
      execute: async ({ text }) => {
        log.debug({ chatId, textLen: text.length }, 'Sending text');
        await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        await messagesRepo.create({
          userId,
          role: 'assistant',
          content: text,
          source: 'text',
        });
        return { sent: true, length: text.length };
      },
    }),

    message_send_voice: tool({
      description: 'Отправить голосовое сообщение. Для тёплых, эмоциональных, коротких сообщений.',
      inputSchema: z.object({
        text: z.string().describe('Текст для озвучки (будет синтезирован в голосовое)'),
      }),
      execute: async ({ text }) => {
        log.debug({ chatId, textLen: text.length }, 'Sending voice');
        try {
          const audioBuffer = await synthesizeSpeech(text);
          await bot.api.sendVoice(chatId, new InputFile(audioBuffer, 'voice.opus'));
          await messagesRepo.create({
            userId,
            role: 'assistant',
            content: text,
            source: 'voice',
            metadata: { voice: true },
          });
          return { sent: true, mode: 'voice' };
        } catch {
          // Fallback to text if TTS fails
          log.warn('TTS failed, falling back to text');
          await bot.api.sendMessage(chatId, text);
          await messagesRepo.create({
            userId,
            role: 'assistant',
            content: text,
            source: 'text',
            metadata: { intended_voice: true, tts_failed: true },
          });
          return { sent: true, mode: 'text_fallback' };
        }
      },
    }),
  };
}
