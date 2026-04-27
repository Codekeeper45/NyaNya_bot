import { messagesRepo } from '../db/repos/messages.js';
import { graphChunksRepo } from '../db/repos/graph_chunks.js';
import { embedText } from '../graphrag/embeddings.js';
import { createChildLogger } from '../lib/logger.js';

const log = createChildLogger('memory:archive-search');
const MAX_SNIPPET_LENGTH = 700;

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

export async function searchMemoryArchive(userId: number, query: string): Promise<ArchiveSearchResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return { found: false, context: '' };

  try {
    const [savedFacts, queryEmbedding] = await Promise.all([
      messagesRepo.searchSavedFacts(userId, normalizedQuery, 5),
      embedText(normalizedQuery),
    ]);
    const chunks = await graphChunksRepo.searchSimilar(userId, queryEmbedding, 4);

    const lines: string[] = [];
    const seen = new Set<string>();

    if (savedFacts.length > 0) {
      lines.push('Сохранённые факты:');
      for (const fact of savedFacts) {
        const snippet = compactSnippet(cleanSavedFact(fact.content));
        const key = snippet.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(`- ${formatDate(fact.createdAt)}: ${snippet}`);
      }
    }

    if (chunks.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('Фрагменты переписки:');
      for (const chunk of chunks) {
        const snippet = compactSnippet(chunk.content);
        const key = snippet.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(`- ${formatDate(chunk.createdAt)}: ${snippet}`);
      }
    }

    if (lines.length === 0) return { found: false, context: '' };
    return { found: true, context: lines.join('\n') };
  } catch (err) {
    log.error({ err, userId, query: normalizedQuery }, 'Archive memory search failed');
    return { found: false, context: '' };
  }
}
