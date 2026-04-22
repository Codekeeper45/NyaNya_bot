import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockTavilyExtract = vi.hoisted(() => vi.fn());
const mockIsTavilyAvailable = vi.hoisted(() => vi.fn(() => true));

vi.mock('./tavily.js', () => ({
  tavilyExtract: mockTavilyExtract,
  isTavilyAvailable: mockIsTavilyAvailable,
}));

import { webFetch, webFetchMany } from './fetch.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockIsTavilyAvailable.mockReturnValue(true);
});

describe('webFetch (Tavily-only)', () => {
  it('returns mapped Tavily result', async () => {
    mockTavilyExtract.mockResolvedValue([
      { url: 'https://example.com', title: 'Test Page', content: '# Test\n\nContent here' },
    ]);

    const result = await webFetch('https://example.com');

    expect(result.title).toBe('Test Page');
    expect(result.content).toContain('Content here');
    expect(result.excerpt).toBeTruthy();
  });

  it('throws when TAVILY_API_KEY is not configured', async () => {
    mockIsTavilyAvailable.mockReturnValue(false);

    await expect(webFetch('https://example.com')).rejects.toThrow('Tavily недоступен');
  });

  it('throws when Tavily returns empty result', async () => {
    mockTavilyExtract.mockResolvedValue([]);

    await expect(webFetch('https://example.com')).rejects.toThrow('Tavily вернул пустой результат');
  });

  it('throws on Tavily SDK error', async () => {
    mockTavilyExtract.mockRejectedValue(new Error('API timeout'));

    await expect(webFetch('https://example.com')).rejects.toThrow('API timeout');
  });

  it('limits content to 4000 characters', async () => {
    const longContent = 'word '.repeat(2000);
    mockTavilyExtract.mockResolvedValue([
      { url: 'https://example.com', title: 'Long', content: longContent },
    ]);

    const result = await webFetch('https://example.com');

    expect(result.content.length).toBeLessThanOrEqual(4000);
  });
});

describe('webFetchMany (Tavily-only)', () => {
  it('returns FetchManyResult[] with url and fetchedOk fields', async () => {
    mockTavilyExtract.mockResolvedValue([
      { url: 'https://example.com/1', title: 'Page 1', content: 'Content 1' },
      { url: 'https://example.com/2', title: 'Page 2', content: 'Content 2' },
    ]);

    const results = await webFetchMany(['https://example.com/1', 'https://example.com/2']);

    expect(results).toHaveLength(2);
    expect(results[0].url).toBe('https://example.com/1');
    expect(results[0].fetchedOk).toBe(true);
    expect(results[0].title).toBe('Page 1');
    expect(results[1].fetchedOk).toBe(true);
  });

  it('sets fetchedOk=false for URLs missing from Tavily response', async () => {
    mockTavilyExtract.mockResolvedValue([
      { url: 'https://ok.com', title: 'OK', content: 'content' },
    ]);

    const results = await webFetchMany(['https://fail.com', 'https://ok.com']);

    expect(results).toHaveLength(2);
    expect(results[0].fetchedOk).toBe(false);
    expect(results[0].url).toBe('https://fail.com');
    expect(results[1].fetchedOk).toBe(true);
    expect(results[1].url).toBe('https://ok.com');
  });

  it('returns empty results for empty input', async () => {
    const results = await webFetchMany([]);
    expect(results).toEqual([]);
  });

  it('throws when TAVILY_API_KEY is not configured', async () => {
    mockIsTavilyAvailable.mockReturnValue(false);

    await expect(webFetchMany(['https://example.com'])).rejects.toThrow('Tavily недоступен');
  });

  it('throws on Tavily SDK error', async () => {
    mockTavilyExtract.mockRejectedValue(new Error('Batch failed'));

    await expect(webFetchMany(['https://example.com/1', 'https://example.com/2'])).rejects.toThrow('Batch failed');
  });
});
