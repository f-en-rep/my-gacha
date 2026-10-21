// 아주 작은 PNG 조각 읽기. 캐릭터 카드는 tEXt/iTXt/zTXt 안에 base64 JSON을 넣는다.
import { unzlibSync } from 'fflate';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

const utf8 = new TextDecoder('utf-8');

/** 다음 0 바이트 위치. 없으면 -1 */
function nul(bytes: Uint8Array, from: number): number {
  for (let i = from; i < bytes.length; i++) if (bytes[i] === 0) return i;
  return -1;
}

/** 글 조각 하나 풀기. 모르는 모양이면 undefined */
function readText(type: string, data: Uint8Array): [string, string] | undefined {
  const k = nul(data, 0);
  if (k <= 0) return undefined;
  const key = latin1(data.subarray(0, k));
  if (type === 'tEXt') return [key, latin1(data.subarray(k + 1))];
  if (type === 'zTXt') return [key, latin1(unzlibSync(data.subarray(k + 2)))];
  // iTXt: 키 \0 압축여부 압축방식 언어 \0 번역된키 \0 글(UTF-8)
  const compressed = data[k + 1] === 1;
  const lang = nul(data, k + 3);
  if (lang < 0) return undefined;
  const tkey = nul(data, lang + 1);
  if (tkey < 0) return undefined;
  const body = data.subarray(tkey + 1);
  return [key, utf8.decode(compressed ? unzlibSync(body) : body)];
}

/** 글 조각들을 키 → 글로. 같은 키가 여러 번 나오면 처음 것 */
export function readPngText(bytes: Uint8Array): Record<string, string> {
  if (!isPng(bytes)) throw new Error('PNG 파일이 아닙니다.');
  const out: Record<string, string> = {};
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = u32(bytes, at);
    const type = latin1(bytes.subarray(at + 4, at + 8));
    const start = at + 8;
    const end = start + len;
    if (end > bytes.length) break; // 잘린 파일: 읽은 데까지만
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      try {
        const kv = readText(type, bytes.subarray(start, end));
        if (kv && !(kv[0] in out)) out[kv[0]] = kv[1];
      } catch {
        // 망가진 조각은 건너뛴다
      }
    }
    if (type === 'IEND') break;
    at = end + 4; // CRC
  }
  return out;
}

/** IHDR의 가로·세로. PNG가 아니면 undefined */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!isPng(bytes) || bytes.length < 24) return undefined;
  return { width: u32(bytes, 16), height: u32(bytes, 20) };
}
