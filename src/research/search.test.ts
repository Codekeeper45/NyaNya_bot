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

describe('webSearch (Tavily-only)', () => {
  it('returns Tavily results when available', async () => {
    mockTavilySearch.mockResolvedValue([
      { title: 'Tavily Title', url: 'https://tavily.com/1', snippet: 'Tavily snippet', score: 0.9 },
    ]);

    const results = await webSearch('тест запрос');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ title: 'Tavily Title', url: 'https://tavily.com/1', snippet: 'Tavily snippet', score: 0.9 });
    expect(mockTavilySearch).toHaveBeenCalledWith('тест запрос', { count: 5, topic: 'general' });
  });

  it('returns empty array from Tavily when no results', async () => {
    mockTavilySearch.mockResolvedValue([]);

    const results = await webSearch('ничего нет');

    expect(results).toEqual([]);
  });

  it('throws error on Tavily failure (no Brave fallback)', async () => {
    mockTavilySearch.mockRejectedValue(new Error('Tavily API error'));

    await expect(webSearch('тест запрос')).rejects.toThrow('Не удалось выполнить поиск');
  });

  it('passes count to Tavily', async () => {
    mockTavilySearch.mockResolvedValue([]);

    await webSearch('query', 10);

    expect(mockTavilySearch).toHaveBeenCalledWith('query', { count: 10, topic: 'general' });
  });

  it('throws error when TAVILY_API_KEY not configured', async () => {
    mockIsTavilyAvailable.mockReturnValue(false);

    await expect(webSearch('query')).rejects.toThrow('Tavily недоступен');
  });
});

describe('newsSearch (Tavily-only)', () => {
  it('uses Tavily with topic=news when available', async () => {
    mockTavilySearch.mockResolvedValue([
      { title: 'News', url: 'https://news.com/1', snippet: 'Breaking news' },
    ]);

    const results = await newsSearch('новости');

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('News');
    expect(mockTavilySearch).toHaveBeenCalledWith('новости', { count: 5, topic: 'news' });
  });

  it('throws error on Tavily failure', async () => {
    mockTavilySearch.mockRejectedValue(new Error('API error'));

    await expect(newsSearch('query')).rejects.toThrow('Не удалось выполнить поиск новостей');
  });

  it('throws error when TAVILY_API_KEY not configured', async () => {
    mockIsTavilyAvailable.mockReturnValue(false);

    await expect(newsSearch('query')).rejects.toThrow('Tavily недоступен');
  });
});