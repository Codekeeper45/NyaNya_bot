import { describe, it, expect, vi, beforeEach } from 'vitest';
import { embeddingCache } from './cache.js';

vi.mock('../config.js', () => ({
  config: { openrouterApiKey: 'test-key' },
}));

import { embedText, embedTexts } from './embeddings.js';

function vec(seed: number): number[] {
  const v = new Array(1536).fill(0);
  v[0] = seed;
  return v;
}

describe('embeddings', () => {
  beforeEach(() => {
    embeddingCache.clear();
  });
  it('embeds single text', async () => {
    const embedding = vec(0.1);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding }] }),
    } as any);

    const result = await embedText('hello');
    expect(result).toEqual(embedding);
  });

  it('embeds multiple texts', async () => {
    const emb1 = vec(0.1);
    const emb2 = vec(0.3);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: emb1 }, { embedding: emb2 }],
      }),
    } as any);

    const result = await embedTexts(['hello', 'world']);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(emb1);
    expect(result[1]).toEqual(emb2);
  });

  it('maps generated embeddings only to missing texts after partial cache hit', async () => {
    const emb1 = vec(0.1);
    const emb2 = vec(0.3);
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: emb1 }] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: emb2 }] }),
      } as any);

    await expect(embedText('cached')).resolves.toEqual(emb1);
    const result = await embedTexts(['cached', 'missing']);

    expect(result).toEqual([emb1, emb2]);
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
