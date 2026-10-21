// 텍스트 생성 (계약). 구현은 이 폴더 안에서 한다.
import type { ZodType } from 'zod';
import type { TextProfile } from '../../types';
import { ApiError, apiFetch, ensureOk } from '../../net/http';
import { extractJson } from './json';
import {
  TextResponseError,
  TextTruncatedError,
  authHeaders,
  buildChatRequest,
  familyOf,
  modelsUrl,
  parseChatResponse,
  parseModelList,
  type RequestTweaks,
} from './providers';
import {
  VERTEX_CURATED_MODELS,
  VertexAuthError,
  describeVertexHttpError,
  forgetVertexToken,
  isServiceAccountMode,
  parseVertexModelList,
  vertexAuthHeaders,
  vertexModelsUrl,
} from './vertex';

export { extractJson } from './json';
export { DEFAULT_BASE_URLS, TextResponseError, TextTruncatedError, buildChatRequest } from './providers';
export {
  VERTEX_CURATED_MODELS,
  VERTEX_DEFAULT_LOCATION,
  VERTEX_LOCATIONS,
  VertexAuthError,
  summarizeServiceAccount,
  type ServiceAccountSummary,
} from './vertex';

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
  /** 답변이 최대 토큰 수에 걸려 끊겼는지 (내용은 있음) */
  truncated?: boolean;
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

/** JSON 생성이 끝내 실패했을 때. 마지막 답변을 담는다 */
export class JsonGenerationError extends Error {
  constructor(
    message: string,
    readonly raw: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = 'JsonGenerationError';
  }
}

export async function chatComplete(profile: TextProfile, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const label = `텍스트 생성 (${profile.provider}/${profile.model})`;
  const tweaks: RequestTweaks = {};
  const isVertex = profile.provider === 'vertex';
  let vertexAuth = isVertex ? await vertexAuthHeaders(profile, opts.signal) : {};
  let reauthed = false;
  // 400 응답이 특정 파라미터 때문이면 고쳐서 한두 번 더 보낸다
  for (let adjust = 0; ; adjust++) {
    const req = buildChatRequest(profile, messages, opts, tweaks);
    const res = await apiFetch(
      req.url,
      { method: 'POST', headers: { ...req.headers, ...vertexAuth }, body: JSON.stringify(req.body), signal: opts.signal },
      { useRelay: profile.useRelay },
    );
    // 캐시된 토큰이 취소되었을 수 있으니 한 번만 새로 받아 다시 보낸다
    if (res.status === 401 && !reauthed && isServiceAccountMode(profile)) {
      reauthed = true;
      await forgetVertexToken(profile);
      vertexAuth = await vertexAuthHeaders(profile, opts.signal);
      continue;
    }
    if (!res.ok && res.status === 400 && adjust < 2 && familyOf(profile.provider) === 'openai') {
      const detail = await res.clone().text().catch(() => '');
      const fix = paramFix(detail, req.body, tweaks);
      if (fix) {
        Object.assign(tweaks, fix);
        continue;
      }
    }
    await ensureOk(res, label);
    const parsed = parseChatResponse(profile, await res.json());
    if (parsed.truncated && !parsed.text.trim()) throw new TextTruncatedError(profile.model);
    const result: ChatResult = { text: parsed.text, model: parsed.model };
    if (parsed.usage) result.usage = parsed.usage;
    if (parsed.truncated) result.truncated = true;
    return result;
  }
}

/** 400 본문을 보고 고칠 수 있는 파라미터 문제인지 판단 */
function paramFix(detail: string, body: Record<string, unknown>, tweaks: RequestTweaks): RequestTweaks | null {
  const d = detail.toLowerCase();
  if ('temperature' in body && !tweaks.dropTemperature && d.includes('temperature') && /unsupported|not support|only the default|does not support|invalid/.test(d)) {
    return { dropTemperature: true };
  }
  if ('max_tokens' in body && d.includes('max_tokens') && d.includes('max_completion_tokens')) {
    return { maxTokensField: 'max_completion_tokens' };
  }
  if ('max_completion_tokens' in body && d.includes('max_completion_tokens') && /unsupported|unrecognized|unknown|not support|extra/.test(d)) {
    return { maxTokensField: 'max_tokens' };
  }
  return null;
}

