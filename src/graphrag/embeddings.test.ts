import { describe, it, expect, vi, beforeEach } from 'vitest';
import { embeddingCache } from './cache.js';

vi.mock('../config.js', () => ({
  config: { openrouterApiKey: 'test-key' },
}));

import { embedText, embedTexts } from './embeddings.js';

describe('embeddings', () => {
  beforeEach(() => {
    embeddingCache.clear();
  });
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

  it('maps generated embeddings only to missing texts after partial cache hit', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2] }],
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.3, 0.4] }],
        }),
      } as any);

    await expect(embedText('cached')).resolves.toEqual([0.1, 0.2]);
    const result = await embedTexts(['cached', 'missing']);

    expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body);
    expect(secondCallBody.input).toEqual(['missing']);
  });

  it('throws when embeddings API returns unexpected count', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as any);

    await expect(embedTexts(['hello'])).rejects.toThrow('Embeddings API returned 0 embeddings for 1 inputs');
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
