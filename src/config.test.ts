import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('config', () => {
  it('reads GOOGLE_GENAI_API_KEY into config.googleGenaiApiKey', async () => {
    process.env.GOOGLE_GENAI_API_KEY = 'test-gemini-key';
    const { config } = await import('./config.js');
    expect(config.googleGenaiApiKey).toBe('test-gemini-key');
  });
});
