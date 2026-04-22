import { vi, describe, it, expect, beforeEach } from 'vitest';

import { webFetch, webFetchMany } from './fetch.js';
import type { FetchManyResult } from './fetch.js';

vi.mock('./tavily.js', () => ({
  tavilyExtract: vi.fn(),
  isTavilyAvailable: vi.fn(() => false),
}));

const SAMPLE_HTML = `<!DOCTYPE html>
<html><head><title>Test Article</title></head>
<body>
  <article>
    <h1>Test Article</h1>
    <p>${'Lorem ipsum '.repeat(400)}</p>
  </article>
</body></html>`;

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('webFetch (JSDOM fallback)', () => {
  it('extracts title and text via Readability when Tavily unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(SAMPLE_HTML),
    }));

    const result = await webFetch('https://example.com/article');

    expect(result.title).toBeTruthy();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('limits content to 4000 characters', async () => {
    const longHtml = `<!DOCTYPE html><html><head><title>Long</title></head>
    <body><article><p>${'word '.repeat(2000)}</p></article></body></html>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(longHtml),
    }));

    const result = await webFetch('https://example.com/long');

    expect(result.content.length).toBeLessThanOrEqual(4000);
  });

  it('returns empty strings on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const result = await webFetch('https://example.com/broken');

    expect(result).toEqual({ title: '', content: '', excerpt: '' });
  });

  it('sends Chrome User-Agent header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(SAMPLE_HTML),
    });
    vi.stubGlobal('fetch', fetchMock);

    await webFetch('https://example.com/article');

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers['User-Agent']).toContain('Chrome');
  });

  it('trims content at paragraph boundary, not mid-sentence', async () => {
    const para1 = 'First paragraph. '.repeat(100);
    const para2 = 'Second paragraph. '.repeat(100);
    const para3 = 'Third paragraph. '.repeat(100);
    const longHtml = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article><p>${para1}</p><p>${para2}</p><p>${para3}</p></article></body></html>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(longHtml),
    }));

    const result = await webFetch('https://example.com/long');

    expect(result.content.length).toBeLessThanOrEqual(4000);
    expect(result.content).toMatch(/[.\n]$/);
  });
});

describe('webFetchMany (JSDOM fallback)', () => {
  it('returns FetchManyResult[] with url and fetchedOk fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(SAMPLE_HTML),
    }));

    const results = await webFetchMany(['https://example.com/1', 'https://example.com/2']);

    expect(results).toHaveLength(2);
    expect(results[0].url).toBe('https://example.com/1');
    expect(results[0].fetchedOk).toBe(true);
    expect(results[0].title).toBeTruthy();
  });

  it('sets fetchedOk=false for failed URLs without killing the batch', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(SAMPLE_HTML),
      });
    vi.stubGlobal('fetch', fetchMock);

    const results = await webFetchMany(['https://fail.com', 'https://ok.com']);

    expect(results).toHaveLength(2);
    expect(results[0].fetchedOk).toBe(false);
    expect(results[1].fetchedOk).toBe(true);
  });

  it('returns empty results for empty input', async () => {
    const results = await webFetchMany([]);
    expect(results).toEqual([]);
  });
});