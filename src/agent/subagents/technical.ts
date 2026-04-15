import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { config } from '../../config.js';
import { TECHNICAL_SYSTEM_PROMPT } from '../prompts/subagents.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('subagent:technical');

const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });

export async function runTechnicalAgent(task: string, context: string): Promise<string> {
  log.info({ task }, 'Starting technical processing');

  const result = await generateText({
    model: openrouter(config.fastModel),
    system: TECHNICAL_SYSTEM_PROMPT,
    prompt: `Задача: ${task}\n\nКонтекст:\n${context}`,
    temperature: 0.2,
  });

  log.info({ task, resultLen: result.text.length }, 'Technical processing complete');
  return result.text || 'Не удалось обработать текст.';
}
