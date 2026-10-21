// 월드 생성 (계약). 구현은 이 폴더 안에서 한다.
import { db, getSettings } from '../../db';
import { newId, now } from '../../core/id';
import { describeTextError, generateJson } from '../text';
import { SCHEMA_VERSION } from '../../types';
import type { Banner, Character, Id, Rarity, TextProfile, World } from '../../types';
import { characterMessages, setupMessages } from './prompts';
import { characterListSchema, setupSchema, type CharacterDraft } from './schema';
import { computeStats, guessArchetype } from './stats';
import { positionIndex, traitForRarity } from './tags';

export { computeStats, guessArchetype, ARCHETYPES, type Archetype } from './stats';
export { traitForRarity, positionIndex, TRAIT_RARITIES, DEFAULT_TRAITS, DEFAULT_POSITIONS } from './tags';

/** 사용자가 마법사에서 입력하는 것 */
export interface WorldInput {
  /** 비우면 AI가 짓는다 */
  name?: string;
  /** 예: "ko" */
  language: string;
  description: string;
  scenario: string;
  directives: string;
  /** 비우면 AI가 세계관에 맞게 정한다 (영어 태그) */
  artStyle?: string;
}

/** 시작 캐스트 구성 (설계 문서: 6★ 2 / 5★ 3 / 4★ 4 / 3★ 4) */
export const START_CAST: Record<Rarity, number> = { 6: 2, 5: 3, 4: 4, 3: 4 };

export interface GenerateOptions {
  signal?: AbortSignal;
  /** 진행 상황은 World.genProgress에도 기록되지만, 화면이 바로 받고 싶을 때 */
  onProgress?: (stage: string, done: number, total: number) => void;
}

/** 화풍을 사용자가 줬을 때 함께 쓰는 기본 네거티브 태그 */
export const DEFAULT_NEGATIVE_TAGS =
  'lowres, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, text, error, signature, watermark, username, blurry, jpeg artifacts, worst quality, low quality';

/** 6★·5★는 한 명씩, 4★·3★는 묶음 */
const SINGLE_RARITIES: Rarity[] = [6, 5];
const BATCH_RARITIES: Rarity[] = [4, 3];

/** 진행 단계 수: 설정 1 + 6★·5★ 한 명당 1 + 4★·3★ 묶음 1씩 + 배너 1 */
export const TOTAL_STEPS = 1 + SINGLE_RARITIES.reduce((n, r) => n + START_CAST[r], 0) + BATCH_RARITIES.length + 1;

export const NO_TEXT_CONNECTION_MESSAGE =
  '글 연결이 없습니다. 설정 → 연결에서 글(텍스트) 연결을 추가하고 "구조화 작업"에 지정해 주세요.';

/** 입력만 담은 월드(status: draft)를 만들고 id를 돌려준다. AI 호출 없음 */
export async function createWorldDraft(input: WorldInput): Promise<Id> {
  const t = now();
  const artStyle = input.artStyle?.trim() ?? '';
  const world: World = {
    id: newId('world_'),
    schemaVersion: SCHEMA_VERSION,
    name: input.name?.trim() ?? '',
    language: input.language.trim() || 'ko',
    description: input.description.trim(),
    scenario: input.scenario.trim(),
    directives: input.directives.trim(),
    tags: { position: [], role: [], element: [], trait: [] },
    currency: { pull: '', shop: '' },
    art: { positiveTags: artStyle, negativeTags: artStyle ? DEFAULT_NEGATIVE_TAGS : '' },
    status: 'draft',
    createdAt: t,
    updatedAt: t,
  };
  await db.worlds.add(world);
  return world.id;
}

/** settings.routing.structured 로 지정된 글 연결 */
export async function resolveStructuredProfile(): Promise<TextProfile> {
  const settings = await getSettings();
  const id = settings.routing.structured;
  const profile = id ? await db.profiles.get(id) : undefined;
  if (!profile || profile.type !== 'text') throw new Error(NO_TEXT_CONNECTION_MESSAGE);
  return profile;
}

