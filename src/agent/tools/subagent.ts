import { tool } from 'ai';
import { z } from 'zod';
import { runResearchAgent } from '../subagents/research.js';
import { runTechnicalAgent } from '../subagents/technical.js';

const MAX_RESEARCH_SUMMARY_CHARS = 2200;

export function subagentTools() {
  return {
    subagent_research: tool({
      description: 'Делегировать глубокое исследование сабагенту. WHEN: нужен развёрнутый анализ, структурированный конспект, сравнение вариантов — не просто факты, а обработанная информация. CHAIN: этот инструмент → message_send_text(сводка результатов). RETURNS: { summary } или { summary, truncated: true }.',
      inputSchema: z.object({
        query: z.string().describe('Что исследовать'),
      }),
      execute: async ({ query }) => {
        const summary = await runResearchAgent(query);
        if (summary.length <= MAX_RESEARCH_SUMMARY_CHARS) return { summary };
        return {
          summary: `${summary.slice(0, MAX_RESEARCH_SUMMARY_CHARS - 1)}…`,
          truncated: true,
        };
      },
    }),

    subagent_technical: tool({
      description: 'Делегировать обработку текста техническому сабагенту. WHEN: нужно отформатировать, суммаризовать, составить план из большого текста. CHAIN: [получен текст] → этот инструмент → message_send_text. RETURNS: { result }.',
      inputSchema: z.object({
        task: z.string().describe('Что сделать с текстом'),
        context: z.string().describe('Текст для обработки'),
      }),
      execute: async ({ task, context }) => {
        const result = await runTechnicalAgent(task, context);
        return { result };
      },
    }),
  };
}
