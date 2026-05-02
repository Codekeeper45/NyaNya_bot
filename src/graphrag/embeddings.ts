import { config } from '../config.js';
import { createChildLogger } from '../lib/logger.js';
import { embeddingCache } from './cache.js';

const log = createChildLogger('embeddings');

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const API_URL = 'https://openrouter.ai/api/v1/embeddings';

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!config.openrouterApiKey) {
    throw new Error('OpenRouter API key not configured');
  }
  if (texts.length === 0) return [];

  // Check cache first
  const results: (number[] | undefined)[] = texts.map(t => embeddingCache.get(t));
  const missingIndices: number[] = [];
  const missingTexts: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    if (!results[i]) {
      missingIndices.push(i);
      missingTexts.push(texts[i]);
    }
  }

  if (missingTexts.length === 0) {
    log.debug({ count: texts.length, cached: true }, 'All embeddings from cache');
    return results as number[][];
  }

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
        input: missingTexts,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Embeddings API ${response.status}: ${errBody}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    const newEmbeddings = data.data.map(d => d.embedding);
    if (newEmbeddings.length !== missingTexts.length) {
      throw new Error(`Embeddings API returned ${newEmbeddings.length} embeddings for ${missingTexts.length} inputs`);
    }

    // Validate dimensions — pgvector column is vector(1536)
    for (const emb of newEmbeddings) {
      if (emb.length !== 1536) {
        throw new Error(`Embedding dimension mismatch: expected 1536, got ${emb.length}`);
      }
    }

    for (let i = 0; i < missingIndices.length; i++) {
      const idx = missingIndices[i];
      const emb = newEmbeddings[i];
      embeddingCache.set(texts[idx], emb);
      results[idx] = emb;
    }

    log.debug({ count: texts.length, cached: texts.length - missingTexts.length, generated: missingTexts.length }, 'Embeddings ready');
    return results as number[][];
  } catch (err) {
    log.error({ err, count: texts.length }, 'Failed to generate embeddings');
    throw err;
  }
}

export async function embedText(text: string): Promise<number[]> {
  const cached = embeddingCache.get(text);
  if (cached) {
    log.debug({ textLen: text.length }, 'Embedding from cache');
    return cached;
  }
  const results = await embedTexts([text]);
  return results[0];
}
