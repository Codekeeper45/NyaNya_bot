import { bot } from '../bot/bot.js';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('stt');

export function isSTTAvailable(): boolean {
  return !!config.openrouterApiKey;
}

/**
 * Transcribe voice message via OpenRouter's OpenAI-compatible Whisper endpoint.
 * Uses multipart form upload with the audio buffer directly.
 */
export async function transcribeVoice(fileId: string): Promise<string> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error('Telegram did not return file_path');

  const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Failed to download voice file: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = file.file_path.split('.').pop()?.toLowerCase() ?? 'ogg';

  log.info({ fileId, bytes: buffer.byteLength, ext }, 'Transcribing via Whisper');

  const formData = new FormData();
  formData.append('model', 'openai/whisper-1');
  formData.append('language', 'ru');
  formData.append('file', new Blob([buffer], { type: `audio/${ext}` }), `voice.${ext}`);

  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.openrouterApiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.error({ status: res.status, body }, 'Whisper transcription failed');
    throw new Error(`Whisper API error: ${res.status}`);
  }

  const data = await res.json() as { text: string };
  const text = data.text?.trim() ?? '';

  log.info({ fileId, textLen: text.length }, 'Transcription complete');
  return text;
}
