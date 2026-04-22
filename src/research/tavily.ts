import { tavily } from '@tavily/core';
import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('tavily');

let _client: ReturnType<typeof tavily> | null = null;

function getClient(): ReturnType<typeof tavily> | null {
  if (!config.tavilyApiKey) return null;
  if (!_client) {
    _client = tavily({ apiKey: config.tavilyApiKey });
  }
  return _client;
}

export interface TavilySearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
  rawContent?: string;
}

export interface TavilyExtractResult {
  url: string;
  title: string;
  content: string;
}

export async function tavilySearch(
  query: string,
  options?: {
    count?: number;
    topic?: 'general' | 'news' | 'finance';
    searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast';
    includeRawContent?: boolean;
    includeAnswer?: boolean | 'basic' | 'advanced';
    timeRange?: 'year' | 'month' | 'week' | 'day';
  },
): Promise<TavilySearchResult[]> {
  const client = getClient();
  if (!client) throw new Error('TAVILY_API_KEY не настроен');

  try {
    const resp = await client.search(query, {
      maxResults: options?.count ?? 5,
      topic: options?.topic ?? 'general',
      searchDepth: options?.searchDepth ?? 'basic',
      includeRawContent: options?.includeRawContent ? 'markdown' as const : false,
      includeAnswer: options?.includeAnswer as boolean | 'basic' | 'advanced' | undefined,
      timeRange: options?.timeRange,
      timeout: 10,
    });

    return resp.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      score: r.score,
      rawContent: r.rawContent,
    }));
  } catch (err) {
    log.error({ err, query }, 'Tavily search failed');
    throw err;
  }
}

export async function tavilyExtract(
  urls: string[],
  options?: {
    extractDepth?: 'basic' | 'advanced';
    format?: 'markdown' | 'text';
    query?: string;
    chunksPerSource?: number;
  },
): Promise<TavilyExtractResult[]> {
  const client = getClient();
  if (!client) throw new Error('TAVILY_API_KEY не настроен');

  const limitedUrls = urls.slice(0, 20);
  if (urls.length > 20) {
    log.warn({ requested: urls.length, limit: 20 }, 'tavilyExtract: truncating URLs to limit of 20');
  }

  try {
    const resp = await client.extract(limitedUrls, {
      extractDepth: options?.extractDepth ?? 'advanced',
      format: options?.format ?? 'markdown',
      query: options?.query,
      chunksPerSource: options?.chunksPerSource,
    });

    const results: TavilyExtractResult[] = resp.results.map(r => ({
      url: r.url,
      title: r.title ?? '',
      content: r.rawContent ?? '',
    }));

    if (resp.failedResults.length > 0) {
      log.warn(
        { failed: resp.failedResults.map(f => ({ url: f.url, error: f.error })) },
        'Tavily extract had failures',
      );
    }

    return results;
  } catch (err) {
    log.error({ err, urls: limitedUrls }, 'Tavily extract failed');
    throw err;
  }
}

export function isTavilyAvailable(): boolean {
  return !!config.tavilyApiKey;
}
