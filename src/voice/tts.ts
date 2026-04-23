import { spawn } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('tts');

const GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const DEFAULT_VOICE = 'Leda';
const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;

let genai: GoogleGenAI | null = null;

function getGemini(): GoogleGenAI | null {
  if (!config.googleGenaiApiKey) return null;
  if (!genai) genai = new GoogleGenAI({ apiKey: config.googleGenaiApiKey });
  return genai;
}

export type VoiceGender = 'female' | 'male';

export interface VoiceProfile {
  name: string;
  tone: string;
  pitch: string;
  personality: string;
  gender: VoiceGender;
  emoji: string;
}

export const VOICE_PROFILES: VoiceProfile[] = [
  { name: 'Achernar', tone: 'Soft', pitch: 'Higher pitch', personality: 'Мягкий, нежный, подходит для утешения и ласки', gender: 'female', emoji: '🌙' },
  { name: 'Achird', tone: 'Friendly', pitch: 'Lower middle pitch', personality: 'Дружелюбный, тёплый, универсальный собеседник', gender: 'female', emoji: '🌟' },
  { name: 'Algenib', tone: 'Gravelly', pitch: 'Lower pitch', personality: 'Хриплый, харизматичный, для серьёзных тем', gender: 'male', emoji: '🔮' },
  { name: 'Algieba', tone: 'Smooth', pitch: 'Lower pitch', personality: 'Плавный, спокойный, идеален для объяснений', gender: 'male', emoji: '💫' },
  { name: 'Alnilam', tone: 'Firm', pitch: 'Lower middle pitch', personality: 'Твёрдый, уверенный, для мотивации и инструкций', gender: 'male', emoji: '⚔️' },
  { name: 'Aoede', tone: 'Breezy', pitch: 'Middle pitch', personality: 'Лёгкий, воздушный, для повседневных бесед', gender: 'female', emoji: '🍃' },
  { name: 'Autonoe', tone: 'Bright', pitch: 'Middle pitch', personality: 'Яркий, энергичный, для радостных новостей', gender: 'female', emoji: '✨' },
  { name: 'Callirrhoe', tone: 'Easy-going', pitch: 'Middle pitch', personality: 'Непринуждённый, расслабленный, для дружеского тона', gender: 'female', emoji: '🌊' },
  { name: 'Charon', tone: 'Informative', pitch: 'Lower pitch', personality: 'Информативный, взвешенный, для фактов и новостей', gender: 'male', emoji: '🚢' },
  { name: 'Despina', tone: 'Smooth', pitch: 'Middle pitch', personality: 'Гладкий, ровный, универсальный', gender: 'female', emoji: '💎' },
  { name: 'Enceladus', tone: 'Breathy', pitch: 'Lower pitch', personality: 'Дыхательный, интимный, для тихих моментов', gender: 'male', emoji: '🪐' },
  { name: 'Erinome', tone: 'Clear', pitch: 'Middle pitch', personality: 'Чёткий, ясный, для объяснений и обучения', gender: 'female', emoji: '📖' },
  { name: 'Fenrir', tone: 'Excitable', pitch: 'Lower middle pitch', personality: 'Возбудимый, эмоциональный, для шуток и сюрпризов', gender: 'male', emoji: '🐺' },
  { name: 'Gacrux', tone: 'Mature', pitch: 'Middle pitch', personality: 'Зрелый, мудрый, для советов и размышлений', gender: 'male', emoji: '🦉' },
  { name: 'Iapetus', tone: 'Clear', pitch: 'Lower middle pitch', personality: 'Чёткий, глубокий, для деловых разговоров', gender: 'male', emoji: '🏛️' },
  { name: 'Kore', tone: 'Firm', pitch: 'Middle pitch', personality: 'Твёрдый, сбалансированный, хороший дефолт', gender: 'female', emoji: '🌺' },
  { name: 'Laomedeia', tone: 'Upbeat', pitch: 'Higher pitch', personality: 'Жизнерадостный, бодрый, для утренних приветствий', gender: 'female', emoji: '☀️' },
  { name: 'Leda', tone: 'Youthful', pitch: 'Higher pitch', personality: 'Молодой, игривый, энергичный, текущий дефолт', gender: 'female', emoji: '🦢' },
  { name: 'Orus', tone: 'Firm', pitch: 'Lower middle pitch', personality: 'Твёрдый, уверенный, для мотивации', gender: 'male', emoji: '🌋' },
  { name: 'Puck', tone: 'Upbeat', pitch: 'Middle pitch', personality: 'Весёлый, оживлённый, для шуток', gender: 'male', emoji: '🎭' },
  { name: 'Pulcherrima', tone: 'Forward', pitch: 'Middle pitch', personality: 'Напористый, прямой, для важных напоминаний', gender: 'female', emoji: '⚡' },
  { name: 'Rasalgethi', tone: 'Informative', pitch: 'Middle pitch', personality: 'Информативный, нейтральный, для новостей', gender: 'male', emoji: '📡' },
  { name: 'Sadachbia', tone: 'Lively', pitch: 'Lower pitch', personality: 'Живой, динамичный, для активных обсуждений', gender: 'male', emoji: '🔥' },
  { name: 'Sadaltager', tone: 'Knowledgeable', pitch: 'Middle pitch', personality: 'Знающий, экспертный, для обучения', gender: 'male', emoji: '🎓' },
  { name: 'Schedar', tone: 'Even', pitch: 'Lower middle pitch', personality: 'Ровный, стабильный, для долгих бесед', gender: 'female', emoji: '🍁' },
  { name: 'Sulafat', tone: 'Warm', pitch: 'Middle pitch', personality: 'Тёплый, уютный, для поддержки и заботы', gender: 'female', emoji: '🧣' },
  { name: 'Umbriel', tone: 'Easy-going', pitch: 'Lower middle pitch', personality: 'Непринуждённый, мягкий, для вечерних разговоров', gender: 'male', emoji: '🌙' },
  { name: 'Vindemiatrix', tone: 'Gentle', pitch: 'Middle pitch', personality: 'Нежный, ласковый, для утешения', gender: 'female', emoji: '💌' },
  { name: 'Zephyr', tone: 'Current', pitch: 'Bright', personality: 'Современный, яркий, для молодёжного тона', gender: 'male', emoji: '💨' },
  { name: 'Zubenelgenubi', tone: 'Casual', pitch: 'Lower middle pitch', personality: 'Неформальный, расслабленный, для друзей', gender: 'male', emoji: '🛋️' },
];

