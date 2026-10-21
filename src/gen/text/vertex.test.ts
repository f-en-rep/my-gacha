import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextProfile } from '../../types';
import { chatComplete, describeTextError, listModels, testTextConnection, VERTEX_CURATED_MODELS } from './index';
import {
  VertexAuthError,
  clearVertexTokenCache,
  parseServiceAccount,
  parseVertexModelList,
  signServiceAccountJwt,
  summarizeServiceAccount,
  vertexGenerateUrl,
} from './vertex';

// ---- 테스트용 RSA 키 ----
let pem = '';
let publicKey: CryptoKey;

function toPem(der: ArrayBuffer): string {
  let bin = '';
  for (const b of new Uint8Array(der)) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  pem = toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  publicKey = pair.publicKey;
});

function saJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'proj-a',
    private_key_id: 'kid123',
    private_key: pem,
    client_email: 'bot@proj-a.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token',
    ...extra,
  });
}

function profile(extra: Partial<TextProfile> = {}): TextProfile {
  return {
    id: 'v1',
    type: 'text',
    label: 'vertex',
    apiKey: 'AQ.express-key',
    useRelay: false,
    provider: 'vertex',
    model: 'gemini-2.5-flash',
    vertex: { auth: 'apiKey' },
    ...extra,
  };
}

function saProfile(vertex: Partial<NonNullable<TextProfile['vertex']>> = {}, extra: Partial<TextProfile> = {}): TextProfile {
  return profile({ apiKey: saJson(), vertex: { auth: 'serviceAccount', ...vertex }, ...extra });
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const decodeJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s))) as Record<string, unknown>;

// ---- fetch 흉내 ----
interface Call {
  url: string;
  init: RequestInit;
  headers: Headers;
}
let calls: Call[];
let replies: (() => Response)[];

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const geminiReply = (text = 'ok') =>
  json({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 }, modelVersion: 'gemini-2.5-flash' });
const tokenReply = (token = 'ya29.tok', expires_in = 3599) => json({ access_token: token, expires_in, token_type: 'Bearer' });
const queue = (...rs: Response[]) => replies.push(...rs.map((r) => () => r));

beforeEach(() => {
  calls = [];
  replies = [];
  clearVertexTokenCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init, headers: new Headers(init.headers) });
      const next = replies.shift();
      if (!next) throw new Error('unexpected fetch ' + url);
      return next();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const msgs = [
  { role: 'system' as const, content: 'SYS' },
  { role: 'user' as const, content: 'hi' },
];

describe('parseServiceAccount', () => {
  it('reads the fields and defaults token_uri', () => {
    const k = parseServiceAccount(saJson({ token_uri: undefined }));
    expect(k.client_email).toBe('bot@proj-a.iam.gserviceaccount.com');
    expect(k.project_id).toBe('proj-a');
    expect(k.private_key_id).toBe('kid123');
    expect(k.token_uri).toBe('https://oauth2.googleapis.com/token');
  });

  it('rejects malformed JSON, wrong type, and missing fields with Korean messages', () => {
    expect(() => parseServiceAccount('{not json')).toThrow(/올바른 JSON이 아닙니다/);
    expect(() => parseServiceAccount('')).toThrow(VertexAuthError);
    expect(() => parseServiceAccount(saJson({ type: 'authorized_user' }))).toThrow(/서비스 계정 키가 아닙니다/);
    expect(() => parseServiceAccount(saJson({ private_key: undefined }))).toThrow(/private_key/);
    expect(() => parseServiceAccount(saJson({ client_email: '' }))).toThrow(/client_email/);
    expect(() => parseServiceAccount(saJson({ token_uri: 'http://oauth2.googleapis.com/token' }))).toThrow(/https/);
  });

  it('summary never includes the private key', () => {
    const s = summarizeServiceAccount(saJson());
    expect(s).toEqual({ ok: true, clientEmail: 'bot@proj-a.iam.gserviceaccount.com', projectId: 'proj-a' });
    expect(JSON.stringify(s)).not.toContain('PRIVATE KEY');
    expect(summarizeServiceAccount('{').ok).toBe(false);
  });
});

