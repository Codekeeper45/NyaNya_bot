import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('embeddings');

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const API_URL = 'https://openrouter.ai/api/v1/embeddings';

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!config.openrouterApiKey) {
    throw new Error('OpenRouter API key not configured');
  }
  if (texts.length === 0) return [];

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://opekun.bot',
        'X-Title': 'Opekun Bot',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: texts,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Embeddings API ${response.status}: ${errBody}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    const embeddings = data.data.map(d => d.embedding);
    log.debug({ count: embeddings.length, dims: embeddings[0]?.length }, 'Embeddings generated');
    return embeddings;
  } catch (err) {
    log.error({ err, count: texts.length }, 'Failed to generate embeddings');
    throw err;
  }
}

export async function embedText(text: string): Promise<number[]> {
  const results = await embedTexts([text]);
  return results[0];
}
