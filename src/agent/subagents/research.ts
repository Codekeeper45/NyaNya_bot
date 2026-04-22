import { generateText, tool, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { config } from '../../config.js';
import { webSearch, newsSearch } from '../../research/search.js';
import { webFetch, webFetchMany } from '../../research/fetch.js';
import { tavilyExtract, isTavilyAvailable } from '../../research/tavily.js';
import { RESEARCH_SYSTEM_PROMPT } from '../prompts/subagents.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('subagent:research');

const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });
const MAX_FALLBACK_SOURCES = 5;
const MAX_EXTRA_SNIPPETS_PER_SOURCE = 2;
const MAX_SOURCE_TEXT_CHARS = 260;
const MAX_FALLBACK_CHARS = 1800;

function truncateText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

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
  const seenUrls = new Set<string>();

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
              if (!r.snippet || seenUrls.has(r.url) || searchSnippets.length >= MAX_FALLBACK_SOURCES) continue;
              seenUrls.add(r.url);
              const extras = (r.extraSnippets ?? []).slice(0, MAX_EXTRA_SNIPPETS_PER_SOURCE).join(' ');
              const core = extras ? `${r.title}: ${r.snippet} ${extras}` : `${r.title}: ${r.snippet}`;
              searchSnippets.push(`${truncateText(core, MAX_SOURCE_TEXT_CHARS)} (${r.url})`);
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
          description: 'Read content from a single URL. Uses Tavily Extract for reliable server-side extraction when available, falls back to local parsing.',
          inputSchema: z.object({
            url: z.string().describe('URL to fetch'),
          }),
          execute: async ({ url }) => {
            return await webFetch(url);
          },
        }),
        web_read_many: tool({
          description: 'Read 2-20 URLs in parallel. Uses Tavily Extract for batch server-side extraction (single API call for all URLs). Prefer over multiple web_read calls.',
          inputSchema: z.object({
            urls: z.array(z.string()).min(1).max(20).describe('URLs to fetch in parallel'),
          }),
          execute: async ({ urls }) => {
            const results = await webFetchMany(urls);
            return results;
          },
        }),
        tavily_extract: tool({
          description: 'Extract clean content from 1-20 URLs using Tavily server-side extraction. Handles JS-rendered pages, Cloudflare protection, and complex sites. More reliable than web_read for structured content. Use query parameter for focused extraction of specific information.',
          inputSchema: z.object({
            urls: z.array(z.string().url()).min(1).max(20).describe('URLs to extract content from'),
            query: z.string().optional().describe('Optional: target query to rank and filter extracted content chunks for relevance'),
            extractDepth: z.enum(['basic', 'advanced']).optional().default('advanced').describe('Extraction depth. Use "advanced" for complex pages, tables, JS-rendered content.'),
          }),
          execute: async ({ urls, query, extractDepth }) => {
            if (!isTavilyAvailable()) {
              return { error: 'TAVILY_API_KEY не настроен. Используйте web_read вместо этого.' };
            }
            const results = await tavilyExtract(urls, {
              extractDepth: extractDepth ?? 'advanced',
              format: 'markdown',
              query,
            });
            if (results.length === 0) {
              return { error: 'Не удалось извлечь содержимое ни из одного URL.' };
            }
            return {
              results: results.map(r => ({
                url: r.url,
                title: r.title,
                content: r.content,
              })),
            };
          },
        }),
      },
      stopWhen: stepCountIs(8),
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
      const compact = searchSnippets.join('\n\n');
      const limited = truncateText(compact, MAX_FALLBACK_CHARS);
      return `Поиск был прерван, но найдены следующие результаты:\n\n${limited}`;
    }
    return 'Не удалось найти информацию (превышено время ожидания).';
  } finally {
    clearTimeout(timeoutHandle);
  }
}