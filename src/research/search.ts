import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('search');
const REQUEST_TIMEOUT_MS = 8000;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  extraSnippets?: string[];
}

export async function webSearch(query: string, count = 5): Promise<SearchResult[]> {
  if (!config.braveSearchApiKey) {
    log.warn({ query }, 'Brave Search API key not configured');
    return [];
  }
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&extra_snippets=true`;
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

      const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string; extra_snippets?: string[] }> } };
      return (data.web?.results ?? []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
        extraSnippets: r.extra_snippets,
      }));
    } catch (err) {
      log.error({ err, query, attempt }, 'Web search failed');
    }
  }
  return [];
}

export async function newsSearch(query: string, count = 5): Promise<SearchResult[]> {
  if (!config.braveSearchApiKey) return [];
  const url = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=${count}`;
  try {
    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': config.braveSearchApiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: Array<{ title: string; url: string; description: string }> };
    return (data.results ?? []).map(r => ({ title: r.title, url: r.url, snippet: r.description }));
  } catch (err) {
    log.error({ err, query }, 'News search failed');
    return [];
  }
}
