import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('webfetch');

export interface FetchResult {
  title: string;
  content: string;
  excerpt: string;
}

export async function webFetch(url: string): Promise<FetchResult> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OpekuBot/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    return {
      title: article?.title ?? '',
      content: (article?.textContent ?? '').slice(0, 4000),
      excerpt: article?.excerpt ?? '',
    };
  } catch (err) {
    log.error({ err, url }, 'Web fetch failed');
    return { title: '', content: '', excerpt: '' };
  }
}
