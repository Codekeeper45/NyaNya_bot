import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { createChildLogger } from '../lib/logger.js';
import { tavilyExtract, isTavilyAvailable } from './tavily.js';

const log = createChildLogger('webfetch');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

async function jsdomFetch(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': CHROME_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    log.warn({ url, status: response.status }, 'JSDOM fetch returned non-OK status');
    return { title: '', content: '', excerpt: '' };
  }
  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  return {
    title: article?.title ?? '',
    content: trimToLastParagraph(article?.textContent ?? ''),
    excerpt: article?.excerpt ?? '',
  };
}

function toFetchResult(title: string, content: string): FetchResult {
  return {
    title,
    content: trimToLastParagraph(content),
    excerpt: smartExcerpt(content),
  };
}

export async function webFetch(url: string): Promise<FetchResult> {
  if (isTavilyAvailable()) {
    try {
      const results = await tavilyExtract([url], {
        extractDepth: 'advanced',
        format: 'markdown',
      });
      if (results.length > 0 && results[0].content) {
        const r = results[0];
        return toFetchResult(r.title, r.content);
      }
      log.warn({ url }, 'Tavily extract returned empty, falling back to JSDOM');
    } catch (err) {
      log.warn({ err, url }, 'Tavily extract failed, falling back to JSDOM');
    }
  }

  try {
    return await jsdomFetch(url);
  } catch (err) {
    log.error({ err, url }, 'Web fetch failed');
    return { title: '', content: '', excerpt: '' };
  }
}

export async function webFetchMany(urls: string[]): Promise<FetchManyResult[]> {
  if (isTavilyAvailable() && urls.length > 0) {
    try {
      const results = await tavilyExtract(urls, {
        extractDepth: 'advanced',
        format: 'markdown',
      });
      if (results.length > 0) {
        const resultMap = new Map(results.map(r => [r.url, r]));
        return urls.map(url => {
          const r = resultMap.get(url);
          if (r && r.content) {
            return { url, fetchedOk: true, ...toFetchResult(r.title, r.content) };
          }
          return { url, fetchedOk: false, title: '', content: '', excerpt: '' };
        });
      }
      log.warn({ urls: urls.length }, 'Tavily batch extract returned empty, falling back to JSDOM');
    } catch (err) {
      log.warn({ err, count: urls.length }, 'Tavily batch extract failed, falling back to JSDOM');
    }
  }

  const settled = await Promise.allSettled(urls.map(url => webFetch(url)));
  return settled.map((res, i) => {
    const url = urls[i];
    if (res.status === 'fulfilled' && res.value.content) {
      return { url, fetchedOk: true, ...res.value };
    }
    return { url, fetchedOk: false, title: '', content: '', excerpt: '' };
  });
}