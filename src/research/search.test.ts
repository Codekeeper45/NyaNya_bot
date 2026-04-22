import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./tavily.js', () => ({
  tavilySearch: vi.fn(),
  isTavilyAvailable: vi.fn(() => true),
}));

import { webSearch, newsSearch } from './search.js';
import { tavilySearch, isTavilyAvailable } from './tavily.js';

const mockTavilySearch = tavilySearch as ReturnType<typeof vi.fn>;
const mockIsTavilyAvailable = isTavilyAvailable as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mockIsTavilyAvailable.mockReturnValue(true);
});

describe('webSearch (Tavily primary)', () => {
  it('returns Tavily results when available', async () => {
    mockTavilySearch.mockResolvedValue([
      { title: 'Tavily Title', url: 'https://tavily.com/1', snippet: 'Tavily snippet', score: 0.9 },
    ]);

    const results = await webSearch('тест запрос');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ title: 'Tavily Title', url: 'https://tavily.com/1', snippet: 'Tavily snippet', score: 0.9 });
    expect(mockTavilySearch).toHaveBeenCalledWith('тест запрос', { count: 5, topic: 'general' });
  });

  it('returns empty array from Tavily without falling back to Brave', async () => {
    mockTavilySearch.mockResolvedValue([]);

    const results = await webSearch('ничего нет');

    expect(results).toEqual([]);
  });

  it('falls back to Brave on Tavily error', async () => {
    mockTavilySearch.mockRejectedValue(new Error('Tavily API error'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        web: {
          results: [
            { title: 'Brave Title', url: 'https://brave.com/1', description: 'Brave snippet' },
          ],
        },
      }),
    }));

    const results = await webSearch('тест запрос');

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Brave Title');
  });

  it('passes count to Tavily', async () => {
    mockTavilySearch.mockResolvedValue([]);

    await webSearch('query', 10);

    expect(mockTavilySearch).toHaveBeenCalledWith('query', { count: 10, topic: 'general' });
  });
});

describe('webSearch (Brave fallback)', () => {
  beforeEach(() => {
    mockIsTavilyAvailable.mockReturnValue(false);
  });

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

  it('maps extra_snippets from Brave API response', async () => {
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

  it('returns empty array when Brave API responds with error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({}),
    }));

    const results = await webSearch('query');
    expect(results).toEqual([]);
  });

  it('returns empty array when Brave fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const results = await webSearch('query');
    expect(results).toEqual([]);
  });
});

describe('newsSearch', () => {
  it('uses Tavily with topic=news when available', async () => {
    mockTavilySearch.mockResolvedValue([
      { title: 'News', url: 'https://news.com/1', snippet: 'Breaking news' },
    ]);

    const results = await newsSearch('новости');

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('News');
    expect(mockTavilySearch).toHaveBeenCalledWith('новости', { count: 5, topic: 'news' });
  });

  it('falls back to Brave news endpoint when Tavily unavailable', async () => {
    mockIsTavilyAvailable.mockReturnValue(false);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ results: [{ title: 'News 1', url: 'https://news.com/1', description: 'Summary 1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await newsSearch('новости');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/news/search');
  });

  it('returns empty array on Tavily error with Brave unavailable', async () => {
    mockTavilySearch.mockRejectedValue(new Error('API error'));
    mockIsTavilyAvailable.mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Brave error')));

    const results = await newsSearch('query');
    expect(results).toEqual([]);
  });
});