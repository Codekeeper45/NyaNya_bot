import { generateText, tool, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { config } from '../../config.js';
import { webSearch } from '../../research/search.js';
import { webFetch } from '../../research/fetch.js';
import { RESEARCH_SYSTEM_PROMPT } from '../prompts/subagents.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('subagent:research');

const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });

export async function runResearchAgent(query: string): Promise<string> {
  log.info({ query }, 'Starting research');

  let stepNum = 0;
  const result = await generateText({
    model: openrouter(config.fastModel),
    system: RESEARCH_SYSTEM_PROMPT,
    prompt: query,
    onStepFinish: ({ toolCalls, toolResults, text }) => {
      stepNum++;
      const toolNames = toolCalls?.map(t => t.toolName).join(', ') || 'none';
      log.info({ step: stepNum, tools: toolNames, hasText: !!text?.trim() }, 'Research step done');
    },
    tools: {
      web_search: tool({
        description: 'Search the web for information',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
          count: z.number().optional().default(5),
        }),
        execute: async ({ query, count }) => {
          const results = await webSearch(query, count);
          return { results };
        },
      }),
      web_read: tool({
        description: 'Read and extract content from a URL',
        inputSchema: z.object({
          url: z.string().describe('URL to fetch'),
        }),
        execute: async ({ url }) => {
          return await webFetch(url);
        },
      }),
    },
    stopWhen: stepCountIs(20),
    temperature: 0.3,
  });

  const text = result.steps
    .map(s => s.text)
    .filter(Boolean)
    .join('\n');

  log.info({ query, steps: result.steps.length, resultLen: text.length }, 'Research complete');
  return text || 'Не удалось найти информацию.';
}
