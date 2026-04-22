import { createChildLogger } from '../lib/logger.js';
import { tavilyExtract, isTavilyAvailable } from './tavily.js';

const log = createChildLogger('webfetch');

export interface FetchResult {
  title: string;
  content: string;
  excerpt: string;
}

export interface FetchManyResult extends FetchResult {
  url: string;
  fetchedOk: boolean;
}

function trimToLastParagraph(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars);
  const threshold = maxChars * 0.7;
  const nnIdx = trimmed.lastIndexOf('\n\n');
  if (nnIdx > threshold) return trimmed.slice(0, nnIdx + 2);
  const dotIdx = trimmed.lastIndexOf('. ');
  if (dotIdx > threshold) return trimmed.slice(0, dotIdx + 1);
  return trimmed;
}

function smartExcerpt(text: string, maxLen = 300): string {
  if (text.length <= maxLen) return text;
  const trimmed = text.slice(0, maxLen);
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.7) return trimmed.slice(0, lastSpace) + '…';
  return trimmed + '…';
}

function toFetchResult(title: string, content: string): FetchResult {
  return {
    title,
    content: trimToLastParagraph(content),
    excerpt: smartExcerpt(content),
  };
}

export async function webFetch(url: string): Promise<FetchResult> {
  if (!isTavilyAvailable()) {
    throw new Error('Tavily недоступен: отсутствует TAVILY_API_KEY.');
  }
  try {
    const results = await tavilyExtract([url], {
      extractDepth: 'advanced',
      format: 'markdown',
    });
    if (results.length > 0 && results[0].content) {
      const r = results[0];
      return toFetchResult(r.title, r.content);
    }
    throw new Error('Tavily вернул пустой результат.');
  } catch (err) {
    log.error({ err, url }, 'Tavily extract failed');
    throw new Error(`Не удалось извлечь содержимое ${url}: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`);
  }
}

export async function webFetchMany(urls: string[]): Promise<FetchManyResult[]> {
  if (urls.length === 0) return [];
  if (!isTavilyAvailable()) {
    throw new Error('Tavily недоступен: отсутствует TAVILY_API_KEY.');
  }
  try {
    const results = await tavilyExtract(urls, {
      extractDepth: 'advanced',
      format: 'markdown',
    });
    const resultMap = new Map(results.map(r => [r.url, r]));
    return urls.map(url => {
      const r = resultMap.get(url);
      if (r && r.content) {
        return { url, fetchedOk: true, ...toFetchResult(r.title, r.content) };
      }
      return { url, fetchedOk: false, title: '', content: '', excerpt: '' };
    });
  } catch (err) {
    log.error({ err, count: urls.length }, 'Tavily batch extract failed');
    throw new Error(`Не удалось извлечь содержимое страниц: ${err instanceof Error ? err.message : 'неизвестная ошибка'}`);
  }
}
