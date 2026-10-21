// 캐릭터 직접 고치기·만들기·지우기. 화면(CharacterEditor, CardImport)은 여기를 거친다.
import { z } from 'zod';
import { db } from '../db';
import { newId, now } from '../core/id';
import { toWebp } from '../gen/image';
import { computeStats, guessArchetype, positionIndex, traitForRarity, type Archetype } from '../gen/world';
import { readPngSize } from '../import/card';
import type { Asset, Character, CharacterTags, CombatStats, Id, Rarity, TagCatalog } from '../types';

/** 6★·5★는 자세한 시트, 4★·3★는 짧은 시트 */
export function detailFor(rarity: Rarity): Character['detail'] {
  return rarity >= 5 ? 'full' : 'light';
}

/** 능력치: 희귀도 × 전투 유형(역할에서 짐작) × 위치. 월드 생성과 같은 계산 */
export function statsFor(id: Id, rarity: Rarity, tags: Pick<CharacterTags, 'position' | 'role'>, catalog: TagCatalog, archetype?: Archetype): CombatStats {
  return computeStats(id, rarity, archetype ?? guessArchetype(tags.role), positionIndex(catalog, tags.position) === 0);
}

/** 희귀도가 바뀌면 희귀도에 묶인 특징 태그도 바꾼다 (다른 특징은 그대로) */
export function swapRarityTrait(trait: string[], catalog: TagCatalog, from: Rarity, to: Rarity): string[] {
  const old = traitForRarity(catalog, from);
  const next = traitForRarity(catalog, to);
  if (!next || old === next) return trait;
  const rest = trait.filter((t) => t !== old && t !== next);
  return trait.includes(old ?? '') || trait.length === 0 ? [next, ...rest] : trait;
}

// ── 폼 검사 ──

/** 팩 검사(pack/schemas)와 같은 한도 */
export const FIELD_LIMITS = { name: 100, text: 20000, tags: 4000, quote: 2000, quotes: 30 } as const;

export const RARITIES: readonly Rarity[] = [6, 5, 4, 3];

export interface CharacterForm {
  name: string;
  rarity: Rarity;
  tags: CharacterTags;
  appearance: string;
  imageTags: string;
  imageNegative: string;
  personality: string;
  background: string;
  quotes: string[];
}

const trimmed = (max: number, label: string) => z.string().trim().max(max, `${label}은(는) ${max.toLocaleString('ko-KR')}자까지 쓸 수 있습니다.`);

/** 폼 검사 (월드 태그 목록 안에서만). 오류 문구는 한국어 */
export function characterFormSchema(catalog: TagCatalog) {
  const inList = (list: string[], label: string) => z.string().refine((v) => list.includes(v), `${label}을(를) 목록에서 골라 주세요.`);
  return z.object({
    name: trimmed(FIELD_LIMITS.name, '이름').min(1, '이름을 입력해 주세요.'),
    rarity: z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(6)], { errorMap: () => ({ message: '희귀도를 골라 주세요.' }) }),
    tags: z.object({
      position: inList(catalog.position, '위치'),
      role: z.array(inList(catalog.role, '역할')).min(1, '역할을 하나 이상 골라 주세요.').max(3, '역할은 세 개까지 고를 수 있습니다.'),
      element: inList(catalog.element, '속성'),
      trait: z.array(inList(catalog.trait, '특징')).max(4),
    }),
    appearance: trimmed(FIELD_LIMITS.text, '외형'),
    imageTags: trimmed(FIELD_LIMITS.tags, '그림 태그').refine((v) => !/[^\x20-\x7e]/.test(v), '그림 태그는 영어(ASCII)로만 써 주세요.'),
    imageNegative: trimmed(FIELD_LIMITS.tags, '네거티브 태그'),
    personality: trimmed(FIELD_LIMITS.text, '성격'),
    background: trimmed(FIELD_LIMITS.text, '배경'),
    quotes: z
      .array(trimmed(FIELD_LIMITS.quote, '대사'))
      .transform((list) => list.filter(Boolean))
      .pipe(z.array(z.string()).max(FIELD_LIMITS.quotes, `대사는 ${FIELD_LIMITS.quotes}줄까지 넣을 수 있습니다.`)),
  });
}