const FEEDBACK_REPLY_LIMIT = 8000;
const FEEDBACK_ISSUES_LIMIT = 1500;

export async function generateJson<T>(profile: TextProfile, messages: ChatMessage[], schema: ZodType<T>, opts: JsonOptions = {}): Promise<JsonResult<T>> {
  const retries = Math.max(0, opts.retries ?? 2);
  const convo = [...messages];
  const baseTemp = opts.temperature ?? profile.temperature;
  let lastRaw = '';
  let lastProblem = '';

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const chatOpts: ChatOptions = { ...opts, json: opts.json ?? true };
    if (attempt > 1) chatOpts.temperature = Math.min(baseTemp ?? 0.7, 0.7);
    const res = await chatComplete(profile, convo, chatOpts);
    lastRaw = res.text;

    const extracted = extractJson(res.text);
    let feedback: string;
    if (extracted.ok) {
      const checked = schema.safeParse(extracted.value);
      if (checked.success) return { value: checked.data, raw: res.text, attempts: attempt };
      const issues = formatIssues(checked.error.issues);
      lastProblem = `schema validation failed:\n${issues}`;
      feedback =
        `Your previous reply was valid JSON but did not match the required schema. Problems:\n${issues}\n\n` +
        `Reply again with the corrected JSON only — the complete object, no explanations, no code fences.`;
    } else {
      lastProblem = `could not read JSON: ${extracted.error}`;
      feedback =
        `Your previous reply could not be parsed as JSON (${extracted.error}).` +
        (res.truncated ? ' It was cut off by the output length limit, so keep the answer more concise.' : '') +
        `\n\nReply again with valid JSON only — the complete object, no explanations, no code fences.`;
    }
    if (res.truncated) lastProblem += ' (답변이 최대 토큰 수에 걸려 끊겼습니다. maxTokens를 늘려 보세요)';

    convo.push({ role: 'assistant', content: truncate(res.text || '(empty reply)', FEEDBACK_REPLY_LIMIT) });
    convo.push({ role: 'user', content: feedback });
  }

  const attempts = retries + 1;
  throw new JsonGenerationError(
    `JSON 생성 실패 (${attempts}번 시도): ${lastProblem}\n마지막 답변 앞부분: ${truncate(lastRaw, 300)}`,
    lastRaw,
    attempts,
  );
}