describe('JWT', () => {
  it('builds an RS256 JWT with the right header/claims and a valid signature', async () => {
    const jwt = await signServiceAccountJwt(parseServiceAccount(saJson()), 1_700_000_000);
    const [h, c, sig] = jwt.split('.');
    expect(decodeJson(h!)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid123' });
    expect(decodeJson(c!)).toEqual({
      iss: 'bot@proj-a.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64urlDecode(sig!), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it('accepts a private key with escaped \\n and rejects a broken PEM', async () => {
    const escaped = parseServiceAccount(saJson({ private_key: pem.replace(/\n/g, '\\n') }));
    await expect(signServiceAccountJwt(escaped, 1)).resolves.toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    await expect(signServiceAccountJwt(parseServiceAccount(saJson({ private_key: 'nope' })), 1)).rejects.toThrow(/PEM/);
  });
});

describe('urls', () => {
  it('express mode uses the global publisher path', () => {
    expect(vertexGenerateUrl(profile())).toBe('https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent');
  });

  it('service account: global vs regional host, project override', () => {
    expect(vertexGenerateUrl(saProfile())).toBe(
      'https://aiplatform.googleapis.com/v1/projects/proj-a/locations/global/publishers/google/models/gemini-2.5-flash:generateContent',
    );
    expect(vertexGenerateUrl(saProfile({ location: 'us-central1', projectId: 'other-proj' }, { model: 'publishers/google/models/gemini-2.5-pro' }))).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/other-proj/locations/us-central1/publishers/google/models/gemini-2.5-pro:generateContent',
    );
  });

  it('rejects bad locations and missing project', () => {
    expect(() => vertexGenerateUrl(saProfile({ location: 'evil.com/x' }))).toThrow(/리전/);
    expect(() => vertexGenerateUrl(saProfile({ location: 'us' }))).toThrow(/멀티 리전/);
    expect(() => vertexGenerateUrl(profile({ apiKey: saJson({ project_id: undefined }), vertex: { auth: 'serviceAccount' } }))).toThrow(/프로젝트 ID/);
  });
});

describe('chatComplete (vertex)', () => {
  it('apiKey: x-goog-api-key header and gemini body', async () => {
    queue(geminiReply('hello'));
    const r = await chatComplete(profile({ maxTokens: 100 }), msgs, { json: true });
    expect(r.text).toBe('hello');
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe('https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent');
    expect(c.headers.get('x-goog-api-key')).toBe('AQ.express-key');
    expect(c.headers.get('authorization')).toBeNull();
    const body = JSON.parse(c.init.body as string) as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 100, responseMimeType: 'application/json' });
  });

  it('serviceAccount: token exchange then Bearer generate on the regional host', async () => {
    queue(tokenReply('ya29.A'), geminiReply());
    await chatComplete(saProfile({ location: 'europe-west4' }), msgs);
    expect(calls).toHaveLength(2);
    const [tok, gen] = calls;
    expect(tok!.url).toBe('https://oauth2.googleapis.com/token');
    expect(tok!.init.method).toBe('POST');
    expect(tok!.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(tok!.init.body as string);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = form.get('assertion')!;
    expect(decodeJson(assertion.split('.')[1]!).iss).toBe('bot@proj-a.iam.gserviceaccount.com');
    expect(gen!.url).toBe(
      'https://europe-west4-aiplatform.googleapis.com/v1/projects/proj-a/locations/europe-west4/publishers/google/models/gemini-2.5-flash:generateContent',
    );
    expect(gen!.headers.get('authorization')).toBe('Bearer ya29.A');
    expect(gen!.headers.get('x-goog-api-key')).toBeNull();
  });

  it('caches the token until 5 minutes before expiry, per profile and key', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    queue(tokenReply('ya29.A', 3600), geminiReply(), geminiReply());
    await chatComplete(saProfile(), msgs);
    vi.setSystemTime(new Date('2026-01-01T00:54:00Z'));
    await chatComplete(saProfile(), msgs);
    expect(calls.map((c) => c.url.includes('oauth2'))).toEqual([true, false, false]);

    // 만료 5분 전을 넘기면 새로 받는다
    vi.setSystemTime(new Date('2026-01-01T00:56:00Z'));
    queue(tokenReply('ya29.B'), geminiReply());
    await chatComplete(saProfile(), msgs);
    expect(calls[3]!.url).toContain('oauth2');
    expect(calls[4]!.headers.get('authorization')).toBe('Bearer ya29.B');

    // 다른 프로필은 따로
    queue(tokenReply('ya29.C'), geminiReply());
    await chatComplete(saProfile({}, { id: 'v2' }), msgs);
    expect(calls[6]!.headers.get('authorization')).toBe('Bearer ya29.C');
  });

  it('shares one token request between concurrent calls', async () => {
    queue(tokenReply('ya29.A'), geminiReply(), geminiReply());
    await Promise.all([chatComplete(saProfile(), msgs), chatComplete(saProfile(), msgs)]);
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
  });

  it('refreshes the token once on a 401 from generate', async () => {
    queue(tokenReply('ya29.old'), json({ error: { code: 401 } }, 401), tokenReply('ya29.new'), geminiReply('ok'));
    const r = await chatComplete(saProfile(), msgs);
    expect(r.text).toBe('ok');
    expect(calls[3]!.headers.get('authorization')).toBe('Bearer ya29.new');
  });

  it('relay: token and generate both go through /api/relay', async () => {
    queue(tokenReply(), geminiReply());
    await chatComplete(saProfile({}, { useRelay: true }), msgs);
    expect(calls.map((c) => c.url)).toEqual(['/api/relay', '/api/relay']);
    expect(calls[0]!.headers.get('X-Relay-Target')).toBe('https://oauth2.googleapis.com/token');
    expect(calls[1]!.headers.get('X-Relay-Target')).toMatch(/^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/proj-a\//);
  });

  it('malformed JSON fails before any request', async () => {
    await expect(chatComplete(profile({ apiKey: '{oops', vertex: { auth: 'serviceAccount' } }), msgs)).rejects.toThrow(/올바른 JSON이 아닙니다/);
    expect(calls).toHaveLength(0);
  });
});

describe('errors and connection test', () => {
  it('token 403 → role/API hint', async () => {
    queue(json({ error: 'unauthorized_client', error_description: 'nope' }, 403));
    const err = await chatComplete(saProfile(), msgs).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VertexAuthError);
    expect((err as VertexAuthError).stage).toBe('token');
    expect(describeTextError(err)).toMatch(/Vertex AI User/);
  });

  it('token invalid_grant → key/clock hint', async () => {
    queue(json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400));
    await expect(chatComplete(saProfile(), msgs)).rejects.toThrow(/invalid_grant.*시계/);
  });

  it('generate 403 → Vertex AI User / API enabled hint; SERVICE_DISABLED → enable hint', async () => {
    const p = saProfile();
    queue(tokenReply(), json({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403));
    const e1 = await chatComplete(p, msgs).catch((e: unknown) => e);
    expect(describeTextError(e1, p)).toMatch(/Vertex AI User.*Vertex AI API/);
    queue(json({ error: { code: 403, details: [{ reason: 'SERVICE_DISABLED' }] } }, 403));
    const e2 = await chatComplete(p, msgs).catch((e: unknown) => e);
    expect(describeTextError(e2, p)).toMatch(/Vertex AI API가 꺼져/);
  });

  it('apiKey 401 → express key hint', async () => {
    const p = profile();
    queue(json({ error: { code: 401, message: 'API key not valid.' } }, 401));
    const e = await chatComplete(p, msgs).catch((x: unknown) => x);
    expect(describeTextError(e, p)).toMatch(/express mode/);
  });

  it('testTextConnection distinguishes token failure from generate failure', async () => {
    queue(json({ error: 'invalid_grant' }, 400));
    const t1 = await testTextConnection(saProfile());
    expect(t1.ok).toBe(false);
    expect(t1.message).toMatch(/^서비스 계정 인증\(토큰 발급\) 실패/);

    clearVertexTokenCache();
    queue(tokenReply(), json({ error: { code: 404 } }, 404));
    const t2 = await testTextConnection(saProfile());
    expect(t2.ok).toBe(false);
    expect(t2.message).toMatch(/^인증\(토큰 발급\)은 성공했지만 생성 요청이 실패했습니다: .*404/);

    queue(geminiReply('ok'));
    const t3 = await testTextConnection(saProfile());
    expect(t3.ok).toBe(true);
    expect(calls.at(-1)!.url).toContain(':generateContent'); // 캐시된 토큰을 재사용

    queue(geminiReply('ok'));
    expect((await testTextConnection(profile())).ok).toBe(true);
  });
});

describe('listModels (vertex)', () => {
  it('apiKey: curated list without network', async () => {
    expect(await listModels(profile())).toEqual([...VERTEX_CURATED_MODELS]);
    expect(calls).toHaveLength(0);
  });

  it('serviceAccount: publisher models list filtered to text gemini models', async () => {
    queue(
      tokenReply(),
      json({
        publisherModels: [
          { name: 'publishers/google/models/gemini-2.5-pro' },
          { name: 'publishers/google/models/gemini-2.5-flash' },
          { name: 'publishers/google/models/text-embedding-005' },
          { name: 'publishers/google/models/gemini-2.5-flash-image' },
          { name: 'publishers/google/models/imagen-4.0-generate-001' },
        ],
      }),
    );
    expect(await listModels(saProfile({ location: 'us-central1' }))).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(calls[1]!.url).toBe('https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=300');
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer ya29.tok');
  });

  it('serviceAccount: falls back to the curated list on failure', async () => {
    queue(tokenReply(), json({ error: {} }, 403));
    expect(await listModels(saProfile())).toEqual([...VERTEX_CURATED_MODELS]);
    expect(parseVertexModelList({})).toEqual([]);
  });
});