/** 검사 결과: 성공이면 정리된 값, 실패면 "칸 경로 → 문구" */
export function validateCharacterForm(form: CharacterForm, catalog: TagCatalog): { ok: true; value: CharacterForm } | { ok: false; errors: Record<string, string> } {
  const r = characterFormSchema(catalog).safeParse(form);
  if (r.success) return { ok: true, value: r.data };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const key = i.path.join('.');
    errors[key] ??= i.message;
  }
  return { ok: false, errors };
}

export function formOf(c: Character): CharacterForm {
  return {
    name: c.name,
    rarity: c.rarity,
    tags: { position: c.tags.position, role: [...c.tags.role], element: c.tags.element, trait: [...c.tags.trait] },
    appearance: c.appearance,
    imageTags: c.imageTags,
    imageNegative: c.imageNegative ?? '',
    personality: c.personality,
    background: c.background,
    quotes: [...c.quotes],
  };
}

export function blankForm(catalog: TagCatalog, rarity: Rarity = 4): CharacterForm {
  const trait = traitForRarity(catalog, rarity);
  return {
    name: '',
    rarity,
    tags: { position: catalog.position[0] ?? '', role: [], element: '', trait: trait ? [trait] : [] },
    appearance: '',
    imageTags: '',
    imageNegative: '',
    personality: '',
    background: '',
    quotes: [''],
  };
}

/**
 * 검사를 통과한 폼 → 저장할 캐릭터. 원래 캐릭터(orig)가 있으면 고치기.
 * 희귀도·위치·역할이 바뀌었을 때만 능력치를 다시 계산한다 (안 바뀌면 처음 값 유지).
 */
export function characterFromForm(f: CharacterForm, worldId: Id, catalog: TagCatalog, orig?: Character): Character {
  const t = now();
  const id = orig?.id ?? newId('char_');
  const changed =
    !orig ||
    !orig.stats ||
    orig.rarity !== f.rarity ||
    orig.tags.position !== f.tags.position ||
    orig.tags.role.join('\u0000') !== f.tags.role.join('\u0000');
  const next: Character = {
    ...orig,
    id,
    worldId,
    name: f.name,
    rarity: f.rarity,
    tags: f.tags,
    appearance: f.appearance,
    imageTags: f.imageTags,
    personality: f.personality,
    background: f.background,
    quotes: f.quotes,
    stats: changed ? statsFor(id, f.rarity, f.tags, catalog) : orig!.stats,
    detail: detailFor(f.rarity),
    createdAt: orig?.createdAt ?? t,
    updatedAt: t,
  };
  if (f.imageNegative) next.imageNegative = f.imageNegative;
  else delete next.imageNegative;
  return next;
}

// ── 그림 ──

async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const b = await createImageBitmap(blob);
      const size = { width: b.width, height: b.height };
      b.close();
      return size;
    } catch {
      // 아래로
    }
  }
  if (blob.type === 'image/png') return readPngSize(new Uint8Array(await blob.arrayBuffer())) ?? { width: 0, height: 0 };
  return { width: 0, height: 0 };
}

const IMAGE_MIMES = ['image/webp', 'image/png', 'image/jpeg'];

/** 올린 그림 → WebP로 줄인 Asset (아직 저장하지 않음). 초상화와 같은 방식 */
export async function imageToAsset(worldId: Id, blob: Blob): Promise<Asset> {
  const size = await imageSize(blob);
  const out = await toWebp(blob);
  if (!IMAGE_MIMES.includes(out.type)) throw new Error('이 그림 형식은 저장할 수 없습니다. PNG, JPEG, WebP 그림을 골라 주세요.');
  return { id: newId('asset_'), worldId, mime: out.type, blob: out, width: size.width, height: size.height, provider: 'upload', createdAt: now() };
}

