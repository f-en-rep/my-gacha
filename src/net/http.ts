// 외부 API 호출은 전부 이 함수를 거친다.
// useRelay가 켜져 있으면 같은 사이트의 Cloudflare Pages Functions 중계기(/api/relay)로 보낸다.
//
// 중계기 약속 (functions/api/relay.ts가 지킨다):
//   POST/GET /api/relay
//   헤더 X-Relay-Target: 원래 보낼 전체 URL (https만, 허용 목록 호스트만)
//   나머지 헤더와 본문은 그대로 전달. 응답도 상태 코드, 본문, content-type 그대로 돌려준다.

export const RELAY_PATH = '/api/relay';
export const RELAY_TARGET_HEADER = 'X-Relay-Target';

export interface ApiFetchOptions {
  useRelay?: boolean;
}

export async function apiFetch(url: string, init: RequestInit = {}, opts: ApiFetchOptions = {}): Promise<Response> {
  if (!opts.useRelay) return fetch(url, init);
  const headers = new Headers(init.headers);
  headers.set(RELAY_TARGET_HEADER, url);
  return fetch(RELAY_PATH, { ...init, headers });
}

/** 응답이 실패면 본문 일부를 담아 에러로 던진다 */
export async function ensureOk(res: Response, label: string): Promise<Response> {
  if (res.ok) return res;
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    // 본문을 못 읽어도 상태 코드는 남긴다
  }
  throw new ApiError(`${label}: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`, res.status);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
