import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('search');

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, count = 5): Promise<SearchResult[]> {
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': config.braveSearchApiKey },
    });

    if (!res.ok) {
      log.error({ status: res.status }, 'Brave Search API error');
      return [];
    }

    const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
    return (data.web?.results ?? []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  } catch (err) {
    log.error({ err, query }, 'Web search failed');
    return [];
  }
}
