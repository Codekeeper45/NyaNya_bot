import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { config } from '../config.js';
import type { LanguageModel } from 'ai';

const openrouter = createOpenRouter({ apiKey: config.openrouterApiKey });

/** Models that support native vision (image input) via OpenRouter */
const VISION_CAPABLE_PREFIXES = [
  'anthropic/',   // Claude
  'google/',      // Gemini, Gemma
  'openai/',      // GPT-4o, GPT-4V
  'meta-llama/',  // Llama 3.2+ vision
];

/** Check if the current primary model supports native vision input */
export function modelSupportsVision(): boolean {
  return VISION_CAPABLE_PREFIXES.some(prefix => config.primaryModel.startsWith(prefix));
}

/** Get the primary language model (always via OpenRouter) */
export function getPrimaryModel(): LanguageModel {
  return openrouter(config.primaryModel);
}

/** Get the fast model (always via OpenRouter) */
export function getFastModel(): LanguageModel {
  return openrouter(config.fastModel);
}

/** Get a vision-capable model for image description fallback */
export function getVisionModel(): LanguageModel {
  return openrouter(config.fastModel);
}

export { openrouter };
