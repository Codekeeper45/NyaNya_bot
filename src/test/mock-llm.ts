import { vi } from 'vitest';

export type MockToolCall = {
  toolName: string;
  args: Record<string, unknown>;
};

// Returns a generateText result shape that the orchestrator expects
export function makeLlmResult(text = '', toolCalls: MockToolCall[] = []) {
  return {
    text,
    steps: toolCalls.length > 0
      ? [{ text, toolCalls: toolCalls.map(tc => ({ ...tc, toolCallId: 'tc-1' })) }]
      : [],
  };
}

// Convenience: build a result that triggers the orchestrator fallback path
// (no tool calls, non-empty text → sends via bot.api.sendMessage directly)
export function makeFallbackResult(text: string) {
  return makeLlmResult(text, []);
}
