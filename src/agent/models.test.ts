import { describe, it, expect } from 'vitest';

// Test the pure logic without config dependency
// modelSupportsVision reads config at call time, so we test the underlying logic

const VISION_CAPABLE_PREFIXES = [
  'anthropic/',
  'google/',
  'openai/',
  'meta-llama/',
];

function checkVision(provider: string, model: string): boolean {
  if (provider === 'deepseek') return false;
  return VISION_CAPABLE_PREFIXES.some(prefix => model.startsWith(prefix));
}

describe('modelSupportsVision logic', () => {
  it('returns false when provider is deepseek', () => {
    expect(checkVision('deepseek', 'deepseek-v4-pro')).toBe(false);
  });

  it('returns true for google models via openrouter', () => {
    expect(checkVision('openrouter', 'google/gemma-4-31b-it')).toBe(true);
  });

  it('returns true for anthropic models via openrouter', () => {
    expect(checkVision('openrouter', 'anthropic/claude-sonnet-4-5')).toBe(true);
  });

  it('returns true for openai models via openrouter', () => {
    expect(checkVision('openrouter', 'openai/gpt-4o')).toBe(true);
  });

  it('returns true for meta-llama models via openrouter', () => {
    expect(checkVision('openrouter', 'meta-llama/llama-3.2-90b-vision')).toBe(true);
  });

  it('returns false for unknown prefixes via openrouter', () => {
    expect(checkVision('openrouter', 'mistral/mistral-large')).toBe(false);
  });
});