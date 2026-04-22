import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockSearchFn = vi.fn();
const mockExtractFn = vi.fn();

vi.mock('@tavily/core', () => ({
  tavily: vi.fn(() => ({
    search: mockSearchFn,
    extract: mockExtractFn,
  })),
}));

vi.mock('../config.js', () => ({
  get config() {
    return {
      tavilyApiKey: 'test-tavily-key',
    };
  },
}));

vi.mock('../lib/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('tavilySearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns mapped search results', async () => {
    mockSearchFn.mockResolvedValue({
      results: [
        { title: 'Test', url: 'https://example.com', content: 'Test content', score: 0.9 },
      ],
    });

    const { tavilySearch } = await import('./tavily.js');
    const results = await tavilySearch('test query');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: 'Test',
      url: 'https://example.com',
      snippet: 'Test content',
      score: 0.9,
      rawContent: undefined,
    });
  });

  it('returns empty array on SDK error', async () => {
    mockSearchFn.mockRejectedValue(new Error('API error'));

    const { tavilySearch } = await import('./tavily.js');
    const results = await tavilySearch('test query');

    expect(results).toEqual([]);
  });

  it('passes topic and searchDepth options', async () => {
    mockSearchFn.mockResolvedValue({ results: [] });

    const { tavilySearch } = await import('./tavily.js');
    await tavilySearch('test', { topic: 'news', searchDepth: 'advanced' });

    expect(mockSearchFn).toHaveBeenCalledWith('test', expect.objectContaining({
      topic: 'news',
      searchDepth: 'advanced',
    }));
  });
});

describe('tavilyExtract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns mapped extract results', async () => {
    mockExtractFn.mockResolvedValue({
      results: [
        { url: 'https://example.com', title: 'Test Page', rawContent: '# Test\n\nContent here' },
      ],
      failedResults: [],
    });

    const { tavilyExtract } = await import('./tavily.js');
    const results = await tavilyExtract(['https://example.com']);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      url: 'https://example.com',
      title: 'Test Page',
      content: '# Test\n\nContent here',
    });
  });

  it('returns empty array on SDK error', async () => {
    mockExtractFn.mockRejectedValue(new Error('API error'));

    const { tavilyExtract } = await import('./tavily.js');
    const results = await tavilyExtract(['https://example.com']);

    expect(results).toEqual([]);
  });

  it('logs warnings for failed results', async () => {
    mockExtractFn.mockResolvedValue({
      results: [{ url: 'https://ok.com', title: 'OK', rawContent: 'content' }],
      failedResults: [{ url: 'https://fail.com', error: 'timeout' }],
    });

    const { tavilyExtract } = await import('./tavily.js');
    const results = await tavilyExtract(['https://ok.com', 'https://fail.com']);

    expect(results).toHaveLength(1);
  });

  it('passes query and extractDepth options', async () => {
    mockExtractFn.mockResolvedValue({ results: [], failedResults: [] });

    const { tavilyExtract } = await import('./tavily.js');
    await tavilyExtract(['https://example.com'], {
      query: 'test focus',
      extractDepth: 'advanced',
    });

    expect(mockExtractFn).toHaveBeenCalledWith(
      ['https://example.com'],
      expect.objectContaining({
        query: 'test focus',
        extractDepth: 'advanced',
      }),
    );
  });
});

describe('isTavilyAvailable', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns true when key is configured', async () => {
    const { isTavilyAvailable } = await import('./tavily.js');
    expect(isTavilyAvailable()).toBe(true);
  });
});