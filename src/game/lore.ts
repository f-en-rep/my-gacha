// 기록(사건·인물·물건) 읽고 쓰기. 챕터 마무리가 자동으로 합쳐 넣고, 기록 패널에서 직접 고친다.
import { z } from 'zod';
import { db } from '../db';
import { newId, now } from '../core/id';
import { useLiveQuery } from '../ui/hooks';
import { normTag } from '../gen/world/tags';
import type { Character, Id, LoreEntry, LoreKind } from '../types';

export const LORE_KINDS: LoreKind[] = ['event', 'person', 'item'];
export const LORE_LIMITS = { name: 60, summary: 400 } as const;

/** 이름 비교용 (대소문자·공백·문장부호 무시) */
export const loreKey = (name: string) => normTag(name);

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s*\n+\s*/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/** 챕터 마무리가 돌려준 기록 한 줄 */
export interface LoreDraft {
  kind: LoreKind;
  name: string;
  summary: string;
}

export interface MergeContext {
  worldId: Id;
  chapterId?: Id;
  chapterIndex?: number;
  cast: Pick<Character, 'id' | 'name'>[];
  at?: string;
}

/** 이름 뒤에 붙는 호칭. "아린 씨"도 캐스트 아린이다 ("아린의 어머니"는 다른 사람) */
const HONORIFIC = /^(씨|님|양|군|선배|후배|언니|누나|오빠|형|대장|선생|선생님|san|chan|kun|sama|さん|ちゃん|くん|様|先輩)$/;

/** 캐스트 이름인지 (인물 기록으로 만들지 않는다) */
export function isCastName(name: string, cast: Pick<Character, 'name'>[]): boolean {
  const k = loreKey(name);
  if (!k) return false;
  return cast.some((c) => {
    const ck = loreKey(c.name);
    if (!ck) return false;
    if (ck === k) return true;
    // 이름 앞이나 뒤에 호칭만 붙은 것 (영어 이름은 성·이름 중 하나만 써도 같은 사람: "Arin Vale" ↔ "Arin")
    if (k.startsWith(ck) && HONORIFIC.test(k.slice(ck.length))) return true;
    const words = c.name.trim().split(/\s+/).map(loreKey).filter((w) => w.length >= 3);
    return words.length > 1 && words.includes(k);
  });
}

/** 글에 이름이 나오는 캐스트 */
function castIn(text: string, cast: Pick<Character, 'id' | 'name'>[]): Id[] {
  return cast.filter((c) => c.name.trim().length >= 2 && text.includes(c.name.trim())).map((c) => c.id);
}

/**
 * 새 기록을 지금 기록에 합친다 (순수 함수). 같은 종류·같은 이름이면 설명을 새로 고치고, 없으면 새로 만든다.
 * 직접 적은 기록(manual)의 글은 덮어쓰지 않는다. 캐스트 이름은 인물로 넣지 않는다.
 * 바뀌거나 새로 생긴 기록만 돌려준다.
 */
export function mergeLore(existing: LoreEntry[], drafts: LoreDraft[], ctx: MergeContext): LoreEntry[] {
  const t = ctx.at ?? now();
  const byKey = new Map(existing.map((e) => [`${e.kind}:${loreKey(e.name)}`, e]));
  const out = new Map<string, LoreEntry>();
  for (const d of drafts) {
    const name = clip(d.name, LORE_LIMITS.name);
    const summary = clip(d.summary, LORE_LIMITS.summary);
    if (!name || !loreKey(name)) continue;
    if (d.kind === 'person' && isCastName(name, ctx.cast)) continue;
    const key = `${d.kind}:${loreKey(name)}`;
    const castIds = castIn(`${name} ${summary}`, ctx.cast);
    const have = out.get(key) ?? byKey.get(key);
    if (have) {
      if (have.source === 'manual') continue;
      if (!summary || summary === have.summary) continue;
      const ids = [...new Set([...(have.castIds ?? []), ...castIds])];
      out.set(key, { ...have, summary, ...(ids.length && { castIds: ids }), updatedAt: t });
      continue;
    }
    out.set(key, {
      id: newId('lore_'),
      worldId: ctx.worldId,
      kind: d.kind,
      name,
      summary,
      ...(ctx.chapterId && { chapterId: ctx.chapterId }),
      ...(ctx.chapterIndex !== undefined && { chapterIndex: ctx.chapterIndex }),
      ...(castIds.length && { castIds }),
      source: 'story',
      createdAt: t,
      updatedAt: t,
    });
  }
  return [...out.values()];
}

export async function loreOf(worldId: Id): Promise<LoreEntry[]> {
  return db.lore.where('worldId').equals(worldId).toArray();
}

/** 최신순 (챕터 번호 큰 것 먼저, 같은 챕터면 고친 시각 순) */
export function sortLore(list: LoreEntry[]): LoreEntry[] {
  return [...list].sort((a, b) => (b.chapterIndex ?? Infinity) - (a.chapterIndex ?? Infinity) || b.updatedAt.localeCompare(a.updatedAt));
}

export function useLore(worldId: Id | undefined): LoreEntry[] | undefined {
  return useLiveQuery(async () => (worldId ? sortLore(await loreOf(worldId)) : []), [worldId]);
}

export const loreInputSchema = z.object({
  name: z.string().trim().min(1, '이름을 적어 주세요.').max(LORE_LIMITS.name, `이름은 ${LORE_LIMITS.name}자까지예요.`),
  summary: z.string().trim().max(LORE_LIMITS.summary, `설명은 ${LORE_LIMITS.summary}자까지예요.`),
});

/** 직접 적은 기록 저장. 새 기록이면 id 없이. 저장한 id */
export async function saveLore(worldId: Id, kind: LoreKind, input: { name: string; summary: string }, id?: Id): Promise<Id> {
  const v = loreInputSchema.parse(input);
  const t = now();
  if (id) {
    const cur = await db.lore.get(id);
    if (!cur) throw new Error('기록을 찾을 수 없습니다.');
    // 직접 고친 기록은 이제 자동으로 덮어쓰지 않는다
    await db.lore.put({ ...cur, name: v.name, summary: v.summary, source: 'manual', updatedAt: t });
    return id;
  }
  const e: LoreEntry = { id: newId('lore_'), worldId, kind, name: v.name, summary: v.summary, source: 'manual', createdAt: t, updatedAt: t };
  await db.lore.add(e);
  return e.id;
}

export async function deleteLore(id: Id): Promise<void> {
  await db.lore.delete(id);
}

const KNOWN = { person: 20, item: 15, chars: 100 } as const;

/** 장면·계획 프롬프트에 넣는 알려진 인물·물건 (짧게, 개수 제한). 없으면 빈 글 */
export function formatKnownLore(list: LoreEntry[]): string {
  const recent = sortLore(list);
  const lines: string[] = [];
  for (const kind of ['person', 'item'] as const) {
    const items = recent.filter((e) => e.kind === kind).slice(0, KNOWN[kind]);
    if (!items.length) continue;
    lines.push(`${kind === 'person' ? 'People' : 'Items'}:`);
    for (const e of items) lines.push(`- ${e.name}${e.summary ? `: ${clip(e.summary, KNOWN.chars)}` : ''}`);
  }
  return lines.join('\n');
}
