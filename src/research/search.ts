import { createChildLogger } from '../lib/logger.js';
import { tavilySearch, isTavilyAvailable } from './tavily.js';

const log = createChildLogger('search');

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  extraSnippets?: string[];
}

export async function webSearch(query: string, count = 5): Promise<SearchResult[]> {
  if (!isTavilyAvailable()) {
    throw new Error('Tavily недоступен: отсутствует TAVILY_API_KEY.');
  }
  try {
    return await tavilySearch(query, { count, topic: 'general' });
  } catch (err) {
    log.error({ err, query }, 'Tavily web search failed');
    throw new Error('Не удалось выполнить Tavily web_search. Попробуйте повторить позже.');
  }
}

export async function newsSearch(query: string, count = 5): Promise<SearchResult[]> {
  if (!isTavilyAvailable()) {
    throw new Error('Tavily недоступен: отсутствует TAVILY_API_KEY.');
  }
  try {
    return await tavilySearch(query, { count, topic: 'news' });
  } catch (err) {
    log.error({ err, query }, 'Tavily news search failed');
    throw new Error('Не удалось выполнить Tavily news_search. Попробуйте повторить позже.');
  }
}
