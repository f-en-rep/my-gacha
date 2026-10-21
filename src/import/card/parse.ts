// 캐릭터 카드 읽기 (SillyTavern / RisuAI). PNG(ccv3·chara), JSON(V1·V2·V3), .charx(zip).
// 순수 함수: DB도 화면도 모른다.
import { strFromU8, unzipSync } from 'fflate';
import { isPng, readPngText } from './png';
import { cleanCardText } from './text';

export interface ParsedCard {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  alternateGreetings: string[];
  mesExample: string;
  creatorNotes: string;
  systemPrompt: string;
  tags: string[];
  creator: string;
  /** 카드 그림 (PNG 카드면 그 PNG, charx면 대표 아이콘) */
  image?: Blob;
  /** chara_card_v1 / chara_card_v2 / chara_card_v3 */
  spec: string;
}

/** 읽기 실패. message는 화면에 그대로 보여 줄 한국어 */
export class CardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardError';
  }
}

export const MAX_CARD_BYTES = 50 * 1024 * 1024;
const MAX_CHARX_UNPACKED = 200 * 1024 * 1024;

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** V2·V3는 data 안에, V1은 바깥에 */
function cardData(raw: unknown): { data: Obj; spec: string } {
  if (!isObj(raw)) throw new CardError('캐릭터 카드 JSON이 아닙니다.');
  const spec = str(raw.spec);
  if ((spec === 'chara_card_v2' || spec === 'chara_card_v3') && isObj(raw.data)) return { data: raw.data, spec };
  if (isObj(raw.data) && typeof raw.data.name === 'string') return { data: raw.data, spec: spec || 'chara_card_v2' };
  if (typeof raw.name === 'string' || typeof raw.char_name === 'string') return { data: raw, spec: 'chara_card_v1' };
  throw new CardError('캐릭터 카드 JSON이 아닙니다 (이름이 없습니다).');
}

/** 카드 JSON → ParsedCard (그림 없음) */
export function parseCardJson(raw: unknown): ParsedCard {
  const { data, spec } = cardData(raw);
  const realName = (str(data.name) || str(data.char_name)).trim();
  if (!realName) throw new CardError('카드에 캐릭터 이름이 없습니다.');
  // V3: nickname이 있으면 {{char}}는 nickname
  const callName = str(data.nickname).trim() || realName;
  const clean = (v: unknown) => cleanCardText(v, callName);
  return {
    name: realName.replace(/\s+/g, ' ').slice(0, 100),
    description: clean(data.description ?? data.char_persona),
    personality: clean(data.personality),
    scenario: clean(data.scenario ?? data.world_scenario),
    firstMes: clean(data.first_mes ?? data.char_greeting),
    alternateGreetings: strList(data.alternate_greetings).map(clean).filter(Boolean),
    mesExample: clean(data.mes_example ?? data.example_dialogue),
    creatorNotes: clean(data.creator_notes ?? data.creatorcomment),
    systemPrompt: clean(data.system_prompt),
    tags: strList(data.tags).map((t) => t.trim()).filter(Boolean),
    creator: str(data.creator).trim(),
    spec,
  };
}

function decodeBase64Json(s: string): unknown {
  const bin = atob(s.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

function parseText(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new CardError('JSON을 읽을 수 없습니다.');
  }
}

/** PNG 카드: ccv3 먼저, 없으면 chara */
export function parsePngCard(bytes: Uint8Array): ParsedCard {
  let chunks: Record<string, string>;
  try {
    chunks = readPngText(bytes);
  } catch {
    throw new CardError('PNG 파일을 읽을 수 없습니다.');
  }
  const keys = Object.keys(chunks);
  const pick = (k: string) => keys.find((x) => x.toLowerCase() === k);
  let lastError: unknown;
  for (const key of ['ccv3', 'chara']) {
    const found = pick(key);
    if (!found) continue;
    try {
      const card = parseCardJson(decodeBase64Json(chunks[found]!));
      return { ...card, image: new Blob([bytes.slice()], { type: 'image/png' }) };
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError instanceof CardError) throw lastError;
  if (lastError) throw new CardError('PNG 안의 카드 정보를 읽을 수 없습니다.');
  throw new CardError('캐릭터 카드 정보가 없는 PNG입니다.');
}

/** .charx: card.json + 대표 아이콘 */
export function parseCharx(bytes: Uint8Array): ParsedCard {
  let files: Record<string, Uint8Array>;
  let total = 0;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_CHARX_UNPACKED) throw new CardError('charx를 풀면 너무 큽니다.');
        return !f.name.endsWith('/');
      },
    });
  } catch (e) {
    if (e instanceof CardError) throw e;
    throw new CardError('charx(zip) 파일을 열 수 없습니다.');
  }
  const cardFile = files['card.json'] ?? Object.entries(files).find(([n]) => n.toLowerCase().endsWith('/card.json') || n.toLowerCase() === 'card.json')?.[1];
  if (!cardFile) throw new CardError('charx 안에 card.json이 없습니다.');
  const raw = parseText(strFromU8(cardFile));
  const card = parseCardJson(raw);
  const image = charxIcon(raw, files);
  return image ? { ...card, image } : card;
}

function charxIcon(raw: unknown, files: Record<string, Uint8Array>): Blob | undefined {
  const data = isObj(raw) && isObj(raw.data) ? raw.data : undefined;
  const assets = Array.isArray(data?.assets) ? data.assets.filter(isObj) : [];
  const icons = assets.filter((a) => a.type === 'icon');
  const main = icons.find((a) => a.name === 'main') ?? icons[0];
  const candidates = main ? [main, ...icons.filter((a) => a !== main)] : [];
  for (const a of candidates) {
    const uri = str(a.uri);
    const m = /^embed(?:d)?ed:\/\/(.+)$/i.exec(uri);
    if (!m) continue;
    const path = m[1]!.replace(/^\/+/, '');
    const bytes = files[path];
    if (!bytes) continue;
    const ext = (str(a.ext) || path.split('.').pop() || '').toLowerCase();
    const mime = MIME[ext] ?? (isPng(bytes) ? 'image/png' : undefined);
    if (!mime) continue;
    return new Blob([bytes.slice()], { type: mime });
  }
  return undefined;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 파일 내용으로 종류를 가려 읽는다 (이름은 확장자 참고용) */
export function parseCardBytes(fileName: string, bytes: Uint8Array): ParsedCard {
  if (bytes.length > MAX_CARD_BYTES) throw new CardError(`파일이 너무 큽니다 (최대 ${MAX_CARD_BYTES / 1024 / 1024}MB).`);
  if (isPng(bytes)) return parsePngCard(bytes);
  if (isZip(bytes)) return parseCharx(bytes);
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json') || bytes[0] === 0x7b || (bytes[0] === 0xef && bytes[3] === 0x7b)) {
    return parseCardJson(parseText(new TextDecoder('utf-8').decode(bytes)));
  }
  throw new CardError('지원하지 않는 파일입니다. PNG, JSON, charx 카드를 골라 주세요.');
}

/** 브라우저 File 읽기 */
export async function readCardFile(file: File): Promise<ParsedCard> {
  if (file.size > MAX_CARD_BYTES) throw new CardError(`파일이 너무 큽니다 (최대 ${MAX_CARD_BYTES / 1024 / 1024}MB).`);
  return parseCardBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}
