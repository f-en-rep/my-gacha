// 서비스별 요청 만들기와 응답 읽기.
import type { TextProfile, TextProviderKind } from '../../types';
import type { ChatMessage, ChatOptions, ChatResult } from './index';

export const DEFAULT_BASE_URLS: Record<TextProviderKind, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  nanogpt: 'https://nano-gpt.com/api/v1',
  'openai-compatible': '',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

export const ANTHROPIC_VERSION = '2023-06-01';
/** Anthropic은 max_tokens가 필수라 값이 없을 때 쓴다. 생각하는 모델을 생각해 넉넉하게 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 8192;
export const APP_TITLE = 'my-gacha';

export type ProviderFamily = 'openai' | 'anthropic' | 'gemini';

export function familyOf(provider: TextProviderKind): ProviderFamily {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'gemini') return 'gemini';
  return 'openai';
}

export function baseUrlFor(profile: TextProfile): string {
  const base = (profile.baseUrl?.trim() || DEFAULT_BASE_URLS[profile.provider]).replace(/\/+$/, '');
  if (!base) throw new Error('OpenAI 호환 연결에는 주소(baseUrl)가 필요합니다.');
  return base;
}

/** 응답이 길이 제한으로 끝났는데 내용이 비었을 때 */
export class TextTruncatedError extends Error {
  constructor(model: string) {
    super(
      `모델(${model})의 답변이 최대 토큰 수에 걸려 내용 없이 끝났습니다. ` +
        `생각하는(reasoning) 모델은 생각에 토큰을 많이 쓰므로 연결 설정의 최대 토큰(maxTokens)을 더 크게(예: 8000 이상) 잡아 주세요.`,
    );
    this.name = 'TextTruncatedError';
  }
}

/** 서비스가 정상 응답 형식으로 거절/차단을 알렸을 때 */
export class TextResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextResponseError';
  }
}

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface RequestTweaks {
  /** 400 응답 뒤 temperature를 빼고 다시 보낼 때 */
  dropTemperature?: boolean;
  /** max_tokens / max_completion_tokens 중 무엇을 쓸지 강제 */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
}

export function authHeaders(profile: TextProfile): Record<string, string> {
  switch (familyOf(profile.provider)) {
    case 'anthropic':
      return {
        'x-api-key': profile.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    case 'gemini':
      return { 'x-goog-api-key': profile.apiKey };
    default: {
      const h: Record<string, string> = {};
      if (profile.apiKey) h.Authorization = `Bearer ${profile.apiKey}`;
      if (profile.provider === 'openrouter') {
        h['HTTP-Referer'] = appOrigin();
        h['X-Title'] = APP_TITLE;
      }
      return h;
    }
  }
}

function appOrigin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return loc?.origin && loc.origin !== 'null' ? loc.origin : 'https://my-gacha.local';
}

