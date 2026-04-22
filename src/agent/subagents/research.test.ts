import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn(() => vi.fn(() => 'mock-model')),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
  tool: <T>(def: T) => def,
  stepCountIs: vi.fn(() => Symbol('stop-when')),
}));

vi.mock('../../config.js', () => ({
  config: {
    openrouterApiKey: 'test-key',
    fastModel: 'test-fast-model',
  },
}));

vi.mock('../../research/search.js', () => ({
  webSearch: vi.fn(),
  newsSearch: vi.fn(),
}));

vi.mock('../../research/fetch.js', () => ({
  webFetch: vi.fn(),
  webFetchMany: vi.fn(),
}));

vi.mock('../../research/tavily.js', () => ({
  tavilyExtract: vi.fn(),
  isTavilyAvailable: vi.fn(() => false),
}));

import { generateText } from 'ai';
import { runResearchAgent } from './research.js';

const mockGenerateText = generateText as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runResearchAgent fallback safety', () => {
  it('caps timeout fallback size and number of snippet entries', async () => {
    const longSnippet = 'очень длинный фрагмент '.repeat(120);
    const longExtra = 'дополнительный контекст '.repeat(80);
    const results = Array.from({ length: 12 }, (_, i) => ({
      title: `Источник ${i}`,
      snippet: longSnippet,
      url: `https://example.com/${i}`,
      extraSnippets: [longExtra, longExtra, longExtra],
    }));

    mockGenerateText.mockImplementationOnce(async (opts: { onStepFinish?: (x: unknown) => void }) => {
      opts.onStepFinish?.({
        toolCalls: [{ toolName: 'web_search' }],
        toolResults: [{ toolName: 'web_search', output: { results } }],
        text: '',
      });
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    const text = await runResearchAgent('тест');

    expect(text.startsWith('Поиск был прерван')).toBe(true);
    const sourceCount = (text.match(/\(https:\/\/example\.com\/\d+\)/g) ?? []).length;
    expect(sourceCount).toBeLessThanOrEqual(5);
    expect(text.length).toBeLessThanOrEqual(2200);
  });
});
