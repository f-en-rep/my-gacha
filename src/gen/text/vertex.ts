// Google Vertex AI: 주소 만들기와 인증 (API 키 / 서비스 계정 JSON).
// 요청·응답 본문은 Gemini generateContent와 같아서 providers.ts의 gemini 처리를 그대로 쓴다.
//
// - API 키 (Vertex AI express mode): https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent
//   키는 x-goog-api-key 헤더 (google-genai SDK와 같은 방식).
// - 서비스 계정: JSON 키로 RS256 JWT를 만들어 token_uri에서 access token으로 바꾼 뒤 Bearer로 호출.
//   https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent
//   location이 global이면 호스트는 aiplatform.googleapis.com.
import type { TextProfile, VertexOptions } from '../../types';
import { ApiError, apiFetch } from '../../net/http';

export const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
export const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const VERTEX_DEFAULT_LOCATION = 'global';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
/** 만료 5분 전부터는 새 토큰을 받는다 */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const JWT_LIFETIME_S = 3600;

/** 목록 API를 못 쓸 때 보여 줄 Gemini 모델 (Vertex AI publisher model id) */
export const VERTEX_CURATED_MODELS: readonly string[] = [
  'gemini-4-argon',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

/** 자주 쓰는 리전 (UI datalist용) */
export const VERTEX_LOCATIONS: readonly string[] = [
  'global',
  'us-central1',
  'us-east4',
  'us-east5',
  'us-west1',
  'us-west4',
  'europe-west1',
  'europe-west4',
  'europe-west9',
  'asia-northeast1',
  'asia-northeast3',
  'asia-southeast1',
];

/** Vertex 설정·인증 문제. stage로 토큰 발급 단계인지 구분한다 */
export class VertexAuthError extends Error {
  constructor(
    message: string,
    readonly stage: 'config' | 'token',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'VertexAuthError';
  }
}

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
  token_uri: string;
}

export function vertexOptions(profile: TextProfile): VertexOptions {
  return profile.vertex ?? { auth: 'apiKey' };
}

export function isServiceAccountMode(profile: TextProfile): boolean {
  return profile.provider === 'vertex' && vertexOptions(profile).auth === 'serviceAccount';
}

/** 서비스 계정 JSON 읽기. 문제가 있으면 VertexAuthError(config) */
export function parseServiceAccount(raw: string): ServiceAccountKey {
  const text = raw.trim();
  if (!text) throw new VertexAuthError('서비스 계정 JSON 키를 붙여 넣거나 파일로 열어 주세요.', 'config');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new VertexAuthError('서비스 계정 키가 올바른 JSON이 아닙니다. Google Cloud에서 받은 .json 파일 내용을 통째로 넣어 주세요.', 'config');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new VertexAuthError('서비스 계정 키 JSON의 형식이 맞지 않습니다.', 'config');
  }
  const o = data as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  if (o.type !== undefined && o.type !== 'service_account') {
    throw new VertexAuthError(`서비스 계정 키가 아닙니다 (type: ${String(o.type)}). "service_account" 유형의 JSON 키가 필요합니다.`, 'config');
  }
  const missing = ['client_email', 'private_key'].filter((k) => !str(k));
  if (missing.length) {
    throw new VertexAuthError(`서비스 계정 키 JSON에 ${missing.join(', ')} 항목이 없습니다. 키 파일을 다시 받아 주세요.`, 'config');
  }
  const tokenUri = str('token_uri') || DEFAULT_TOKEN_URI;
  let tokenUrl: URL;
  try {
    tokenUrl = new URL(tokenUri);
  } catch {
    throw new VertexAuthError('서비스 계정 키의 token_uri가 올바른 주소가 아닙니다.', 'config');
  }
  if (tokenUrl.protocol !== 'https:') throw new VertexAuthError('서비스 계정 키의 token_uri는 https 주소여야 합니다.', 'config');
  const key: ServiceAccountKey = { client_email: str('client_email'), private_key: o.private_key as string, token_uri: tokenUri };
  if (str('private_key_id')) key.private_key_id = str('private_key_id');
  if (str('project_id')) key.project_id = str('project_id');
  return key;
}

/** UI에 보여 줄 요약. 개인 키는 절대 담지 않는다 */
export type ServiceAccountSummary = { ok: true; clientEmail: string; projectId?: string } | { ok: false; error: string };

