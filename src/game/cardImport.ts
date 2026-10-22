// 캐릭터 카드(SillyTavern / RisuAI) → 이 월드의 캐릭터.
//
// - 글 연결이 있고 "AI로 정리"를 켜면: AI가 월드 언어로 외형·성격·배경·대사·태그·그림 태그·희귀도를 정리한다
// - 없거나 끄면 (또는 AI가 실패하면): 카드 글을 그대로 옮겨 담는다. 그림 태그는 비운다
// - 카드 그림은 WebP Asset으로 저장해 초상화로 쓴다 (다시 그리지 않는다)
// - 능력치는 코드로 계산 (월드 생성과 같음)
import { db } from '../db';
import { newId, now } from '../core/id';
import { neutralYou } from '../gen/chat/prompts';
import { describeTextError } from '../gen/text';
import { matchTag, sheetFromCard, traitForRarity, type CardSheet } from '../gen/world';
import { exampleLines, fillUser, type ParsedCard } from '../import/card';
import type { Asset, Character, Id, Rarity, TagCatalog, World } from '../types';
import { detailFor, imageToAsset, statsFor } from './characters';

/** 팩 검사와 같은 한도 */
const LIMIT = { text: 20000, quote: 300, ref: 4000 } as const;
const QUOTE_COUNT = 5;

export interface CardImportOptions {
  /** AI로 정리 (글 연결이 있을 때만 의미 있음) */
  ai: boolean;
  /** auto = AI 추천 (AI가 없으면 4★) */
  rarity: Rarity | 'auto';
  /** 이 세이브에 바로 보유로 넣는다 */
  ownSaveId?: Id;
  /** {{user}}를 바꿀 이름. 비우면 월드 언어의 "당신" */
  playerName?: string;
  signal?: AbortSignal;
}

export interface CardImportResult {
  characterId: Id;
  usedAi: boolean;
  /** AI 정리가 실패해서 기본 정리로 가져왔을 때의 이유 */
  aiError?: string;
}

/** 기본 희귀도 (AI 추천을 못 받을 때) */
export const DEFAULT_CARD_RARITY: Rarity = 4;

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/** {{user}}를 플레이어 이름(없으면 "당신")으로 바꾼 카드 */
export function withUser(card: ParsedCard, you: string): ParsedCard {
  const f = (s: string) => fillUser(s, you);
  return {
    ...card,
    description: f(card.description),
    personality: f(card.personality),
    scenario: f(card.scenario),
    firstMes: f(card.firstMes),
    alternateGreetings: card.alternateGreetings.map(f),
    mesExample: f(card.mesExample),
    creatorNotes: f(card.creatorNotes),
    systemPrompt: f(card.systemPrompt),
  };
}

export function playerWord(world: Pick<World, 'language'>, playerName?: string): string {
  return playerName?.trim() || neutralYou(world.language);
}

