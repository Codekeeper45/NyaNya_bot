import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: vi.fn(), sendVoice: vi.fn() } },
}));
vi.mock('../../db/repos/messages.js', () => ({
  messagesRepo: { create: vi.fn() },
}));
vi.mock('../../voice/tts.js', () => ({
  synthesizeSpeech: vi.fn(),
}));

import { bot } from '../../bot/bot.js';
import { messagesRepo } from '../../db/repos/messages.js';
import { synthesizeSpeech } from '../../voice/tts.js';
import { messagingTools } from './messaging.js';

const mockSendMessage = bot.api.sendMessage as ReturnType<typeof vi.fn>;
const mockSendVoice = bot.api.sendVoice as ReturnType<typeof vi.fn>;
const mockCreate = messagesRepo.create as ReturnType<typeof vi.fn>;
const mockSynthesize = synthesizeSpeech as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessage.mockResolvedValue({});
  mockSendVoice.mockResolvedValue({});
  mockCreate.mockResolvedValue({});
});

describe('message_send_text', () => {
  it('sends message to Telegram and saves to DB', async () => {
    const { tools } = messagingTools(100, 1);
    const result = await tools.message_send_text.execute({ text: 'Привет!' }, {} as never);

    expect(mockSendMessage).toHaveBeenCalledWith(100, 'Привет!', { parse_mode: 'HTML' });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, role: 'assistant', content: 'Привет!', source: 'text' }));
    expect(result).toEqual({ sent: true, length: 7 });
  });

  it('ignores duplicate calls — second call returns already_sent', async () => {
    const { tools } = messagingTools(100, 1);
    await tools.message_send_text.execute({ text: 'Первый' }, {} as never);
    const second = await tools.message_send_text.execute({ text: 'Второй' }, {} as never);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ sent: false, reason: 'already_sent' });
  });

  it('wasSent() returns false before send and true after', async () => {
    const { tools, wasSent } = messagingTools(100, 1);

    expect(wasSent()).toBe(false);
    await tools.message_send_text.execute({ text: 'Hi' }, {} as never);
    expect(wasSent()).toBe(true);
  });

  it('does not corrupt underscores in urls and usernames', async () => {
    const { tools } = messagingTools(100, 1);
    const text = 'https://x.com/path_with_underscores and user_name';

    await tools.message_send_text.execute({ text }, {} as never);

    expect(mockSendMessage).toHaveBeenCalledWith(
      100,
      'https://x.com/path_with_underscores and user_name',
      { parse_mode: 'HTML' },
    );
  });

  it('strips audio tags from text messages', async () => {
    const { tools } = messagingTools(100, 1);
    const text = '[curious] Приветик! [short pause] Слушай, время ужина! [mischievously] Ты уже придумал?';

    await tools.message_send_text.execute({ text }, {} as never);

    expect(mockSendMessage).toHaveBeenCalledWith(
      100,
      'Приветик! Слушай, время ужина! Ты уже придумал?',
      { parse_mode: 'HTML' },
    );
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      role: 'assistant',
      content: 'Приветик! Слушай, время ужина! Ты уже придумал?',
      source: 'text',
    }));
  });
});

describe('message_send_voice', () => {
  it('sends voice message when TTS succeeds', async () => {
    const audioBuffer = Buffer.from('fake-audio');
    mockSynthesize.mockResolvedValue(audioBuffer);

    const { tools } = messagingTools(100, 1);
    const result = await tools.message_send_voice.execute({ text: 'Привет голос' }, {} as never);

    expect(mockSynthesize).toHaveBeenCalledWith('Привет голос');
    expect(mockSendVoice).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: true, mode: 'voice' });
  });

  it('falls back to text if TTS fails', async () => {
    mockSynthesize.mockRejectedValue(new Error('TTS unavailable'));

    const { tools } = messagingTools(100, 1);
    const result = await tools.message_send_voice.execute({ text: 'Привет голос' }, {} as never);

    expect(mockSendVoice).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith(100, 'Привет голос', { parse_mode: 'HTML' });
    expect(result).toEqual({ sent: true, mode: 'text_fallback' });
  });
});