function isSetupDone(w: World): boolean {
  return w.tags.role.length > 0 && w.tags.element.length > 0 && w.tags.position.length === 2 && !!w.currency.pull;
}

async function castOf(worldId: Id): Promise<Character[]> {
  const list = await db.characters.where('worldId').equals(worldId).toArray();
  return list.sort((a, b) => b.rarity - a.rarity || a.createdAt.localeCompare(b.createdAt));
}

function countDone(w: World, cast: Character[], bannerDone: boolean): number {
  let done = isSetupDone(w) ? 1 : 0;
  for (const r of SINGLE_RARITIES) done += Math.min(START_CAST[r], cast.filter((c) => c.rarity === r).length);
  for (const r of BATCH_RARITIES) if (cast.filter((c) => c.rarity === r).length >= START_CAST[r]) done += 1;
  return done + (bannerDone ? 1 : 0);
}

function draftToCharacter(d: CharacterDraft, world: World, rarity: Rarity, detail: 'full' | 'light'): Character {
  const id = newId('char_');
  const t = now();
  const trait = traitForRarity(world.tags, rarity);
  const archetype = d.archetype ?? guessArchetype(d.role);
  return {
    id,
    worldId: world.id,
    name: d.name,
    rarity,
    tags: { position: d.position, role: d.role, element: d.element, trait: trait ? [trait] : [] },
    appearance: d.appearance,
    imageTags: d.imageTags,
    personality: d.personality,
    background: d.background,
    quotes: d.quotes,
    stats: computeStats(id, rarity, archetype, positionIndex(world.tags, d.position) === 0),
    detail,
    createdAt: t,
    updatedAt: t,
  };
}

/**
 * 월드를 끝까지 생성한다: 세계 설정(태그 목록, 재화 이름, 화풍) → 6★·5★ 한 명씩 → 4★·3★ 묶음 → 상시 배너.
 * 이미 만들어진 부분은 건너뛰므로, 실패 후 다시 부르면 이어서 한다. 끝나면 status: ready.
 * 그림은 그리지 않는다 (처음 뽑을 때 그린다).
 */