export function getVoiceProfiles(): VoiceProfile[] {
  return VOICE_PROFILES;
}

export function getVoiceProfile(name: string): VoiceProfile | undefined {
  return VOICE_PROFILES.find(v => v.name.toLowerCase() === name.toLowerCase());
}

export function validateVoiceName(name: string): string {
  const found = getVoiceProfile(name);
  return found ? found.name : DEFAULT_VOICE;
}

function buildTtsPrompt(text: string, voiceName: string): string {
  const profile = getVoiceProfile(voiceName);
  return [
    `# AUDIO PROFILE: ${voiceName}`,
    `Role: Тёплая, заботливая AI-наставник для русскоязычных пользователей.`,
    `Voice: ${voiceName} (${profile?.tone ?? 'unknown'}, ${profile?.pitch ?? 'unknown'}).`,
    `Personality: ${profile?.personality ?? 'Универсальный'}.`,
    '',
    '## THE SCENE',
    'Личная переписка в Telegram. Пользователь — тот, о ком Опекун заботится.',
    '',
    '### DIRECTOR\'S NOTES',
    '- Адаптируй тон к контексту сообщения.',
    '- Не зачитывай аудио-теги вслух — они управляют интонацией.',
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

export async function synthesizeSpeech(text: string, voiceName?: string): Promise<Buffer> {
  const client = getGemini();
  if (!client) {
    throw new Error('Gemini API key not configured — TTS unavailable');
  }

  const voice = validateVoiceName(voiceName ?? '');

  try {
    const response = await client.models.generateContent({
      model: GEMINI_TTS_MODEL,
      contents: [{ parts: [{ text: buildTtsPrompt(text, voice) }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) throw new Error('Gemini TTS response did not contain inline audio data');
    const pcm = Buffer.from(data, 'base64');
    return await convertPcmToOpusOgg(pcm);
  } catch (err) {
    log.error({ err, voice }, 'TTS failed');
    throw err;
  }
}