export function summarizeServiceAccount(raw: string): ServiceAccountSummary {
  try {
    const k = parseServiceAccount(raw);
    return k.project_id ? { ok: true, clientEmail: k.client_email, projectId: k.project_id } : { ok: true, clientEmail: k.client_email };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- 주소 ----------

export function vertexLocation(profile: TextProfile): string {
  const loc = (vertexOptions(profile).location?.trim() || VERTEX_DEFAULT_LOCATION).toLowerCase();
  if (loc === 'us' || loc === 'eu') {
    throw new VertexAuthError('멀티 리전(us, eu)은 아직 지원하지 않습니다. global 또는 us-central1 같은 단일 리전을 입력해 주세요.', 'config');
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(loc)) {
    throw new VertexAuthError(`리전 이름이 올바르지 않습니다: "${loc}". 예: global, us-central1, asia-northeast3`, 'config');
  }
  return loc;
}

export function vertexHost(location: string): string {
  return location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
}

export function vertexModelId(model: string): string {
  return model.trim().replace(/^(projects\/[^/]+\/locations\/[^/]+\/)?publishers\/google\//, '').replace(/^models\//, '');
}

/** generateContent 주소. 서비스 계정 방식이면 JSON(또는 덮어쓴 프로젝트 ID)이 필요하다 */
export function vertexGenerateUrl(profile: TextProfile): string {
  const model = encodeURIComponent(vertexModelId(profile.model));
  if (!isServiceAccountMode(profile)) {
    return `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`;
  }
  return `${vertexProjectBase(profile)}/publishers/google/models/${model}:generateContent`;
}

function vertexProjectBase(profile: TextProfile): string {
  const sa = parseServiceAccount(profile.apiKey);
  const project = vertexOptions(profile).projectId?.trim() || sa.project_id;
  if (!project) throw new VertexAuthError('프로젝트 ID가 없습니다. JSON에 project_id가 없으면 프로젝트 ID 칸에 입력해 주세요.', 'config');
  const location = vertexLocation(profile);
  return `https://${vertexHost(location)}/v1/projects/${encodeURIComponent(project)}/locations/${location}`;
}

/** publisher 모델 목록 주소 (서비스 계정 방식만. API 키는 이 API가 받지 않는다) */
export function vertexModelsUrl(profile: TextProfile): string {
  return `https://${vertexHost(vertexLocation(profile))}/v1beta1/publishers/google/models?pageSize=300`;
}

export function parseVertexModelList(data: unknown): string[] {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(d.publisherModels) ? d.publisherModels : [];
  const ids: string[] = [];
  for (const m of list) {
    const name = m && typeof m === 'object' ? (m as Record<string, unknown>).name : undefined;
    if (typeof name !== 'string') continue;
    const id = vertexModelId(name);
    if (!/^gemini-/.test(id)) continue;
    if (/embedding|tts|image|live|audio|robotics|computer-use/.test(id)) continue;
    ids.push(id);
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

// ---------- 인증 ----------

/** 요청에 붙일 인증 헤더. 서비스 계정이면 토큰을 받아 온다 (캐시) */
export async function vertexAuthHeaders(profile: TextProfile, signal?: AbortSignal): Promise<Record<string, string>> {
  if (!isServiceAccountMode(profile)) {
    if (!profile.apiKey.trim()) throw new VertexAuthError('Vertex AI API 키를 입력해 주세요.', 'config');
    return { 'x-goog-api-key': profile.apiKey.trim() };
  }
  const token = await getVertexAccessToken(profile, signal);
  return { Authorization: `Bearer ${token}` };
}

interface CachedToken {
  token: string;
  /** 이 시각(ms)까지 재사용 */
  reuseUntil: number;
}

const tokenCache = new Map<string, CachedToken>();
const tokenInflight = new Map<string, Promise<string>>();

export function clearVertexTokenCache(): void {
  tokenCache.clear();
  tokenInflight.clear();
}

async function cacheKey(profile: TextProfile): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(profile.apiKey.trim()));
  return `${profile.id}|${hex(new Uint8Array(digest)).slice(0, 32)}`;
}

/** 이 프로필의 캐시된 토큰을 버린다 (401을 받았을 때) */
export async function forgetVertexToken(profile: TextProfile): Promise<void> {
  tokenCache.delete(await cacheKey(profile));
}

export async function getVertexAccessToken(profile: TextProfile, signal?: AbortSignal): Promise<string> {
  const sa = parseServiceAccount(profile.apiKey);
  const key = await cacheKey(profile);
  const hit = tokenCache.get(key);
  if (hit && Date.now() < hit.reuseUntil) return hit.token;
  const pending = tokenInflight.get(key);
  if (pending) return pending;
  const p = exchangeToken(sa, profile.useRelay, signal)
    .then(({ token, expiresIn }) => {
      tokenCache.set(key, { token, reuseUntil: Date.now() + expiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS });
      return token;
    })
    .finally(() => tokenInflight.delete(key));
  tokenInflight.set(key, p);
  return p;
}

async function exchangeToken(sa: ServiceAccountKey, useRelay: boolean, signal?: AbortSignal): Promise<{ token: string; expiresIn: number }> {
  const assertion = await signServiceAccountJwt(sa, Math.floor(Date.now() / 1000));
  const body = new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString();
  const res = await apiFetch(
    sa.token_uri,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal },
    { useRelay },
  );
  const text = await res.text().catch(() => '');
  if (!res.ok) throw tokenError(res.status, text);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // 아래에서 처리
  }
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new VertexAuthError('토큰 발급 응답에 access_token이 없습니다.', 'token', res.status);
  }
  const expiresIn = typeof data.expires_in === 'number' && data.expires_in > 0 ? data.expires_in : JWT_LIFETIME_S;
  return { token: data.access_token, expiresIn };
}

