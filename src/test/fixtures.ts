import type { Update } from '@grammyjs/types';
import type { User } from '../db/schema.js';
import type { JobPayload } from '../scheduler/jobs.js';

export const TEST_USER_ID = 100;
export const TEST_CHAT_ID = 200;
export const TEST_DB_USER_ID = 1;

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: TEST_DB_USER_ID,
    telegramUserId: TEST_USER_ID,
    name: 'Тест',
    timezone: 'Asia/Almaty',
    wakeTime: '08:00',
    sleepTime: '23:00',
    breakfastTime: null,
    lunchTime: null,
    dinnerTime: null,
    paused: false,
    onboardingComplete: true,
    googleRefreshToken: null,
    phoneNumber: null,
    preferences: {},
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function baseUpdate(extra: Partial<Update> = {}): Update {
  return {
    update_id: Math.floor(Math.random() * 100000),
    ...extra,
  };
}

export function makeTextUpdate(text: string, userId = TEST_USER_ID, chatId = TEST_CHAT_ID): Update {
  return baseUpdate({
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' as const, first_name: 'Тест' },
      from: { id: userId, is_bot: false, first_name: 'Тест' },
      text,
    },
  });
}

export function makeCommandUpdate(command: string, userId = TEST_USER_ID, chatId = TEST_CHAT_ID): Update {
  const text = `/${command}`;
  return baseUpdate({
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' as const, first_name: 'Тест' },
      from: { id: userId, is_bot: false, first_name: 'Тест' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.length }],
    },
  });
}

export function makePhotoUpdate(fileId: string, caption?: string, userId = TEST_USER_ID, chatId = TEST_CHAT_ID): Update {
  return baseUpdate({
    message: {
      message_id: 2,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' as const, first_name: 'Тест' },
      from: { id: userId, is_bot: false, first_name: 'Тест' },
      photo: [
        { file_id: fileId, file_unique_id: 'uniq1', width: 100, height: 100, file_size: 1000 },
        { file_id: fileId + '_large', file_unique_id: 'uniq2', width: 800, height: 600, file_size: 80000 },
      ],
      caption,
    },
  });
}

export function makeVoiceUpdate(fileId: string, userId = TEST_USER_ID, chatId = TEST_CHAT_ID): Update {
  return baseUpdate({
    message: {
      message_id: 3,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' as const, first_name: 'Тест' },
      from: { id: userId, is_bot: false, first_name: 'Тест' },
      voice: { file_id: fileId, file_unique_id: 'voice1', duration: 5, file_size: 10000 },
    },
  });
}

export function makeCallbackUpdate(data: string, userId = TEST_USER_ID, chatId = TEST_CHAT_ID): Update {
  return baseUpdate({
    callback_query: {
      id: 'cb1',
      from: { id: userId, is_bot: false, first_name: 'Тест' },
      chat_instance: 'inst1',
      data,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' as const, first_name: 'Тест' },
      } as any,
    },
  });
}

export function makeJobPayload(overrides: Partial<JobPayload> = {}): JobPayload {
  return {
    userId: TEST_DB_USER_ID,
    telegramUserId: TEST_USER_ID,
    telegramChatId: TEST_CHAT_ID,
    kind: 'morning_greeting',
    context: 'Тест',
    attemptNumber: 1,
    ...overrides,
  };
}
