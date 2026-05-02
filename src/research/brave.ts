import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('brave');

interface BraveSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function isBraveAvailable(): boolean {
  return !!config.braveSearchApiKey;
}

export async function braveSearch(query: string, count = 5): Promise<BraveSearchResult[]> {
  if (!config.braveSearchApiKey) {
    throw new Error('BRAVE_SEARCH_API_KEY не настроен');
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(count, 20)));
  url.searchParams.set('offset', '0');

  const res = await fetch(url.toString(), {
    headers: {
      'X-Subscription-Token': config.braveSearchApiKey,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.error({ status: res.status, body: body.slice(0, 500) }, 'Brave Search API error');
    throw new Error(`Brave Search API error: ${res.status}`);
  }

  const data = await res.json();
  const results = data.web?.results ?? [];

  log.info({ query, resultCount: results.length }, 'Brave search complete');

  return results.map((r: any) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }));
}

export async function braveFetch(url: string): Promise<string> {
  if (!config.braveSearchApiKey) {
    throw new Error('BRAVE_SEARCH_API_KEY не настроен');
  }

  // Brave doesn't have a dedicated fetch/extract API like Tavily.
  // We'll do a direct fetch with common browser headers.
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} for ${url}`);
  }

  return res.text();
}
