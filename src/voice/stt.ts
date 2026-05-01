import { config } from '../config.js';
import { bot } from '../bot/bot.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('stt');

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

  const ext = file.file_path.split('.').pop()?.toLowerCase() ?? 'ogg';
  const format = ext === 'mp4' ? 'mp4' : ext === 'mp3' ? 'mp3' : 'ogg';

  log.debug({ fileId, bytes: buffer.byteLength, format }, 'Transcribing via Whisper (OpenRouter)');

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: `audio/${format}` }), `voice.${format}`);
  form.append('model', 'openai/whisper-1');
  form.append('response_format', 'text');

  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouterApiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const errBody = await res.text();
    log.error({ status: res.status, body: errBody.slice(0, 500) }, 'Whisper transcription failed');
    throw new Error(`Whisper API error: ${res.status}`);
  }

  const text = (await res.text()).trim();
  log.debug({ fileId, textLen: text.length }, 'Transcription complete');
  return text;
}