export async function generateWorld(worldId: Id, opts: GenerateOptions = {}): Promise<void> {
  const { signal, onProgress } = opts;
  const total = TOTAL_STEPS;
  let profile: TextProfile | undefined;
  const getProfile = async () => (profile ??= await resolveStructuredProfile());

  const loadWorld = async () => {
    const w = await db.worlds.get(worldId);
    if (!w) throw new Error('월드를 찾을 수 없습니다.');
    return w;
  };

  let stage = '';
  let done = 0;
  const report = async (nextStage: string, nextDone: number) => {
    stage = nextStage;
    done = nextDone;
    await db.worlds.update(worldId, { status: 'generating', genProgress: { stage, done, total }, updatedAt: now() });
    onProgress?.(stage, done, total);
  };

  await loadWorld(); // 없는 월드면 기록 없이 바로 실패
  try {
    let world = await loadWorld();
    let cast = await castOf(worldId);
    signal?.throwIfAborted();

    // 1. 세계 설정
    if (!isSetupDone(world)) {
      await report('세계 설정 만드는 중', countDone(world, cast, false));
      const p = await getProfile();
      const askName = !world.name.trim();
      const askArt = !world.art.positiveTags.trim();
      const { value } = await generateJson(p, setupMessages(world, { askName, askArt }), setupSchema({ language: world.language, askName, askArt }), {
        signal,
        maxTokens: p.maxTokens ?? 8192,
        temperature: p.temperature ?? 0.7,
      });
      signal?.throwIfAborted();
      const t = now();
      const patch: Partial<World> = { tags: value.tags, currency: value.currency, updatedAt: t };
      if (askName && value.name) patch.name = value.name;
      if (value.art) patch.art = { positiveTags: value.art.positiveTags, negativeTags: value.art.negativeTags || DEFAULT_NEGATIVE_TAGS };
      await db.transaction('rw', db.worlds, db.banners, async () => {
        await db.worlds.update(worldId, patch);
        const existing = await db.banners.where('worldId').equals(worldId).filter((b) => b.kind === 'standard').first();
        if (existing) await db.banners.update(existing.id, { name: value.standardBannerName });
        else {
          const banner: Banner = { id: newId('banner_'), worldId, kind: 'standard', name: value.standardBannerName, featured6: [], featured5: [], createdAt: t };
          await db.banners.add(banner);
        }
      });
      world = await loadWorld();
    }

    // 2. 6★·5★ 한 명씩 (자세한 시트)
    for (const rarity of SINGLE_RARITIES) {
      for (;;) {
        const have = cast.filter((c) => c.rarity === rarity).length;
        if (have >= START_CAST[rarity]) break;
        signal?.throwIfAborted();
        await report(`${rarity}★ 캐릭터 ${have + 1}/${START_CAST[rarity]}`, countDone(world, cast, false));
        await createCharacters(world, cast, rarity, 1, 'full', have + 1);
        cast = await castOf(worldId);
        await report(stage, countDone(world, cast, false));
      }
    }

    // 3. 4★·3★ 묶음 (짧은 시트)
    for (const rarity of BATCH_RARITIES) {
      const missing = START_CAST[rarity] - cast.filter((c) => c.rarity === rarity).length;
      if (missing <= 0) continue;
      signal?.throwIfAborted();
      await report(`${rarity}★ 캐릭터 ${missing}명`, countDone(world, cast, false));
      await createCharacters(world, cast, rarity, missing, 'light');
      cast = await castOf(worldId);
      await report(stage, countDone(world, cast, false));
    }

    // 4. 상시 배너
    signal?.throwIfAborted();
    await report('상시 배너 준비하는 중', countDone(world, cast, false));
    const featured6 = cast.filter((c) => c.rarity === 6).map((c) => c.id);
    const featured5 = cast.filter((c) => c.rarity === 5).map((c) => c.id);
    await db.transaction('rw', db.worlds, db.banners, async () => {
      const existing = await db.banners.where('worldId').equals(worldId).filter((b) => b.kind === 'standard').first();
      if (existing) await db.banners.update(existing.id, { featured6, featured5 });
      else {
        const banner: Banner = {
          id: newId('banner_'),
          worldId,
          kind: 'standard',
          name: world.language.startsWith('ko') ? '상시 모집' : 'Standard Recruitment',
          featured6,
          featured5,
          createdAt: now(),
        };
        await db.banners.add(banner);
      }
      stage = '완료';
      done = total;
      await db.worlds.update(worldId, { status: 'ready', genProgress: { stage, done, total }, updatedAt: now() });
    });
    onProgress?.(stage, done, total);
  } catch (err) {
    // 사용자가 취소한 것은 실패가 아니라 멈춤: 오류 문구를 남기지 않는다
    const error = signal?.aborted ? undefined : describeTextError(err, profile);
    await db.worlds
      .update(worldId, { status: 'generating', genProgress: { stage, done, total, error }, updatedAt: now() })
      .catch(() => undefined);
    throw err;
  }

  async function createCharacters(world: World, cast: Character[], rarity: Rarity, count: number, detail: 'full' | 'light', index?: number) {
    const p = await getProfile();
    const promptOpts = index === undefined ? { rarity, count, detail } : { rarity, count, detail, index };
    const schema = characterListSchema({ catalog: world.tags, count, detail, existingNames: cast.map((c) => c.name) });
    const { value } = await generateJson(p, characterMessages(world, cast, promptOpts), schema, {
      signal,
      maxTokens: p.maxTokens ?? 8192,
      temperature: p.temperature ?? 0.9,
    });
    signal?.throwIfAborted();
    const chars = value.slice(0, count).map((d) => draftToCharacter(d, world, rarity, detail));
    await db.transaction('rw', db.characters, db.worlds, async () => {
      await db.characters.bulkAdd(chars);
      await db.worlds.update(worldId, { updatedAt: now() });
    });
  }
}
