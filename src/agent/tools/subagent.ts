import { tool } from 'ai';
import { z } from 'zod';
import { runResearchAgent } from '../subagents/research.js';
import { runTechnicalAgent } from '../subagents/technical.js';

export function subagentTools() {
  return {
    subagent_research: tool({
      description: 'Делегировать задачу поиска информации исследовательскому суб-агенту. Используй когда нужна актуальная информация из интернета.',
      inputSchema: z.object({
        query: z.string().describe('Что исследовать'),
        depth: z.enum(['shallow', 'deep']).optional().default('deep').describe('shallow=1-3 поиска, deep=до 8'),
      }),
      execute: async ({ query, depth }) => {
        const summary = await runResearchAgent(query, depth);
        return { summary };
      },
    }),

    subagent_technical: tool({
      description: 'Делегировать задачу обработки текста техническому суб-агенту (конспект, план, форматирование).',
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
