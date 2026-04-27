import { describe, it, expect } from 'vitest';
import { buildProactivePrompt } from './proactive.js';

describe('buildProactivePrompt', () => {
  it('instructs meal reminders to focus on the scheduled meal context', () => {
    const prompt = buildProactivePrompt('meal_reminder', 'обед', 1);

    expect(prompt).toContain('обед');
    expect(prompt).toContain('НЕ продолжай старую переписку');
    expect(prompt).toContain('не отправляй универсальные фразы вроде «На связи»');
  });
});
