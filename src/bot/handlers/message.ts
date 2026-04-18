import type { Bot } from 'grammy';
import type { BotContext } from '../bot.js';
import { runOrchestrator } from '../../agent/orchestrator.js';
import { createChildLogger } from '../../lib/logger.js';
import { handleError } from '../../lib/errors.js';
import { config } from '../../config.js';
import { withTyping } from '../typing.js';
import { parseDocument, isSupportedDocument } from '../../documents/parse.js';

const log = createChildLogger('handler:message');

export function registerMessageHandler(botInstance: Bot<BotContext>): void {
  // Handle text messages
  botInstance.on('message:text', async (ctx) => {
    if (!ctx.dbUser) return;
    if (ctx.message.text.startsWith('/')) return;

    log.debug({ userId: ctx.dbUser.id, text: ctx.message.text.slice(0, 50) }, 'Incoming text message');

    try {
      await withTyping(ctx.api, ctx.chat.id, () => runOrchestrator({
        userId: ctx.dbUser!.id,
        telegramUserId: ctx.from.id,
        telegramChatId: ctx.chat.id,
        userName: ctx.dbUser!.name,
        userTimezone: ctx.dbUser!.timezone,
        wakeTime: ctx.dbUser!.wakeTime ?? undefined,
        sleepTime: ctx.dbUser!.sleepTime ?? undefined,
        preferences: (ctx.dbUser!.preferences as Record<string, unknown>) ?? {},
        onboardingComplete: ctx.dbUser!.onboardingComplete,
        mode: 'reactive',
        userMessage: ctx.message.text,
      }));
    } catch (err) {
      handleError(err, 'text message handler');
      await ctx.reply('Ой, у меня сейчас мысли путаются 🥲 Попробуй через минуту.');
    }
  });

  type PhotoImage = { data: string; mimeType: string };
  type AlbumEntry = { photos: PhotoImage[]; caption: string; timer: ReturnType<typeof setTimeout> };

  // Album accumulator: media_group_id → entry
  const albums = new Map<string, AlbumEntry>();

  async function processPhotos(
    dbUser: NonNullable<BotContext['dbUser']>,
    from: { id: number },
    chatId: number,
    caption: string,
    images: PhotoImage[],
  ) {
    await withTyping(botInstance.api, chatId, () => runOrchestrator({
      userId: dbUser.id,
      telegramUserId: from.id,
      telegramChatId: chatId,
      userName: dbUser.name,
      userTimezone: dbUser.timezone,
      wakeTime: dbUser.wakeTime ?? undefined,
      sleepTime: dbUser.sleepTime ?? undefined,
      preferences: (dbUser.preferences as Record<string, unknown>) ?? {},
      onboardingComplete: dbUser.onboardingComplete,
      mode: 'reactive',
      userMessage: caption,
      images,
    }));
  }

  async function downloadPhoto(fileId: string): Promise<{ data: string; mimeType: string }> {
    const file = await botInstance.api.getFile(fileId);
    if (!file.file_path) throw new Error('No file_path');
    const ext = file.file_path.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    return { data, mimeType };
  }

  // Handle photo messages (single or album)
  botInstance.on('message:photo', async (ctx) => {
    if (!ctx.dbUser) return;

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const caption = ctx.message.caption ?? '';
    const groupId = ctx.message.media_group_id;

    log.debug({ userId: ctx.dbUser.id, groupId }, 'Incoming photo');

    try {
      const image = await downloadPhoto(photo.file_id);

      if (!groupId) {
        // Single photo — process immediately
        await processPhotos(ctx.dbUser, ctx.from, ctx.chat.id, caption || 'Что на этом фото?', [image]);
        return;
      }

      // Album: accumulate photos and flush after 1.5s of silence
      const existing = albums.get(groupId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.photos.push(image);
        if (caption) existing.caption = caption;
      } else {
        albums.set(groupId, { photos: [image], caption, timer: setTimeout(() => {}, 0) });
      }

      const entry = albums.get(groupId)!;
      entry.timer = setTimeout(async () => {
        albums.delete(groupId);
        const finalCaption = entry.caption || `Что на этих ${entry.photos.length} фото?`;
        try {
          await processPhotos(ctx.dbUser!, ctx.from, ctx.chat.id, finalCaption, entry.photos);
        } catch (err) {
          handleError(err, 'album photo handler');
          await ctx.reply('Не смогла рассмотреть фото 🙈 Попробуй еще раз.');
        }
      }, 1500);

    } catch (err) {
      handleError(err, 'photo message handler');
      await ctx.reply('Не смогла рассмотреть фото 🙈 Попробуй еще раз или пришли текстом.');
    }
  });

  // Handle document messages (PDF, Word, Excel, etc.)
  botInstance.on('message:document', async (ctx) => {
    if (!ctx.dbUser) return;

    const doc = ctx.message.document;
    const filename = doc.file_name ?? 'document';
    const mimeType = doc.mime_type ?? 'application/octet-stream';

    if (!isSupportedDocument(mimeType, filename)) {
      await ctx.reply(`Формат «${filename.split('.').pop()?.toUpperCase()}» не поддерживается. Поддерживаю: PDF, Word (docx), Excel (xlsx), PowerPoint (pptx), TXT, CSV, MD, JSON, HTML.`);
      return;
    }

    log.debug({ userId: ctx.dbUser.id, filename, mimeType }, 'Incoming document');

    try {
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) throw new Error('Telegram did not return file_path');
      const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Failed to download document: ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());

      await ctx.reply('Читаю документ... ⏳');

      const parsed = await withTyping(ctx.api, ctx.chat.id, () => parseDocument(buffer, filename, mimeType));

      const pagesNote = parsed.pages ? ` (${parsed.pages} стр.)` : '';
      const userMessage = `${ctx.message.caption ? ctx.message.caption + '\n\n' : ''}[Документ: ${filename}${pagesNote}]\n\n${parsed.text}`;

      await withTyping(ctx.api, ctx.chat.id, () => runOrchestrator({
        userId: ctx.dbUser!.id,
        telegramUserId: ctx.from.id,
        telegramChatId: ctx.chat.id,
        userName: ctx.dbUser!.name,
        userTimezone: ctx.dbUser!.timezone,
        wakeTime: ctx.dbUser!.wakeTime ?? undefined,
        sleepTime: ctx.dbUser!.sleepTime ?? undefined,
        preferences: (ctx.dbUser!.preferences as Record<string, unknown>) ?? {},
        onboardingComplete: ctx.dbUser!.onboardingComplete,
        mode: 'reactive',
        userMessage,
      }));
    } catch (err) {
      handleError(err, 'document handler');
      await ctx.reply('Не смогла прочитать документ 😔 Проверь формат файла или попробуй скопировать текст вручную.');
    }
  });
}
