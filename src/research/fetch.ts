import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('webfetch');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface FetchResult {
  title: string;
  content: string;
  excerpt: string;
}

function trimToLastParagraph(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars);
  const lastBreak = Math.max(trimmed.lastIndexOf('\n\n'), trimmed.lastIndexOf('. '));
  return lastBreak > maxChars * 0.7 ? trimmed.slice(0, lastBreak + 1) : trimmed;
}

export async function webFetch(url: string): Promise<FetchResult> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': CHROME_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      log.warn({ url, status: response.status }, 'Web fetch returned non-OK status');
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
  } catch (err) {
    log.error({ err, url }, 'Web fetch failed');
    return { title: '', content: '', excerpt: '' };
  }
}