function formatIssues(issues: { path: (string | number)[]; message: string }[]): string {
  const lines = issues.slice(0, 20).map((i) => `- ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
  if (issues.length > 20) lines.push(`- ...and ${issues.length - 20} more`);
  return truncate(lines.join('\n'), FEEDBACK_ISSUES_LIMIT);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 에러를 사용자에게 보여 줄 한국어 설명으로 바꾼다 */
export function describeTextError(err: unknown, profile?: Pick<TextProfile, 'useRelay' | 'model'> & Partial<Pick<TextProfile, 'provider' | 'vertex'>>): string {
  if (err instanceof DOMException && err.name === 'AbortError') return '요청이 취소되었습니다.';
  if (err instanceof Error && err.name === 'AbortError') return '요청이 취소되었습니다.';
  if (err instanceof TextTruncatedError || err instanceof TextResponseError || err instanceof JsonGenerationError || err instanceof VertexAuthError) {
    return err.message;
  }
  if (err instanceof ApiError && profile?.provider === 'vertex') {
    const v = describeVertexHttpError(err, profile.vertex?.auth === 'serviceAccount');
    if (v) return v;
  }
  if (err instanceof ApiError) {
    const s = err.status;
    const m = err.message;
    if (s === 401 || s === 403 || (s === 400 && /API_KEY_INVALID|API key not valid|invalid.{0,10}api.?key/i.test(m))) {
      return `API 키가 맞지 않거나 권한이 없습니다 (HTTP ${s}). 키를 다시 확인해 주세요.`;
    }
    if (s === 404) {
      return `모델 또는 주소를 찾을 수 없습니다 (HTTP 404). 모델 이름${profile ? ` "${profile.model}"` : ''}과 주소를 확인해 주세요.`;
    }
    if (s === 402) return '크레딧(잔액)이 부족합니다 (HTTP 402). 서비스에서 충전 상태를 확인해 주세요.';
    if (s === 429) return '요청이 너무 많거나 사용 한도를 넘었습니다 (HTTP 429). 잠시 뒤 다시 시도하거나 요금제/한도를 확인해 주세요.';
    if (s >= 500) return `서비스 쪽 오류입니다 (HTTP ${s}). 잠시 뒤 다시 시도해 주세요.`;
    return `요청이 거절되었습니다: ${m}`;
  }
  if (err instanceof TypeError) {
    return profile?.useRelay
      ? '네트워크 오류: 중계기를 통해서도 서비스에 닿지 못했습니다. 인터넷 연결과 주소를 확인해 주세요.'
      : '네트워크 오류 또는 브라우저 보안(CORS) 차단으로 서비스에 닿지 못했습니다. 인터넷 연결을 확인하고, 계속되면 연결 설정에서 "중계기 사용"을 켜 보세요.';
  }
  return err instanceof Error ? err.message : String(err);
}

export async function testTextConnection(profile: TextProfile): Promise<ConnectionTestResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  // 서비스 계정은 토큰 발급과 생성 요청을 따로 확인해서 어디서 막혔는지 알려 준다
  const twoStage = isServiceAccountMode(profile);
  if (twoStage) {
    try {
      await vertexAuthHeaders(profile);
    } catch (err) {
      return { ok: false, message: `서비스 계정 인증(토큰 발급) 실패: ${describeTextError(err, profile)}`, ms: elapsed() };
    }
  }
  try {
    const res = await chatComplete(profile, [{ role: 'user', content: 'Reply with the single word: ok' }], { maxTokens: 16 });
    return { ok: true, message: `연결 성공 (모델: ${res.model})`, ms: elapsed() };
  } catch (err) {
    // 생각하는 모델은 16토큰으로는 답을 못 내지만 연결 자체는 된 것이다
    if (err instanceof TextTruncatedError) {
      return {
        ok: true,
        message: `연결 성공 (모델: ${profile.model}). 생각하는 모델로 보이니 실제 생성에서는 최대 토큰을 넉넉히 잡아 주세요.`,
        ms: elapsed(),
      };
    }
    const msg = describeTextError(err, profile);
    return { ok: false, message: twoStage ? `인증(토큰 발급)은 성공했지만 생성 요청이 실패했습니다: ${msg}` : msg, ms: elapsed() };
  }
}

/** 서비스가 모델 목록을 주면 돌려준다. 못 주면 빈 배열 */
export async function listModels(profile: TextProfile): Promise<string[]> {
  if (profile.provider === 'vertex') return listVertexModels(profile);
  try {
    const res = await apiFetch(modelsUrl(profile), { method: 'GET', headers: authHeaders(profile) }, { useRelay: profile.useRelay });
    await ensureOk(res, '모델 목록');
    return parseModelList(profile, await res.json());
  } catch {
    return [];
  }
}

/** Vertex: 서비스 계정이면 publisher 모델 목록을 시도하고, 안 되면 정리해 둔 목록 (API 키는 목록 API를 못 쓴다) */
async function listVertexModels(profile: TextProfile): Promise<string[]> {
  if (isServiceAccountMode(profile)) {
    try {
      const headers = await vertexAuthHeaders(profile);
      const res = await apiFetch(vertexModelsUrl(profile), { method: 'GET', headers }, { useRelay: profile.useRelay });
      await ensureOk(res, '모델 목록');
      const ids = parseVertexModelList(await res.json());
      if (ids.length) return ids;
    } catch {
      // 아래 목록으로
    }
  }
  return [...VERTEX_CURATED_MODELS];
}
