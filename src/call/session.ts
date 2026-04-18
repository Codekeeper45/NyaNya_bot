export interface CallSession {
  userId: number;
  telegramChatId: number;
  userName: string;
  timezone: string;
  reason: string;
  callType: 'self' | 'third_party';
  targetName?: string;
  agenda?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  startedAt: number;
}

const sessions = new Map<string, CallSession>();

export function createSession(callSid: string, data: Omit<CallSession, 'history' | 'startedAt'>): void {
  sessions.set(callSid, { ...data, history: [], startedAt: Date.now() });
}

export function getSession(callSid: string): CallSession | undefined {
  return sessions.get(callSid);
}

export function addTurn(callSid: string, role: 'user' | 'assistant', content: string): void {
  const s = sessions.get(callSid);
  if (s) s.history.push({ role, content });
}

export function deleteSession(callSid: string): void {
  sessions.delete(callSid);
}
