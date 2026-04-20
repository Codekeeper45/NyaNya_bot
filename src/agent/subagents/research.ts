import { generateText, tool, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { config } from '../../config.js';
import { webSearch, newsSearch } from '../../research/search.js';
import { webFetch } from '../../research/fetch.js';
import { RESEARCH_SYSTEM_PROMPT } from '../prompts/subagents.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('subagent:research');

const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });

export async function runResearchAgent(query: string): Promise<string> {
  log.info({ query }, 'Starting research');

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    log.warn({ query }, 'Research timeout reached (90s), aborting');
    abortController.abort();
  }, 90_000);

  let stepNum = 0;
  let collectedText = '';
  const searchSnippets: string[] = [];

  try {
    const result = await generateText({
      model: openrouter(config.fastModel),
      system: RESEARCH_SYSTEM_PROMPT,
      prompt: query,
      abortSignal: abortController.signal,
      onStepFinish: ({ toolCalls, toolResults, text }) => {
        stepNum++;
        const toolNames = toolCalls?.map(t => t.toolName).join(', ') || 'none';
        log.info({ step: stepNum, tools: toolNames, hasText: !!text?.trim() }, 'Research step done');
        if (text?.trim()) collectedText += text + '\n';
        for (const tr of (toolResults ?? []) as Array<{ toolName: string; output: unknown }>) {
          if (tr.toolName === 'web_search' || tr.toolName === 'news_search') {
            const results = (tr.output as { results?: Array<{ title: string; snippet?: string; url: string; extraSnippets?: string[] }> }).results ?? [];
            for (const r of results) {
              if (r.snippet) {
                const extras = r.extraSnippets?.join(' ') ?? '';
                searchSnippets.push(extras
                  ? `${r.title}: ${r.snippet} ${extras} (${r.url})`
                  : `${r.title}: ${r.snippet} (${r.url})`);
              }
            }
          }
        }
      },
      tools: {
        web_search: tool({
          description: 'Search the web for information. Call multiple times in one step for parallel search.',
          inputSchema: z.object({
            query: z.string().describe('Search query'),
            count: z.number().optional().default(3),
          }),
          execute: async ({ query, count }) => {
            const results = await webSearch(query, count);
            return { results };
          },
        }),
        news_search: tool({
          description: 'Search recent news articles. Use for current events, game/app releases, announcements, updates.',
          inputSchema: z.object({
            query: z.string().describe('News search query'),
            count: z.number().optional().default(5),
          }),
          execute: async ({ query, count }) => {
            const results = await newsSearch(query, count);
            return { results };
          },
        }),
        web_read: tool({
          description: 'Read content from a single URL.',
          inputSchema: z.object({
            url: z.string().describe('URL to fetch'),
          }),
          execute: async ({ url }) => {
            return await webFetch(url);
          },
        }),
        web_read_many: tool({
          description: 'Read 2-3 URLs in parallel. Prefer over multiple web_read calls when you have several URLs.',
          inputSchema: z.object({
            urls: z.array(z.string()).min(1).max(3).describe('URLs to fetch in parallel'),
          }),
          execute: async ({ urls }) => {
            const results = await Promise.all(urls.map(url => webFetch(url)));
            return results.map((r, i) => ({ url: urls[i], ...r }));
          },
        }),
      },
      stopWhen: stepCountIs(6),
      temperature: 0.3,
    });

    const text = result.steps.map(s => s.text).filter(Boolean).join('\n');
    log.info({ query, steps: result.steps.length, resultLen: text.length }, 'Research complete');
    return text || 'Не удалось найти информацию.';
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    log.warn({ query, steps: stepNum, isAbort }, 'Research ended early');
    if (collectedText.trim()) return collectedText.trim();
    if (searchSnippets.length > 0) {
      log.info({ query, snippets: searchSnippets.length }, 'Returning search snippets as fallback');
      return `Поиск был прерван, но найдены следующие результаты:\n\n${searchSnippets.join('\n\n')}`;
    }
    return 'Не удалось найти информацию (превышено время ожидания).';
  } finally {
    clearTimeout(timeoutHandle);
  }
}
