// 대화 답 받기 실행기. 패널을 닫거나 다른 캐릭터를 보고 와도 "답 쓰는 중"과 오류가 남도록 컴포넌트 밖에 둔다.
import { useSyncExternalStore } from 'react';
import { isReplying, regenerateLast, retryLast, sendChat } from '../../gen/chat';
import type { Id } from '../../types';

export type ChatJob = 'send' | 'retry' | 'regenerate';

export interface ChatRunState {
  replying: boolean;
  job?: ChatJob;
  error?: string;
  /** 실패한 작업 (다시 시도할 때 무엇을 할지) */
  failed?: ChatJob;
}

const IDLE: ChatRunState = { replying: false };
const states = new Map<string, ChatRunState>();
const listeners = new Set<() => void>();

const keyOf = (saveId: Id, characterId: Id) => saveId + '\u0000' + characterId;

function set(key: string, s: ChatRunState) {
  states.set(key, s);
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useChatRun(saveId: Id | undefined, characterId: Id | undefined): ChatRunState {
  return useSyncExternalStore(subscribe, () => (saveId && characterId ? (states.get(keyOf(saveId, characterId)) ?? IDLE) : IDLE));
}

/** 오류를 한국어 한 줄로 */
export function chatErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (!msg) return '답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  if (/not implemented/i.test(msg)) return '대화 기능이 아직 준비 중이에요.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return '연결 서버에 닿지 못했어요. 인터넷과 연결 주소를 확인해 주세요.';
  if (/\b401\b|\b403\b|unauthori[sz]ed|invalid api key/i.test(msg)) return 'API 키가 거절되었어요. 설정에서 연결을 확인해 주세요.';
  if (/\b429\b|rate.?limit/i.test(msg)) return '요청이 너무 많다고 해요. 잠시 뒤 다시 시도해 주세요.';
  if (/[가-힣]/.test(msg)) return msg;
  return `답을 받지 못했어요 (${msg.length > 140 ? msg.slice(0, 140) + '…' : msg})`;
}

async function run(saveId: Id, characterId: Id, job: ChatJob, fn: () => Promise<unknown>): Promise<boolean> {
  const key = keyOf(saveId, characterId);
  if (states.get(key)?.replying || isReplying(saveId, characterId)) return false;
  set(key, { replying: true, job });
  try {
    await fn();
    set(key, IDLE);
    return true;
  } catch (e) {
    set(key, { replying: false, error: chatErrorText(e), failed: job });
    return false;
  }
}

export function startSend(saveId: Id, characterId: Id, text: string): Promise<boolean> {
  return run(saveId, characterId, 'send', () => sendChat(saveId, characterId, text));
}

export function startRetry(saveId: Id, characterId: Id): Promise<boolean> {
  return run(saveId, characterId, 'retry', () => retryLast(saveId, characterId));
}

export function startRegenerate(saveId: Id, characterId: Id): Promise<boolean> {
  return run(saveId, characterId, 'regenerate', () => regenerateLast(saveId, characterId));
}

export function clearChatError(saveId: Id, characterId: Id): void {
  const key = keyOf(saveId, characterId);
  const s = states.get(key);
  if (s && !s.replying && s.error) set(key, IDLE);
}
