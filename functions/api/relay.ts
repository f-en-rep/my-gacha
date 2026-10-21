// Cloudflare Pages Functions 중계기 (계약은 src/net/http.ts 주석 참고).
//
// - X-Relay-Target 헤더의 URL로 요청을 그대로 전달하고, 응답을 상태 코드·본문·content-type 그대로 돌려준다.
// - https + 허용 목록 호스트만. 다른 사이트(Origin이 다름)에서 온 요청은 거절.
// - 키(Authorization)는 통과만 하고 저장하거나 로그로 남기지 않는다. (이 파일은 아무것도 로그하지 않음)

export const RELAY_TARGET_HEADER = 'x-relay-target';

/** 전달을 허용하는 호스트 (정확히 일치) */
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'image.novelai.net',
  'api.novelai.net',
  'api.pixai.art',
  // PixAI 그림 파일 호스트 (가정: media.urls[].url 이 이 호스트들에 있음)
  'images-ng.pixai.art',
  'images.pixai.art',
  'nano-gpt.com',
  'openrouter.ai',
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  // Google Vertex AI (global 엔드포인트, express mode) 와 서비스 계정 토큰 발급
  'aiplatform.googleapis.com',
  'oauth2.googleapis.com',
]);

/** Vertex AI 리전 엔드포인트 (예: us-central1-aiplatform.googleapis.com). 이 패턴 말고 와일드카드는 없다 */
export const VERTEX_REGIONAL_HOST = /^[a-z0-9-]+-aiplatform\.googleapis\.com$/;

export function isAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALLOWED_HOSTS.has(h) || VERTEX_REGIONAL_HOST.test(h);
}

/** 요청에서 빼는 헤더 */
const DROP_REQUEST_HEADERS = new Set([
  // hop-by-hop
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // 원래 브라우저/사이트 정보
  'host',
  'origin',
  'referer',
  'cookie',
  'content-length',
  'forwarded',
  'x-real-ip',
  'true-client-ip',
  RELAY_TARGET_HEADER,
]);
const DROP_REQUEST_PREFIXES = ['cf-', 'x-forwarded-'];

/** 응답에서 돌려줄 헤더 */
const PASS_RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'cache-control',
  'retry-after',
  'x-request-id',
  'request-id',
];
const PASS_RESPONSE_PREFIXES = ['x-ratelimit-', 'ratelimit-', 'anthropic-ratelimit-'];

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 20 * 1024 * 1024;

function textError(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** 허용된 대상이면 URL, 아니면 null */
export function parseAllowedTarget(raw: string | null): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port !== '' && url.port !== '443') return null;
  if (!isAllowedHost(url.hostname)) return null;
  return url;
}

export function filterRequestHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((value, key) => {
    const k = key.toLowerCase();
    if (DROP_REQUEST_HEADERS.has(k)) return;
    if (DROP_REQUEST_PREFIXES.some((p) => k.startsWith(p))) return;
    out.set(k, value);
  });
  return out;
}

function filterResponseHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((value, key) => {
    const k = key.toLowerCase();
    if (PASS_RESPONSE_HEADERS.includes(k) || PASS_RESPONSE_PREFIXES.some((p) => k.startsWith(p))) {
      out.set(k, value);
    }
  });
  out.set('x-relayed-by', 'my-gacha');
  return out;
}

export async function handleRelay(request: Request): Promise<Response> {
  const selfOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  if (origin && origin !== selfOrigin) {
    return textError(403, 'relay: 다른 사이트에서 온 요청은 받지 않습니다.');
  }

  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') {
    // 같은 사이트 요청만 받으므로 CORS 헤더는 주지 않는다
    return new Response(null, {
      status: 204,
      headers: { allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'cache-control': 'no-store' },
    });
  }

  let target = parseAllowedTarget(request.headers.get(RELAY_TARGET_HEADER));
  if (!target) {
    return textError(400, 'relay: X-Relay-Target이 없거나 허용되지 않은 주소입니다 (https, 허용 목록 호스트만).');
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return textError(413, 'relay: 요청 본문이 너무 큽니다.');

  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;
  if (body && body.byteLength > MAX_BODY_BYTES) return textError(413, 'relay: 요청 본문이 너무 큽니다.');

  const headers = filterRequestHeaders(request.headers);

  let upstream: Response;
  try {
    for (let hop = 0; ; hop++) {
      upstream = await fetch(target.toString(), {
        method,
        headers,
        body: body && body.byteLength > 0 ? body : undefined,
        redirect: 'manual',
      });
      const location = upstream.headers.get('location');
      const isRedirect = upstream.status >= 300 && upstream.status < 400 && location;
      // 본문 없는 요청(GET/HEAD)만 리다이렉트를 따라간다. 다음 주소도 허용 목록이어야 한다.
      if (!isRedirect || hasBody) break;
      if (hop >= MAX_REDIRECTS) return textError(502, 'relay: 리다이렉트가 너무 많습니다.');
      const next = parseAllowedTarget(new URL(location, target).toString());
      if (!next) return textError(502, 'relay: 허용되지 않은 주소로 리다이렉트되었습니다.');
      target = next;
    }
  } catch {
    return textError(502, 'relay: 대상 서버에 연결하지 못했습니다.');
  }

  const nullBody = method === 'HEAD' || [101, 204, 205, 304].includes(upstream.status);
  return new Response(nullBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: filterResponseHeaders(upstream.headers),
  });
}

export const onRequest: PagesFunction = async ({ request }) => handleRelay(request);