const APPEARANCE_HEAD = /^\s*(?:[#*\-•[(]\s*)*(appearance|looks?|physical(?: description)?|외모|외형|생김새|容姿|外見|外貌|外观)\s*[\]):：*]*\s*/i;
const ANY_HEAD = /^\s*(?:[#*\-•[(]\s*)*[\p{L} ]{1,24}[\]):：]\s*/u;

/** 설명에서 "외모:" 같은 칸을 찾아 꺼낸다. 없으면 빈 글 */
export function appearanceSection(description: string): string {
  const lines = description.split('\n');
  const i = lines.findIndex((l) => APPEARANCE_HEAD.test(l));
  if (i < 0) return '';
  const out = [lines[i]!.replace(APPEARANCE_HEAD, '')];
  for (const l of lines.slice(i + 1)) {
    if (!l.trim() || ANY_HEAD.test(l)) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

const QUOTED = /["“「『]([^"“”「」『』\n]{2,200})["”」』]/g;

/** 첫 인사·대사 예시에서 대사만 뽑는다 */
export function cardQuotes(card: Pick<ParsedCard, 'name' | 'firstMes' | 'alternateGreetings' | 'mesExample'>, max = QUOTE_COUNT): string[] {
  const out: string[] = [];
  const add = (q: string) => {
    const t = clip(q.replace(/\s+/g, ' '), LIMIT.quote);
    if (t && !out.includes(t)) out.push(t);
  };
  const fromText = (s: string) => {
    for (const m of s.matchAll(QUOTED)) add(m[1]!);
  };
  fromText(card.firstMes);
  for (const g of card.alternateGreetings) fromText(g);
  for (const l of exampleLines(card.mesExample, card.name)) {
    const before = out.length;
    fromText(l);
    if (out.length === before) add(l.replace(/\*[^*]*\*/g, '').trim());
  }
  // 따옴표가 하나도 없으면 첫 인사 첫 문장
  if (!out.length && card.firstMes) add(card.firstMes.replace(/\*[^*]*\*/g, '').split(/(?<=[.!?。！？])\s+|\n/).find((s) => s.trim()) ?? '');
  return out.slice(0, max);
}

/** 카드 태그 중 목록에 맞는 첫 값, 없으면 목록 첫 값 */
function firstMatch(cardTags: string[], options: string[]): string | undefined {
  for (const t of cardTags) {
    const m = matchTag(t, options);
    if (m) return m;
  }
  return options[0];
}

/** AI 없이 카드 글을 그대로 옮긴 시트 ({{user}}는 이미 바꾼 카드) */
export function fallbackSheet(card: ParsedCard, catalog: TagCatalog): CardSheet {
  const appearance = appearanceSection(card.description) || card.description;
  const role = firstMatch(card.tags, catalog.role);
  return {
    position: catalog.position[0] ?? '',
    role: role ? [role] : [],
    element: firstMatch(card.tags, catalog.element) ?? '',
    appearance: clip(appearance, LIMIT.text),
    imageTags: '',
    personality: clip(card.personality, LIMIT.text),
    background: clip(card.description || card.scenario, LIMIT.text),
    quotes: cardQuotes(card),
  };
}

/** 시트 + 카드 → 캐릭터 (저장 전) */
export function characterFromCard(card: ParsedCard, sheet: CardSheet, world: World, rarity: Rarity, fileName: string): Character {
  const id = newId('char_');
  const t = now();
  const trait = traitForRarity(world.tags, rarity);
  const tags = { position: sheet.position, role: sheet.role, element: sheet.element, trait: trait ? [trait] : [] };
  const origin: NonNullable<Character['origin']> = { kind: 'card', fileName: clip(fileName, 300), spec: card.spec };
  if (card.creator) origin.creator = clip(card.creator, 300);
  if (card.scenario) origin.scenario = clip(card.scenario, LIMIT.ref);
  if (card.firstMes) origin.greeting = clip(card.firstMes, LIMIT.ref);
  return {
    id,
    worldId: world.id,
    name: card.name,
    rarity,
    tags,
    appearance: clip(sheet.appearance, LIMIT.text),
    imageTags: sheet.imageTags,
    personality: clip(sheet.personality, LIMIT.text),
    background: clip(sheet.background, LIMIT.text),
    quotes: sheet.quotes.map((q) => clip(q, 2000)).filter(Boolean),
    stats: statsFor(id, rarity, tags, world.tags, sheet.archetype),
    detail: detailFor(rarity),
    origin,
    createdAt: t,
    updatedAt: t,
  };
}

/** 카드 하나를 가져와 월드 캐스트에 넣는다 */
export async function importCard(worldId: Id, parsed: ParsedCard, fileName: string, opts: CardImportOptions): Promise<CardImportResult> {
  const { signal } = opts;
  const world = await db.worlds.get(worldId);
  if (!world) throw new Error('월드를 찾을 수 없습니다.');
  const card = withUser(parsed, playerWord(world, opts.playerName));

  let sheet: CardSheet | undefined;
  let aiError: string | undefined;
  if (opts.ai) {
    try {
      sheet = await sheetFromCard(worldId, card, { askRarity: opts.rarity === 'auto', signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      aiError = describeTextError(e);
    }
  }
  signal?.throwIfAborted();
  const usedAi = !!sheet;
  sheet ??= fallbackSheet(card, world.tags);
  const rarity: Rarity = opts.rarity === 'auto' ? (sheet.rarity ?? DEFAULT_CARD_RARITY) : opts.rarity;

  let asset: Asset | undefined;
  if (card.image) {
    try {
      asset = await imageToAsset(worldId, card.image);
    } catch {
      asset = undefined; // 그림을 못 읽으면 희귀도 카드로
    }
  }
  const c = characterFromCard(card, sheet, world, rarity, fileName);
  if (asset) c.portraitId = asset.id;

  await db.transaction('rw', db.characters, db.assets, db.saves, db.worlds, async () => {
    if (asset) await db.assets.add(asset);
    await db.characters.add(c);
    await db.worlds.update(worldId, { updatedAt: now() });
    if (opts.ownSaveId) {
      const s = await db.saves.get(opts.ownSaveId);
      if (s && s.worldId === worldId && !s.owned[c.id]) {
        const t = now();
        await db.saves.put({ ...s, owned: { ...s.owned, [c.id]: { characterId: c.id, potential: 1, obtainedAt: t } }, updatedAt: t });
      }
    }
  });
  const result: CardImportResult = { characterId: c.id, usedAi };
  if (aiError) result.aiError = aiError;
  return result;
}
