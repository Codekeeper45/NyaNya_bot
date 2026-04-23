import { spawn } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('tts');

const GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const GEMINI_TTS_VOICE = 'Leda';
const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;

let genai: GoogleGenAI | null = null;

function getGemini(): GoogleGenAI | null {
  if (!config.googleGenaiApiKey) return null;
  if (!genai) genai = new GoogleGenAI({ apiKey: config.googleGenaiApiKey });
  return genai;
}

function buildTtsPrompt(text: string): string {
  return [
    '# AUDIO PROFILE: Опекун',
    'Role: Тёплая, заботливая AI-наставник для русскоязычных пользователей. Говорит на русском, живо и естественно.',
    'Voice: Leda (fixed, configured in speechConfig).',
    '',
    '## THE SCENE',
    'Личная переписка в Telegram. Пользователь — тот, о ком Опекун заботится.',
    '',
    '### DIRECTOR\'S NOTES',
    '- Тон по умолчанию: тёплый, дружелюбный, как старшая сестра.',
    '- Адаптируйся: расстроен — будь мягкой, опасность — серьёзной, радость — радуйся вместе.',
    '- Не зачитывай аудио-теги вслух — они управляют интонацией, а не произносятся.',
    '- Preserve meaning exactly. Return only the spoken transcript, no explanations.',
    '',
    '#### TRANSCRIPT',
    text,
  ].join('\n');
}

async function convertPcmToOpusOgg(pcm: Buffer): Promise<Buffer> {
  if (!ffmpeg.path) throw new Error('FFmpeg binary path is unavailable');

  return await new Promise<Buffer>((resolve, reject) => {
    const args = [
      '-f', 's16le',
      '-ar', String(PCM_SAMPLE_RATE),
      '-ac', String(PCM_CHANNELS),
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', '24k',
      '-vbr', 'on',
      '-compression_level', '10',
      '-application', 'voip',
      '-f', 'ogg',
      'pipe:1',
    ];

    const ff = spawn(ffmpeg.path, args);
    const chunks: Buffer[] = [];
    const stderr: string[] = [];

    ff.stdout?.on('data', chunk => chunks.push(Buffer.from(chunk)));
    ff.stderr?.on('data', chunk => stderr.push(String(chunk)));
    ff.on('error', err => reject(err));
    ff.on('close', code => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      reject(new Error(`FFmpeg Opus conversion failed (code ${code}): ${stderr.join('').trim()}`));
    });

    if (!ff.stdin) {
      reject(new Error('FFmpeg stdin is unavailable'));
      return;
    }
    ff.stdin.write(pcm);
    ff.stdin.end();
  });
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const client = getGemini();
  if (!client) {
    throw new Error('Gemini API key not configured — TTS unavailable');
  }

  try {
    const response = await client.models.generateContent({
      model: GEMINI_TTS_MODEL,
      contents: [{ parts: [{ text: buildTtsPrompt(text) }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE },
          },
        },
      },
    });

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) throw new Error('Gemini TTS response did not contain inline audio data');
    const pcm = Buffer.from(data, 'base64');
    return await convertPcmToOpusOgg(pcm);
  } catch (err) {
    log.error({ err }, 'TTS failed');
    throw err;
  }
}
