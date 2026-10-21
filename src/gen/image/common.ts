// 그림 서비스 공용 도우미: 시드, PNG 크기 읽기, 취소 가능한 대기, 한국어 오류 메시지.
import { ApiError } from '../../net/http';
import type { ImageProviderKind } from '../../types';

/** NovelAI·PixAI 모두 32비트 부호 없는 정수 시드를 받는다 */
export const MAX_SEED = 0xffffffff;

export function randomSeed(): number {
  return Math.floor(Math.random() * MAX_SEED);
}

export function resolveSeed(seed: number | undefined): number {
  return typeof seed === 'number' && Number.isFinite(seed) && seed >= 0 ? Math.floor(seed) % (MAX_SEED + 1) : randomSeed();
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/** PNG IHDR에서 실제 가로·세로를 읽는다. PNG가 아니면 undefined */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!isPng(bytes) || bytes.length < 24) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error ? e.name === 'AbortError' : (e as { name?: string } | null)?.name === 'AbortError';
}

export function abortError(): DOMException {
  return new DOMException('작업이 취소되었습니다.', 'AbortError');
}

/** signal로 끊을 수 있는 대기 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const PROVIDER_NAME: Record<ImageProviderKind, string> = {
  novelai: 'NovelAI',
  pixai: 'PixAI',
};

/**
 * 오류를 사용자에게 보여 줄 한국어 메시지로 바꾼다.
 * 취소(AbortError)는 그대로 다시 던질 수 있게 원래 객체를 돌려준다.
 */
export function toImageError(provider: ImageProviderKind, e: unknown, useRelay: boolean): Error {
  if (isAbortError(e)) return e as Error;
  const name = PROVIDER_NAME[provider];
  if (e instanceof ApiError) {
    const detail = e.message;
    let msg: string;
    switch (e.status) {
      case 400:
        msg = `${name}: 요청 형식이 잘못되었습니다. 모델 이름이나 크기, 추가 옵션을 확인해 주세요.`;
        break;
      case 401:
      case 403:
        msg = `${name}: API 키가 올바르지 않거나 권한이 없습니다. 설정에서 키를 확인해 주세요.`;
        break;
      case 402:
        msg =
          provider === 'novelai'
            ? `${name}: Anlas가 부족하거나 구독이 필요합니다. (Opus 구독의 무료 생성은 1024×1024 이하, 28 steps 이하에서만 적용됩니다.)`
            : `${name}: 크레딧이 부족합니다.`;
        break;
      case 409:
      case 429:
        msg = `${name}: 요청이 너무 잦습니다(동시 생성 제한). 잠시 기다렸다가 다시 시도해 주세요. 그림 요청 간격을 늘리는 것도 좋습니다.`;
        break;
      default:
        msg =
          e.status >= 500
            ? `${name}: 서버 오류(HTTP ${e.status}). 잠시 뒤 다시 시도해 주세요.`
            : `${name}: 요청 실패(HTTP ${e.status}).`;
    }
    const err = new ApiError(`${msg}\n(${detail})`, e.status);
    return err;
  }
  if (e instanceof TypeError) {
    // fetch가 응답 없이 실패: 네트워크 끊김 또는 CORS 차단
    const hint = useRelay
      ? '중계기(/api/relay)에 연결하지 못했습니다. 인터넷 연결이나 사이트 배포 상태를 확인해 주세요.'
      : '브라우저가 요청을 막았을 수 있습니다(CORS). 연결 설정에서 "중계기 사용"을 켜 보세요.';
    return new Error(`${name}: 연결 실패 — ${hint}\n(${e.message})`);
  }
  if (e instanceof Error) {
    return e.message.startsWith(`${name}:`) ? e : new Error(`${name}: ${e.message}`);
  }
  return new Error(`${name}: 알 수 없는 오류 (${String(e)})`);
}
