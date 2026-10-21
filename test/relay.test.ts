import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterRequestHeaders, onRequest, parseAllowedTarget } from '../functions/api/relay';

const SELF = 'https://my-gacha.pages.dev';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

function call(req: Request): Promise<Response> {
  // Pages 컨텍스트 중 request만 쓴다
  return (onRequest as unknown as AnyFn)({ request: req }) as Promise<Response>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseAllowedTarget', () => {
  it('allows https allowlisted hosts only', () => {
    expect(parseAllowedTarget('https://image.novelai.net/ai/generate-image')).not.toBeNull();
    expect(parseAllowedTarget('https://api.pixai.art/graphql')).not.toBeNull();
    expect(parseAllowedTarget('https://images-ng.pixai.art/images/orig/x')).not.toBeNull();
    expect(parseAllowedTarget('http://image.novelai.net/x')).toBeNull();
    expect(parseAllowedTarget('https://evil.example.com/')).toBeNull();
    expect(parseAllowedTarget('https://image.novelai.net.evil.com/')).toBeNull();
    expect(parseAllowedTarget('https://user:pw@api.openai.com/')).toBeNull();
    expect(parseAllowedTarget('https://api.openai.com:8443/')).toBeNull();
    expect(parseAllowedTarget('not a url')).toBeNull();
    expect(parseAllowedTarget(null)).toBeNull();
  });
});

describe('Vertex AI hosts', () => {
  it('allows the global, regional and oauth2 hosts', () => {
    expect(parseAllowedTarget('https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent')).not.toBeNull();
    expect(parseAllowedTarget('https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/m:generateContent')).not.toBeNull();
    expect(parseAllowedTarget('https://asia-northeast3-aiplatform.googleapis.com/v1/x')).not.toBeNull();
    expect(parseAllowedTarget('https://oauth2.googleapis.com/token')).not.toBeNull();
  });

  it('rejects anything else that merely looks similar', () => {
    for (const u of [
      'http://us-central1-aiplatform.googleapis.com/v1',
      'https://aiplatform.googleapis.com.evil.com/',
      'https://us-central1-aiplatform.googleapis.com.evil.com/',
      'https://evil.com/-aiplatform.googleapis.com',
      'https://us_central1-aiplatform.googleapis.com/',
      'https://us.central1-aiplatform.googleapis.com/',
      'https://-aiplatform.googleapis.com/',
      'https://aiplatform.us.rep.googleapis.com/',
      'https://storage.googleapis.com/',
      'https://www.googleapis.com/oauth2/v4/token',
      'https://accounts.google.com/o/oauth2/token',
      'https://us-central1-aiplatform.googleapis.com:8443/',
    ]) {
      expect(parseAllowedTarget(u), u).toBeNull();
    }
  });

  it('forwards the bearer token to a regional Vertex host', async () => {
    const upstream = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', upstream);
    const target = 'https://europe-west4-aiplatform.googleapis.com/v1/projects/p/locations/europe-west4/publishers/google/models/m:generateContent';
    const res = await call(
      new Request(`${SELF}/api/relay`, {
        method: 'POST',
        headers: { 'X-Relay-Target': target, Authorization: 'Bearer ya29.x', 'Content-Type': 'application/json', Origin: SELF },
        body: '{}',
      }),
    );
    expect(res.status).toBe(200);
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(target);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer ya29.x');
  });
});

describe('filterRequestHeaders', () => {
  it('drops hop-by-hop, host, origin, referer, cookie, cf-*, x-relay-target', () => {
    const h = new Headers({
      authorization: 'Bearer k',
      'content-type': 'application/json',
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      upgrade: 'h2c',
      host: 'my-gacha.pages.dev',
      origin: SELF,
      referer: SELF + '/x',
      cookie: 'a=b',
      'cf-connecting-ip': '1.2.3.4',
      'cf-ray': 'abc',
      'x-forwarded-for': '1.2.3.4',
      'x-relay-target': 'https://api.openai.com/v1',
      'anthropic-version': '2023-06-01',
    });
    const out = filterRequestHeaders(h);
    expect([...out.keys()].sort()).toEqual(['anthropic-version', 'authorization', 'content-type']);
  });
});

describe('onRequest', () => {
  it('forwards method, body and filtered headers, and streams the response back', async () => {
    const upstream = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response('PKzip', { status: 201, headers: { 'content-type': 'application/zip', 'set-cookie': 'x=y', 'x-ratelimit-remaining': '9' } }),
    );
    vi.stubGlobal('fetch', upstream);
    const res = await call(
      new Request(`${SELF}/api/relay`, {
        method: 'POST',
        headers: {
          'X-Relay-Target': 'https://image.novelai.net/ai/generate-image',
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
          Origin: SELF,
          Cookie: 'session=1',
        },
        body: '{"a":1}',
      }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-ratelimit-remaining')).toBe('9');
    expect(await res.text()).toBe('PKzip');

    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe('https://image.novelai.net/ai/generate-image');
    expect(init!.method).toBe('POST');
    expect(new TextDecoder().decode(init!.body as ArrayBuffer)).toBe('{"a":1}');
    const h = new Headers(init!.headers);
    expect(h.get('authorization')).toBe('Bearer secret');
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('origin')).toBeNull();
    expect(h.get('cookie')).toBeNull();
    expect(h.get('x-relay-target')).toBeNull();
  });

  it('rejects cross-origin requests', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const res = await call(
      new Request(`${SELF}/api/relay`, {
        headers: { 'X-Relay-Target': 'https://api.openai.com/v1/models', Origin: 'https://evil.example.com' },
      }),
    );
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('allows requests without an Origin header (same-origin GET)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })));
    const res = await call(new Request(`${SELF}/api/relay`, { headers: { 'X-Relay-Target': 'https://api.novelai.net/user/subscription' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('rejects non-allowlisted or missing targets', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    expect((await call(new Request(`${SELF}/api/relay`))).status).toBe(400);
    expect((await call(new Request(`${SELF}/api/relay`, { headers: { 'X-Relay-Target': 'https://example.com/' } }))).status).toBe(400);
    expect((await call(new Request(`${SELF}/api/relay`, { headers: { 'X-Relay-Target': 'http://api.openai.com/' } }))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers OPTIONS without contacting upstream', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const res = await call(new Request(`${SELF}/api/relay`, { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('follows GET redirects only to allowlisted hosts', async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://images-ng.pixai.art/b' } }))
      .mockResolvedValueOnce(new Response('img', { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', upstream);
    const ok = await call(new Request(`${SELF}/api/relay`, { headers: { 'X-Relay-Target': 'https://images-ng.pixai.art/a' } }));
    expect(ok.status).toBe(200);
    expect(upstream.mock.calls[1]![0]).toBe('https://images-ng.pixai.art/b');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/' } })));
    const bad = await call(new Request(`${SELF}/api/relay`, { headers: { 'X-Relay-Target': 'https://images-ng.pixai.art/a' } }));
    expect(bad.status).toBe(502);
  });

  it('returns 502 when upstream is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network');
      }),
    );
    const res = await call(new Request(`${SELF}/api/relay`, { headers: { 'X-Relay-Target': 'https://openrouter.ai/api/v1/models' } }));
    expect(res.status).toBe(502);
  });
});
