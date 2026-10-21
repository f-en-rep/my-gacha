// 텍스트 생성 (계약). 구현은 이 폴더 안에서 한다.
import type { ZodType } from 'zod';
import type { TextProfile } from '../../types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** 서비스가 지원하면 JSON 모드를 켠다 */
  json?: boolean;
}

export interface ChatResult {
  text: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface JsonOptions extends ChatOptions {
  /** 검증 실패 시 다시 시도할 횟수 (기본 2) */
  retries?: number;
}

export interface JsonResult<T> {
  value: T;
  raw: string;
  attempts: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  ms: number;
}

export async function chatComplete(_profile: TextProfile, _messages: ChatMessage[], _opts: ChatOptions = {}): Promise<ChatResult> {
  throw new Error('not implemented');
}

export async function generateJson<T>(_profile: TextProfile, _messages: ChatMessage[], _schema: ZodType<T>, _opts: JsonOptions = {}): Promise<JsonResult<T>> {
  throw new Error('not implemented');
}

export async function testTextConnection(_profile: TextProfile): Promise<ConnectionTestResult> {
  throw new Error('not implemented');
}

/** 서비스가 모델 목록을 주면 돌려준다. 못 주면 빈 배열 */
export async function listModels(_profile: TextProfile): Promise<string[]> {
  return [];
}
