import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

type TtsModule = typeof import('./tts.js');

function makeChildProcess({
  output = Buffer.from('ogg-opus'),
  exitCode = 0,
  stderr = '',
}: {
  output?: Buffer;
  exitCode?: number;
  stderr?: string;
}) {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write: vi.fn(),
    end: vi.fn(() => {
      setTimeout(() => {
        if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
        if (output.length > 0) proc.stdout.emit('data', output);
        proc.emit('close', exitCode);
      }, 0);
    }),
  };
  return proc;
}

async function loadTtsModule(opts?: {
  apiKey?: string;
  ffmpegPath?: string | null;
  generateData?: string | null;
  exitCode?: number;
  stderr?: string;
}) {
  const apiKey = opts?.apiKey ?? 'gemini-key';
  const ffmpegPath = opts?.ffmpegPath ?? '/usr/bin/ffmpeg';
  const generateData = opts?.generateData ?? Buffer.from('pcm-audio').toString('base64');
  const proc = makeChildProcess({
    exitCode: opts?.exitCode ?? 0,
    stderr: opts?.stderr ?? '',
  });

  vi.resetModules();
  vi.doMock('../config.js', () => ({
    config: { googleGenaiApiKey: apiKey },
  }));
  vi.doMock('@ffmpeg-installer/ffmpeg', () => ({ default: { path: ffmpegPath } }));
  vi.doMock('child_process', () => ({
    spawn: vi.fn(() => proc),
  }));
  const generateContent = vi.fn(async () => ({
    candidates: [
      {
        content: {
          parts: generateData
            ? [{ inlineData: { data: generateData } }]
            : [{ text: 'no audio' }],
        },
      },
    ],
  }));
  vi.doMock('@google/genai', () => ({
    GoogleGenAI: vi.fn(function () {
      return {
        models: { generateContent },
      };
    }),
  }));

  const mod = await import('./tts.js');
  return { mod, proc, generateContent };
}

afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
});

describe('tts', () => {
  it('throws when Gemini API key is missing', async () => {
    const { mod } = await loadTtsModule({ apiKey: '' });
    await expect(mod.synthesizeSpeech('Привет')).rejects.toThrow('Gemini API key not configured');
  });

  it('returns OGG/Opus buffer when Gemini and conversion succeed', async () => {
    const { mod, generateContent } = await loadTtsModule();
    const audio = await mod.synthesizeSpeech('Привет');
    expect(audio).toEqual(Buffer.from('ogg-opus'));
    expect(generateContent).toHaveBeenCalledTimes(1);
    const input = generateContent.mock.calls[0]?.[0];
    expect(input?.model).toBe('gemini-3.1-flash-tts-preview');
    expect(input?.config?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName).toBe('Leda');
    const prompt = input?.contents?.[0]?.parts?.[0]?.text as string;
    expect(prompt).toContain('AUDIO PROFILE');
    expect(prompt).toContain('DIRECTOR');
    expect(prompt).toContain('TRANSCRIPT');
    expect(prompt).toContain('Leda');
    expect(prompt.toLowerCase()).toContain('не зачитывай');
    expect(prompt).toContain('Привет');
  });

  it('throws when ffmpeg conversion fails', async () => {
    const { mod } = await loadTtsModule({ exitCode: 1, stderr: 'bad format' });
    await expect(mod.synthesizeSpeech('Привет')).rejects.toThrow('FFmpeg Opus conversion failed');
  });
});