export function buildChatRequest(
  profile: TextProfile,
  messages: ChatMessage[],
  opts: ChatOptions,
  tweaks: RequestTweaks = {},
): BuiltRequest {
  const base = baseUrlFor(profile);
  const maxTokens = opts.maxTokens ?? profile.maxTokens;
  const temperature = tweaks.dropTemperature ? undefined : (opts.temperature ?? profile.temperature);
  const headers = { 'Content-Type': 'application/json', ...authHeaders(profile) };

  switch (familyOf(profile.provider)) {
    case 'anthropic': {
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const body: Record<string, unknown> = {
        model: profile.model,
        max_tokens: maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
        messages: mergeSameRole(messages.filter((m) => m.role !== 'system')).map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };
      if (system) body.system = system;
      // Anthropic temperature 범위는 0~1
      if (temperature !== undefined) body.temperature = Math.min(Math.max(temperature, 0), 1);
      return { url: `${base}/messages`, headers, body };
    }
    case 'gemini': {
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const contents = mergeSameRole(messages.filter((m) => m.role !== 'system')).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const generationConfig: Record<string, unknown> = {};
      if (maxTokens !== undefined) generationConfig.maxOutputTokens = maxTokens;
      if (temperature !== undefined) generationConfig.temperature = temperature;
      if (opts.json) generationConfig.responseMimeType = 'application/json';
      const body: Record<string, unknown> = { contents };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
      const model = encodeURIComponent(profile.model.replace(/^models\//, ''));
      return { url: `${base}/models/${model}:generateContent`, headers, body };
    }
    default: {
      const body: Record<string, unknown> = {
        model: profile.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (maxTokens !== undefined) {
        const field = tweaks.maxTokensField ?? (profile.provider === 'openai' ? 'max_completion_tokens' : 'max_tokens');
        body[field] = maxTokens;
      }
      if (temperature !== undefined) body.temperature = temperature;
      if (opts.json && (profile.provider === 'openai' || profile.provider === 'openrouter')) {
        body.response_format = { type: 'json_object' };
      }
      return { url: `${base}/chat/completions`, headers, body };
    }
  }
}

/** 같은 역할이 연달아 오면 합친다 (Anthropic/Gemini는 번갈아 오는 것을 선호) */
function mergeSameRole(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

export interface ParsedChat extends ChatResult {
  /** 길이 제한으로 끊겼는지 */
  truncated: boolean;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function parseChatResponse(profile: TextProfile, data: unknown): ParsedChat {
  const d = obj(data);
  switch (familyOf(profile.provider)) {
    case 'anthropic': {
      const blocks = Array.isArray(d.content) ? d.content : [];
      const text = blocks
        .map(obj)
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('');
      const u = obj(d.usage);
      const stop = d.stop_reason;
      if (stop === 'refusal' && !text.trim()) throw new TextResponseError('모델이 요청을 거절했습니다 (refusal).');
      return {
        text,
        model: typeof d.model === 'string' ? d.model : profile.model,
        usage: d.usage
          ? {
              inputTokens: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens),
              outputTokens: num(u.output_tokens),
            }
          : undefined,
        truncated: stop === 'max_tokens',
      };
    }
    case 'gemini': {
      const pf = obj(d.promptFeedback);
      const candidates = Array.isArray(d.candidates) ? d.candidates : [];
      const cand = obj(candidates[0]);
      if (!candidates.length && pf.blockReason) {
        throw new TextResponseError(`Gemini가 요청을 차단했습니다 (${String(pf.blockReason)}).`);
      }
      const parts = Array.isArray(obj(cand.content).parts) ? (obj(cand.content).parts as unknown[]) : [];
      const text = parts
        .map(obj)
        .filter((p) => typeof p.text === 'string' && p.thought !== true)
        .map((p) => p.text as string)
        .join('');
      const finish = cand.finishReason;
      if (!text.trim() && typeof finish === 'string' && /SAFETY|BLOCKLIST|PROHIBITED|SPII|RECITATION/.test(finish)) {
        throw new TextResponseError(`Gemini가 답변을 차단했습니다 (${finish}).`);
      }
      const u = obj(d.usageMetadata);
      return {
        text,
        model: typeof d.modelVersion === 'string' ? d.modelVersion : profile.model,
        usage: d.usageMetadata
          ? {
              inputTokens: num(u.promptTokenCount),
              outputTokens: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount),
            }
          : undefined,
        truncated: finish === 'MAX_TOKENS',
      };
    }
    default: {
      // OpenRouter 등은 200으로 error 객체를 돌려줄 때가 있다
      if (d.error && !Array.isArray(d.choices)) {
        const e = obj(d.error);
        throw new TextResponseError(`서비스 오류: ${typeof e.message === 'string' ? e.message : JSON.stringify(d.error)}`);
      }
      const choices = Array.isArray(d.choices) ? d.choices : [];
      const choice = obj(choices[0]);
      const message = obj(choice.message);
      const text = contentToText(message.content);
      const u = obj(d.usage);
      if (!text.trim() && typeof message.refusal === 'string' && message.refusal) {
        throw new TextResponseError(`모델이 요청을 거절했습니다: ${message.refusal}`);
      }
      return {
        text,
        model: typeof d.model === 'string' ? d.model : profile.model,
        usage: d.usage ? { inputTokens: num(u.prompt_tokens), outputTokens: num(u.completion_tokens) } : undefined,
        truncated: choice.finish_reason === 'length',
      };
    }
  }
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(obj)
      .filter((p) => (p.type === undefined || p.type === 'text') && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('');
  }
  return '';
}

/** 모델 목록 요청 주소 */
export function modelsUrl(profile: TextProfile): string {
  const base = baseUrlFor(profile);
  switch (familyOf(profile.provider)) {
    case 'anthropic':
      return `${base}/models?limit=1000`;
    case 'gemini':
      return `${base}/models?pageSize=1000`;
    default:
      return `${base}/models`;
  }
}

export function parseModelList(profile: TextProfile, data: unknown): string[] {
  const d = obj(data);
  const ids: string[] = [];
  if (familyOf(profile.provider) === 'gemini') {
    for (const m of Array.isArray(d.models) ? d.models : []) {
      const o = obj(m);
      const methods = o.supportedGenerationMethods;
      if (Array.isArray(methods) && !methods.includes('generateContent')) continue;
      if (typeof o.name === 'string') ids.push(o.name.replace(/^models\//, ''));
    }
  } else {
    const list = Array.isArray(d.data) ? d.data : Array.isArray(d.models) ? d.models : Array.isArray(data) ? data : [];
    for (const m of list) {
      if (typeof m === 'string') ids.push(m);
      else if (typeof obj(m).id === 'string') ids.push(obj(m).id as string);
    }
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