/**
 * 캐릭터 저장. portrait: 새 그림 Asset이면 바꿔 끼우고, null이면 초상화를 지운다 (희귀도 카드로), undefined면 그대로.
 * 바꾸거나 지운 옛 그림은 함께 지운다.
 */
export async function saveCharacter(c: Character, portrait?: Asset | null): Promise<Id> {
  await db.transaction('rw', db.characters, db.assets, db.worlds, async () => {
    const prev = await db.characters.get(c.id);
    const next: Character = { ...c, updatedAt: now() };
    if (portrait) next.portraitId = portrait.id;
    else if (portrait === null) delete next.portraitId;
    else if (prev) {
      // 그림은 저장하는 동안 그려졌을 수 있으니 DB 값을 따른다
      if (prev.portraitId) next.portraitId = prev.portraitId;
      else delete next.portraitId;
    }
    if (portrait) await db.assets.put({ ...portrait, worldId: c.worldId });
    if (prev?.portraitId && prev.portraitId !== next.portraitId) await db.assets.delete(prev.portraitId);
    await db.characters.put(next);
    await db.worlds.update(c.worldId, { updatedAt: now() });
  });
  return c.id;
}

/**
 * 캐릭터 지우기. 이 캐릭터를 가리키는 것도 함께 정리한다:
 * 배너 픽업·풀, 세이브의 보유·호감도·로비 캐릭터, 1:1 대화, 초상화, 챕터 등장인물, 장면의 말하는 사람(이름만 남긴다).
 * 뽑기 기록은 남긴다 (배너를 지울 때와 같이).
 */
export async function deleteCharacter(characterId: Id): Promise<void> {
  await db.transaction('rw', [db.characters, db.banners, db.saves, db.chatLines, db.assets, db.chapters, db.beats, db.worlds], async () => {
    const c = await db.characters.get(characterId);
    if (!c) return;
    const worldId = c.worldId;
    const t = now();
    const drop = (ids: Id[]) => ids.filter((x) => x !== characterId);

    for (const b of await db.banners.where('worldId').equals(worldId).toArray()) {
      const inPool = b.pool?.includes(characterId);
      if (!b.featured6.includes(characterId) && !b.featured5.includes(characterId) && !inPool) continue;
      const next = { ...b, featured6: drop(b.featured6), featured5: drop(b.featured5) };
      if (b.pool) {
        const pool = drop(b.pool);
        // 풀이 비면 없앤다 (= 월드 전체 캐스트)
        if (pool.length) next.pool = pool;
        else delete next.pool;
      }
      await db.banners.put(next);
    }

    for (const s of await db.saves.where('worldId').equals(worldId).toArray()) {
      await db.chatLines.where('[saveId+characterId]').equals([s.id, characterId]).delete();
      const hit = s.owned[characterId] || s.bonds?.[characterId] || s.featuredCharacterId === characterId;
      if (!hit) continue;
      const { [characterId]: _o, ...owned } = s.owned;
      const next = { ...s, owned, updatedAt: t };
      if (s.bonds) {
        const { [characterId]: _b, ...bonds } = s.bonds;
        next.bonds = bonds;
      }
      if (s.featuredCharacterId === characterId) delete next.featuredCharacterId;
      await db.saves.put(next);
    }

    for (const ch of await db.chapters.where('worldId').equals(worldId).toArray()) {
      if (!ch.nodes.some((n) => n.castIds.includes(characterId))) continue;
      await db.chapters.put({ ...ch, nodes: ch.nodes.map((n) => ({ ...n, castIds: drop(n.castIds) })), updatedAt: t });
    }

    for (const b of await db.beats.where('worldId').equals(worldId).toArray()) {
      if (!b.segments.some((s) => s.speakerId === characterId)) continue;
      await db.beats.put({
        ...b,
        segments: b.segments.map((s) => {
          if (s.speakerId !== characterId) return s;
          const { speakerId: _sid, ...rest } = s;
          return { ...rest, speakerName: s.speakerName || c.name };
        }),
      });
    }

    if (c.portraitId) await db.assets.delete(c.portraitId);
    await db.characters.delete(characterId);
    await db.worlds.update(worldId, { updatedAt: t });
  });
}
