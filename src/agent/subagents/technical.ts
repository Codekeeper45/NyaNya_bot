import { generateText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { config } from '../../config.js';
import { TECHNICAL_SYSTEM_PROMPT } from '../prompts/subagents.js';
import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger('subagent:technical');

const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });

export async function runTechnicalAgent(task: string, context: string): Promise<string> {
  log.info({ task }, 'Starting technical processing');

  let stepNum = 0;
  const result = await generateText({
    model: openrouter(config.fastModel),
    system: TECHNICAL_SYSTEM_PROMPT,
    prompt: `Задача: ${task}\n\nКонтекст:\n${context}`,
    stopWhen: stepCountIs(20),
    onStepFinish: ({ toolCalls, text }) => {
      stepNum++;
      const toolNames = toolCalls?.map(t => t.toolName).join(', ') || 'none';
      log.info({ step: stepNum, tools: toolNames, hasText: !!text?.trim() }, 'Technical step done');
    },
    temperature: 0.2,
  });

  log.info({ task, steps: result.steps.length, resultLen: result.text.length }, 'Technical processing complete');
  return result.text || 'Не удалось обработать текст.';
}
