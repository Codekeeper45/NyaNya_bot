import { messagesRepo } from '../db/repos/messages.js';
import { graphChunksRepo } from '../db/repos/graph_chunks.js';
import { embedText } from '../graphrag/embeddings.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('memory:archive-search');
const MAX_SNIPPET_LENGTH = 700;
const RRF_K = 60;

export interface ArchiveSearchResult {
  found: boolean;
  context: string;
}

function cleanSavedFact(content: string): string {
  return content.replace(/^Факт о пользователе:\s*/i, '').trim();
}

function compactSnippet(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ');
  if (normalized.length <= MAX_SNIPPET_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_SNIPPET_LENGTH - 1).trim()}…`;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeKey(snippet: string): string {
  return snippet.toLowerCase().replace(/\s+/g, ' ').slice(0, 250);
}

interface MergedResult {
  snippet: string;
  date: Date;
  score: number;
  sources: Set<string>;
}

function rrfMerge(keywordResults: Array<{ content: string; createdAt: Date }>, vectorResults: Array<{ content: string; createdAt: Date }>): MergedResult[] {
  const merged = new Map<string, MergedResult>();

  // Keyword ranks (BM25)
  keywordResults.forEach((r, idx) => {
    const snippet = compactSnippet(cleanSavedFact(r.content));
    const key = normalizeKey(snippet);
    const score = 1 / (RRF_K + idx + 1);
    const existing = merged.get(key);
    if (existing) {
      existing.score += score;
      existing.sources.add('keyword');
    } else {
      merged.set(key, { snippet, date: r.createdAt, score, sources: new Set(['keyword']) });
    }
  });

  // Vector ranks
  vectorResults.forEach((c, idx) => {
    const snippet = compactSnippet(c.content);
    const key = normalizeKey(snippet);
    const score = 1 / (RRF_K + idx + 1);
    const existing = merged.get(key);
    if (existing) {
      existing.score += score;
      existing.sources.add('vector');
    } else {
      merged.set(key, { snippet, date: c.createdAt, score, sources: new Set(['vector']) });
    }
  });

  return Array.from(merged.values()).sort((a, b) => b.score - a.score);
}

export async function searchMemoryArchive(userId: number, query: string): Promise<ArchiveSearchResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return { found: false, context: '' };

  try {
    const [savedFacts, queryEmbedding] = await Promise.all([
      messagesRepo.searchSavedFacts(userId, normalizedQuery, 10),
      embedText(normalizedQuery),
    ]);
    const chunks = await graphChunksRepo.searchSimilar(userId, queryEmbedding, 10);

    const merged = rrfMerge(savedFacts, chunks).slice(0, 8);

    if (merged.length === 0) return { found: false, context: '' };

    const lines: string[] = [];
    for (const item of merged) {
      const sourceLabel = item.sources.has('keyword') && item.sources.has('vector')
        ? '★'
        : item.sources.has('keyword')
          ? 'K'
          : 'V';
      lines.push(`- [${sourceLabel}] ${formatDate(item.date)}: ${item.snippet}`);
    }

    return { found: true, context: lines.join('\n') };
  } catch (err) {
    log.error({ err, userId, query: normalizedQuery }, 'Archive memory search failed');
    return { found: false, context: '' };
  }
}
