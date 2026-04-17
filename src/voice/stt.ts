import OpenAI from 'openai';
import { config } from '../config.js';
import { bot } from '../bot/bot.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('stt');

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!config.openaiApiKey) return null;
  if (!openai) openai = new OpenAI({ apiKey: config.openaiApiKey });
  return openai;
}

export function isSTTAvailable(): boolean {
  return !!config.openaiApiKey;
}

export async function transcribeVoice(fileId: string): Promise<string> {
  const client = getOpenAI();
  if (!client) {
    throw new Error('OpenAI API key not configured — STT unavailable');
  }

  try {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) throw new Error('Telegram did not return file_path');
    const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Failed to download voice file: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());

    const transcription = await client.audio.transcriptions.create({
      file: new File([buffer], 'voice.ogg', { type: 'audio/ogg' }),
      model: 'whisper-1',
      language: 'ru',
    });

    log.debug({ fileId, textLen: transcription.text.length }, 'Transcription complete');
    return transcription.text;
  } catch (err) {
    log.error({ err, fileId }, 'STT failed');
    throw err;
  }
}
