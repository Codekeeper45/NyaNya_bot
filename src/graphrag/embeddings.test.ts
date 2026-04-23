import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  config: { openrouterApiKey: 'test-key' },
}));

import { embedText, embedTexts } from './embeddings.js';

describe('embeddings', () => {
  it('embeds single text', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
      }),
    } as any);

    const result = await embedText('hello');
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('embeds multiple texts', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [0.1, 0.2] },
          { embedding: [0.3, 0.4] },
        ],
      }),
    } as any);

    const result = await embedTexts(['hello', 'world']);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([0.1, 0.2]);
    expect(result[1]).toEqual([0.3, 0.4]);
  });

  it('returns empty array for empty input', async () => {
    const result = await embedTexts([]);
    expect(result).toEqual([]);
  });

  it('throws on API error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as any);

    await expect(embedText('hello')).rejects.toThrow('rate limited');
  });
});