function tokenError(status: number, text: string): VertexAuthError {
  let code = '';
  let desc = '';
  try {
    const d = JSON.parse(text) as Record<string, unknown>;
    if (typeof d.error === 'string') code = d.error;
    if (typeof d.error_description === 'string') desc = d.error_description;
  } catch {
    desc = text.slice(0, 200);
  }
  const detail = [code, desc].filter(Boolean).join(': ');
  const tail = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403) {
    return new VertexAuthError(
      `서비스 계정 인증이 거절되었습니다 (HTTP ${status})${tail}. 서비스 계정이 사용 중지되었거나 키가 삭제되지 않았는지 확인하고, ` +
        `이 계정에 "Vertex AI User"(roles/aiplatform.user) 역할이 있고 프로젝트에서 Vertex AI API가 사용 설정되어 있는지 확인해 주세요.`,
      'token',
      status,
    );
  }
  if (status === 400 && code === 'invalid_grant') {
    return new VertexAuthError(
      `서비스 계정 키가 거절되었습니다 (HTTP 400${tail}). 키가 삭제·비활성화되었거나 이 기기의 시계가 많이 틀렸을 수 있어요. 새 키를 받아 다시 넣어 보세요.`,
      'token',
      status,
    );
  }
  return new VertexAuthError(`액세스 토큰을 받지 못했습니다 (HTTP ${status})${tail}.`, 'token', status);
}

// ---------- JWT (RS256) ----------

export async function signServiceAccountJwt(sa: ServiceAccountKey, iat: number): Promise<string> {
  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (sa.private_key_id) header.kid = sa.private_key_id;
  const claims = { iss: sa.client_email, scope: VERTEX_SCOPE, aud: sa.token_uri, iat, exp: iat + JWT_LIFETIME_S };
  const input = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(claims))}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, '\n');
  if (/BEGIN RSA PRIVATE KEY/.test(normalized)) {
    throw new VertexAuthError('개인 키 형식(PKCS#1)을 지원하지 않습니다. Google Cloud에서 받은 서비스 계정 JSON 키를 그대로 넣어 주세요.', 'config');
  }
  const m = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(normalized);
  if (!m) throw new VertexAuthError('서비스 계정 키의 private_key가 올바른 PEM 형식이 아닙니다.', 'config');
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = fromBase64(m[1]!.replace(/\s+/g, ''));
  } catch {
    throw new VertexAuthError('서비스 계정 키의 private_key를 읽지 못했습니다 (base64 오류).', 'config');
  }
  try {
    return await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new VertexAuthError('서비스 계정 키의 private_key를 불러오지 못했습니다. 키 파일이 손상되지 않았는지 확인해 주세요.', 'config');
  }
}

function b64urlText(s: string): string {
  return b64url(new TextEncoder().encode(s));
}

export function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 생성 요청이 401/403일 때 보여 줄 Vertex 전용 설명 */
export function describeVertexHttpError(err: ApiError, serviceAccount: boolean): string | null {
  const s = err.status;
  const m = err.message;
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(m)) {
    return `프로젝트에서 Vertex AI API가 꺼져 있습니다 (HTTP ${s}). Google Cloud 콘솔에서 "Vertex AI API"를 사용 설정한 뒤 몇 분 기다려 다시 시도해 주세요.`;
  }
  if (s === 401 || s === 403) {
    return serviceAccount
      ? `Vertex AI가 요청을 거절했습니다 (HTTP ${s}). 서비스 계정에 "Vertex AI User"(roles/aiplatform.user) 역할이 있는지, 프로젝트 ID가 맞는지, 프로젝트에서 Vertex AI API가 사용 설정되어 있는지 확인해 주세요.`
      : `Vertex AI API 키가 맞지 않거나 권한이 없습니다 (HTTP ${s}). Vertex AI(express mode)용 API 키인지 확인해 주세요. Gemini API(AI Studio) 키라면 서비스를 "Google Gemini"로 바꿔 주세요.`;
  }
  if (s === 404) {
    return `모델 또는 주소를 찾을 수 없습니다 (HTTP 404). 모델 이름이 맞는지, 이 리전에서 쓸 수 있는 모델인지 확인해 주세요 (리전을 global로 바꾸면 되는 경우가 많아요).`;
  }
  return null;
}
