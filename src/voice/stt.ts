import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { config } from '../config.js';
import { bot } from '../bot/bot.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('stt');

const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });

export function isSTTAvailable(): boolean {
  return !!config.openrouterApiKey;
}

export async function transcribeVoice(fileId: string): Promise<string> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error('Telegram did not return file_path');

  const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Failed to download voice file: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const base64 = buffer.toString('base64');

  const ext = file.file_path.split('.').pop() ?? 'ogg';
  const mimeType = ext === 'mp4' ? 'audio/mp4' : ext === 'mp3' ? 'audio/mpeg' : 'audio/ogg';

  log.debug({ fileId, bytes: buffer.byteLength, mimeType }, 'Transcribing via Gemini');

  const result = await generateText({
    model: openrouter('google/gemini-2.0-flash-001'),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Транскрибируй это аудио дословно на том языке, на котором говорит человек. Верни только текст без пояснений.' },
        { type: 'file', data: base64, mediaType: mimeType },
      ],
    }],
  });

  const text = result.text.trim();
  log.debug({ fileId, textLen: text.length }, 'Transcription complete');
  return text;
}
