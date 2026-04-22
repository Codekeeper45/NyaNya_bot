import { tool } from 'ai';
import { z } from 'zod';
import { InputFile } from 'grammy';
import { bot } from '../../bot/bot.js';
import { messagesRepo } from '../../db/repos/messages.js';
import { synthesizeSpeech } from '../../voice/tts.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('tool:messaging');

const DUPLICATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DUPLICATE_PREFIX_LEN = 40;

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, '')
    .slice(0, 200);
}

function looksLikeDuplicate(newText: string, oldText: string): boolean {
  const n1 = normalizeForCompare(newText);
  const n2 = normalizeForCompare(oldText);
  if (n1.length < 10 || n2.length < 10) return false;
  // If one is substring of the other → likely duplicate
  if (n1.includes(n2) || n2.includes(n1)) return true;
  // If first N chars match
  return n1.slice(0, DUPLICATE_PREFIX_LEN) === n2.slice(0, DUPLICATE_PREFIX_LEN);
}

async function isRecentDuplicate(userId: number, text: string): Promise<boolean> {
  try {
    const recent = await messagesRepo.getRecent(userId, 10);
    const now = Date.now();
    for (const msg of recent) {
      if (msg.role !== 'assistant') continue;
      const age = now - new Date(msg.createdAt).getTime();
      if (age > DUPLICATE_WINDOW_MS) continue;
      if (looksLikeDuplicate(text, msg.content)) {
        log.warn({ userId, ageSec: Math.round(age / 1000) }, 'Duplicate message detected, skipping send');
        return true;
      }
    }
  } catch {
    // If check fails, allow send
  }
  return false;
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
        if (await isRecentDuplicate(userId, text)) return { sent: false, reason: 'duplicate' };

        log.debug({ chatId, textLen: text.length }, 'Sending text');
        try {
          await bot.api.sendMessage(chatId, markdownToHtml(text), { parse_mode: 'HTML' });
        } catch {
          await bot.api.sendMessage(chatId, text);
        }
        sent = true;
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
      description: 'Отправить голосовое сообщение. Для эмоциональных, коротких сообщений. Интонацией управляют аудио-теги: [whispers], [shouting], [excited], [serious], [sighs], [laughs], [curious], [panicked], [crying], [tired], [amazed], [sarcastic], [gasp], [giggles], [mischievously], [trembling], [short pause], [long pause] — и любые свои.',
      inputSchema: z.object({
        text: z.string().describe('Текст для озвучки. Теги управляют интонацией: [excited], [whispers], [serious], [sighs], [shouting] и т.д. Пример: "[sighs] Ладно, [excited] пошли!"'),
      }),
      execute: async ({ text }) => {
        if (sent) return { sent: false, reason: 'already_sent' };
        if (await isRecentDuplicate(userId, text)) return { sent: false, reason: 'duplicate' };

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
          // Fallback to text if TTS fails
          log.warn('TTS failed, falling back to text');
          await bot.api.sendMessage(chatId, text);
          sent = true;
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
