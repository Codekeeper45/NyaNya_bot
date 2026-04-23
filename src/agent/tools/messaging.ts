import { tool } from 'ai';
import { z } from 'zod';
import { InputFile } from 'grammy';
import { bot } from '../../bot/bot.js';
import { messagesRepo } from '../../db/repos/messages.js';
import { synthesizeSpeech } from '../../voice/tts.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:messaging');

// Audio tags like [excited], [sighs], [short pause] — allowed only in voice messages
// This function strips them from text messages to avoid visual garbage
export function stripAudioTags(text: string): string {
  return text
    .replace(/\s*\[[^\]]+\]\s*/g, ' ')  // replace tag+surrounding spaces with single space
    .replace(/\s{2,}/g, ' ')            // collapse multiple spaces
    .trim();
}

export function markdownToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/^#{1,3} (.+)$/gm, '<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/__(.+?)__/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>');
}

export function messagingTools(chatId: number, userId: number) {
  let sent = false;

  const wasSent = () => sent;

  const tools = {
    message_send_text: tool({
      description: 'Отправить текстовое сообщение пользователю. Это ЕДИНСТВЕННЫЙ способ общения. ОБЯЗАТЕЛЬНО используй этот инструмент для каждого ответа.',
      inputSchema: z.object({
        text: z.string().describe('Текст сообщения на русском. Поддерживает Telegram Markdown.'),
      }),
      execute: async ({ text }) => {
        if (sent) return { sent: false, reason: 'already_sent' };

        const cleanText = stripAudioTags(text);
        if (cleanText !== text) {
          log.warn({ chatId, originalLen: text.length, cleanLen: cleanText.length }, 'Audio tags stripped from text message');
        }

        log.debug({ chatId, textLen: cleanText.length }, 'Sending text');
        try {
          await bot.api.sendMessage(chatId, markdownToHtml(cleanText), { parse_mode: 'HTML' });
        } catch {
          await bot.api.sendMessage(chatId, cleanText);
        }
        sent = true;
        await messagesRepo.create({
          userId,
          role: 'assistant',
          content: cleanText,
          source: 'text',
        });
        return { sent: true, length: cleanText.length };
      },
    }),

    message_send_voice: tool({
      description: 'Отправить голосовое сообщение. Для эмоциональных, коротких сообщений. Интонацией управляют аудио-теги: [whispers], [shouting], [excited], [serious], [sighs], [laughs], [curious], [panicked], [crying], [tired], [amazed], [sarcastic], [gasp], [giggles], [mischievously], [trembling], [short pause], [long pause] — и любые свои.',
      inputSchema: z.object({
        text: z.string().describe('Текст для озвучки. Теги управляют интонацией: [excited], [whispers], [serious], [sighs], [shouting] и т.д. Пример: "[sighs] Ладно, [excited] пошли!"'),
      }),
      execute: async ({ text }) => {
        if (sent) return { sent: false, reason: 'already_sent' };

        log.debug({ chatId, textLen: text.length }, 'Sending voice');
        try {
          const audioBuffer = await synthesizeSpeech(text);
          await bot.api.sendVoice(chatId, new InputFile(audioBuffer, 'voice.opus'));
          sent = true;
          await messagesRepo.create({
            userId,
            role: 'assistant',
            content: text,
            source: 'voice',
            metadata: { voice: true },
          });
          return { sent: true, mode: 'voice' };
        } catch {
          // Fallback to text if TTS fails — strip audio tags so they don't appear as garbage
          const fallbackText = stripAudioTags(text);
          log.warn({ chatId, originalLen: text.length, cleanLen: fallbackText.length }, 'TTS failed, falling back to text');
          try {
            await bot.api.sendMessage(chatId, markdownToHtml(fallbackText), { parse_mode: 'HTML' });
          } catch {
            await bot.api.sendMessage(chatId, fallbackText);
          }
          sent = true;
          await messagesRepo.create({
            userId,
            role: 'assistant',
            content: fallbackText,
            source: 'text',
            metadata: { intended_voice: true, tts_failed: true },
          });
          return { sent: true, mode: 'text_fallback' };
        }
      },
    }),

    message_send_photo: tool({
      description: 'Отправить изображение пользователю по URL. Используй для отправки картинок из интернета, инфографики, скриншотов.',
      inputSchema: z.object({
        url: z.string().url().describe('URL изображения (jpg, png, gif, webp)'),
        caption: z.string().optional().describe('Подпись к изображению'),
      }),
      execute: async ({ url, caption }) => {
        if (sent) return { sent: false, reason: 'already_sent' };
        try {
          log.debug({ chatId, url }, 'Sending photo by URL');
          await bot.api.sendPhoto(chatId, url, caption ? { caption } : undefined);
        } catch (err) {
          log.warn({ err, url }, 'Failed to send photo by URL, trying download');
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) return { error: `Не удалось загрузить изображение: HTTP ${res.status}` };
            const buf = Buffer.from(await res.arrayBuffer());
            await bot.api.sendPhoto(chatId, new InputFile(buf, 'image.jpg'), caption ? { caption } : undefined);
          } catch {
            return { error: 'Не удалось отправить изображение.' };
          }
        }
        sent = true;
        await messagesRepo.create({ userId, role: 'assistant', content: caption ?? url, source: 'text', metadata: { photo: true } });
        return { sent: true };
      },
    }),
  };

  return { tools, wasSent };
}
