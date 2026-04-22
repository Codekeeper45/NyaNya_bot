import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';
import { tavilySearch, isTavilyAvailable } from './tavily.js';

const log = createChildLogger('search');
const REQUEST_TIMEOUT_MS = 8000;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  extraSnippets?: string[];
}

async function braveSearch(
  endpoint: string,
  query: string,
  count: number,
): Promise<SearchResult[]> {
  if (!config.braveSearchApiKey) {
    log.warn({ query }, 'Brave Search API key not configured');
    return [];
  }
  const url = `${endpoint}?q=${encodeURIComponent(query)}&count=${count}&extra_snippets=true`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'X-Subscription-Token': config.braveSearchApiKey },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        log.error({ status: res.status, attempt }, 'Brave Search API error');
        continue;
      }
      const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string; extra_snippets?: string[] }> }; results?: Array<{ title: string; url: string; description: string; extra_snippets?: string[] }> };
      const results = data.web?.results ?? data.results ?? [];
      return results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
        extraSnippets: r.extra_snippets?.filter((s): s is string => typeof s === 'string'),
      }));
    } catch (err) {
      log.error({ err, query, attempt }, 'Brave search request failed');
    }
  }
  return [];
}

export async function webSearch(query: string, count = 5): Promise<SearchResult[]> {
  if (isTavilyAvailable()) {
    try {
      return await tavilySearch(query, { count, topic: 'general' });
    } catch (err) {
      log.warn({ err, query }, 'Tavily search failed, falling back to Brave');
    }
  }
  return braveSearch('https://api.search.brave.com/res/v1/web/search', query, count);
}

export async function newsSearch(query: string, count = 5): Promise<SearchResult[]> {
  if (isTavilyAvailable()) {
    try {
      return await tavilySearch(query, { count, topic: 'news' });
    } catch (err) {
      log.warn({ err, query }, 'Tavily news search failed, falling back to Brave');
    }
  }
  return braveSearch('https://api.search.brave.com/res/v1/news/search', query, count);
}