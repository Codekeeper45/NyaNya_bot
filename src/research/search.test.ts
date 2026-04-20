import { vi, describe, it, expect, beforeEach } from 'vitest';

import { webSearch, newsSearch } from './search.js';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('webSearch', () => {
  it('returns parsed search results from Brave API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        web: {
          results: [
            { title: 'Title 1', url: 'https://example.com/1', description: 'Snippet 1' },
            { title: 'Title 2', url: 'https://example.com/2', description: 'Snippet 2' },
          ],
        },
      }),
    }));

    const results = await webSearch('тест запрос');

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: 'Title 1', url: 'https://example.com/1', snippet: 'Snippet 1' });
  });

  it('passes count parameter in the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ web: { results: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await webSearch('query', 10);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('count=10');
  });

  it('includes extra_snippets=true in request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ web: { results: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await webSearch('query');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('extra_snippets=true');
  });

  it('maps extra_snippets from API response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        web: {
          results: [
            { title: 'T', url: 'https://example.com', description: 'Snippet', extra_snippets: ['extra 1', 'extra 2'] },
          ],
        },
      }),
    }));

    const results = await webSearch('query');

    expect(results[0].extraSnippets).toEqual(['extra 1', 'extra 2']);
  });

  it('returns empty array when API responds with error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({}),
    }));

    const results = await webSearch('query');
    expect(results).toEqual([]);
  });

  it('returns empty array when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const results = await webSearch('query');
    expect(results).toEqual([]);
  });
});

describe('newsSearch', () => {
  it('uses /news/search endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ results: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await newsSearch('новости');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/news/search');
  });

  it('returns parsed news results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        results: [
          { title: 'News 1', url: 'https://news.com/1', description: 'Summary 1' },
        ],
      }),
    }));

    const results = await newsSearch('новости');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ title: 'News 1', url: 'https://news.com/1', snippet: 'Summary 1' });
  });

  it('returns empty array on error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const results = await newsSearch('query');
    expect(results).toEqual([]);
  });
});
