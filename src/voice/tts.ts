import OpenAI from 'openai';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('tts');

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!config.openaiApiKey) return null;
  if (!openai) openai = new OpenAI({ apiKey: config.openaiApiKey });
  return openai;
}

export function isTTSAvailable(): boolean {
  return !!config.openaiApiKey;
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const client = getOpenAI();
  if (!client) {
    throw new Error('OpenAI API key not configured — TTS unavailable');
  }

  try {
    const response = await client.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text,
      response_format: 'opus',
    });
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    log.error({ err }, 'TTS failed');
    throw err;
  }
}
