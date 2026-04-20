import { vi, describe, it, expect, beforeEach } from 'vitest';

import { webFetch } from './fetch.js';

beforeEach(() => {
  vi.unstubAllGlobals();
});

const SAMPLE_HTML = `<!DOCTYPE html>
<html><head><title>Test Article</title></head>
<body>
  <article>
    <h1>Test Article</h1>
    <p>${'Lorem ipsum '.repeat(400)}</p>
  </article>
</body></html>`;

describe('webFetch', () => {
  it('extracts title and text via Readability', async () => {
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
    const para1 = 'First paragraph. '.repeat(100); // ~1700 chars
    const para2 = 'Second paragraph. '.repeat(100); // ~1800 chars
    const para3 = 'Third paragraph. '.repeat(100);  // ~1800 chars
    const longHtml = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article><p>${para1}</p><p>${para2}</p><p>${para3}</p></article></body></html>`;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(longHtml),
    }));

    const result = await webFetch('https://example.com/long');

    expect(result.content.length).toBeLessThanOrEqual(4000);
    // Should end on a sentence boundary (period), not mid-word
    expect(result.content).toMatch(/[.\n]$/);
  });
});
