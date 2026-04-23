import type { Api } from 'grammy';

export async function withTyping<T>(
  api: Api,
  chatId: number,
  fn: () => Promise<T>,
  action: 'typing' | 'upload_voice' | 'upload_photo' | 'upload_document' = 'typing',
): Promise<T> {
  let stopped = false;
  let wakeUp: () => void = () => {};

  const tick = async () => {
    while (!stopped) {
      await api.sendChatAction(chatId, action).catch(() => {});
      await Promise.race([
        new Promise<void>(r => setTimeout(r, 4000)),
        new Promise<void>(r => { wakeUp = r; }),
      ]);
    }
  };

  const loop = tick();
  try {
    return await fn();
  } finally {
    stopped = true;
    wakeUp();
    await loop;
  }
}
