// 스토리 생성. 등장인물은 "내가 뽑은 캐릭터"가 아니라 월드 캐스트에서 고른다 (PLAN 2-3: 친구에게 줘도 진행과 안 꼬이게).
//
// - 챕터 계획: 구조화 연결. 장면 BEATS_PER_CHAPTER개(제목, 지시, 등장인물, 장소), 필요하면 새 장소
// - 장면 본문: 문장 연결(없으면 구조화 연결). 같은 장면은 동시에 한 번만 쓴다 (inFlight)
// - 챕터 마무리: 요약 + 장부 한 줄 + 기록(사건·인물·물건). 요약은 다음 계획과 장면 쓰기에 "지금까지의 이야기"로 들어간다
// - 기록의 인물·물건과 내 프로필(플레이 중인 세이브)은 계획·장면 쓰기에 짧게 들어간다 (비었으면 안 들어간다)
// - 뒤에서 쓰다 실패하면 알림을 남긴다 (사용자가 멈춘 것은 빼고)
import { db, getSettings } from '../../db';
import { newId, now } from '../../core/id';
import { generateJson } from '../text';
import { resolveStructuredProfile } from '../world';
import type { Beat, Chapter, Character, Id, Location, Segment, StoryNode, TextProfile } from '../../types';
import { formatKnownLore, loreOf, mergeLore, type LoreDraft } from '../../game/lore';
import { formatPlayer } from '../../game/player';
import { noticeFailure, resolveNotice } from '../../game/notices';
import { promptCtx } from '../prompts';
import { beatMessages, finishMessages, formatStorySoFar, planMessages, segmentLine } from './prompts';
import { beatSchema, finishSchema, matchName, normName, planSchema } from './schema';

export { formatStorySoFar } from './prompts';
export { splitLong, sceneryTags } from './schema';

/** 챕터 하나의 장면 수 */
export const BEATS_PER_CHAPTER = 6;

/** 한 장면에 이름 있는 인물 최대 수 */
export const MAX_CAST_PER_NODE = 3;

/** 이전 장면에서 이어 쓰기용으로 넘기는 토막 수 */
const PREVIOUS_TAIL = 8;

export interface StoryGenOptions {
  signal?: AbortSignal;
  /** 화면에 보여 줄 진행 문구 */
  onProgress?: (stage: string) => void;
}

export type BeatOptions = StoryGenOptions & { priority?: 'foreground' | 'background' };

// ---------- 연결 ----------

/** 문장 작업 연결: settings.routing.prose, 없으면 구조화 연결 */
export async function resolveProseProfile(): Promise<TextProfile> {
  const settings = await getSettings();
  const id = settings.routing.prose;
  const p = id ? await db.profiles.get(id) : undefined;
  if (p && p.type === 'text') return p;
  return resolveStructuredProfile();
}

// ---------- 공통 읽기 ----------

async function loadWorld(worldId: Id) {
  const w = await db.worlds.get(worldId);
  if (!w) throw new Error('월드를 찾을 수 없습니다.');
  return w;
}

async function loadChapter(chapterId: Id): Promise<Chapter> {
  const c = await db.chapters.get(chapterId);
  if (!c) throw new Error('챕터를 찾을 수 없습니다.');
  return c;
}

/** 월드 캐스트. 희귀도 높은 순, 같은 희귀도는 만든 순 */
async function castOf(worldId: Id): Promise<Character[]> {
  const list = await db.characters.where('worldId').equals(worldId).toArray();
  return list.sort((a, b) => b.rarity - a.rarity || a.createdAt.localeCompare(b.createdAt));
}

async function chaptersOf(worldId: Id): Promise<Chapter[]> {
  return db.chapters.where('[worldId+index]').between([worldId, 0], [worldId, Infinity]).toArray();
}

/**
 * "지금까지의 이야기": beforeIndex보다 앞 챕터들. 최근 recent개는 요약 전체, 그 전은 장부 한 줄씩.
 * 앞 챕터가 없으면 빈 문자열.
 */
export async function storySoFar(worldId: Id, beforeIndex: number, recent = 4): Promise<string> {
  const list = (await chaptersOf(worldId)).filter((c) => c.index < beforeIndex);
  return formatStorySoFar(list, recent);
}

/** 계획·장면 쓰기에 넣는 알려진 인물·물건 */
async function knownLore(worldId: Id): Promise<string> {
  return formatKnownLore(await loreOf(worldId));
}

/** 이 월드를 플레이 중인 세이브의 내 프로필 (다른 월드를 플레이 중이면 빈 글) */
async function activePlayer(worldId: Id): Promise<string> {
  const s = await getSettings();
  const save = s.activeSaveId ? await db.saves.get(s.activeSaveId) : undefined;
  return save?.worldId === worldId ? formatPlayer(save) : '';
}

function nameLookup(cast: Character[]): (s: Segment) => string {
  const byId = new Map(cast.map((c) => [c.id, c.name]));
  return (s) => (s.speakerId ? byId.get(s.speakerId) : undefined) ?? s.speakerName ?? '';
}

// ---------- 챕터 계획 ----------

/**
 * 다음 챕터를 계획해 저장하고 id를 돌려준다 (구조화 연결).
 * 앞 챕터들의 요약·장부와 작가 지시문을 읽고, 장면 BEATS_PER_CHAPTER개(제목, 지시, 등장인물, 장소)를 정한다.
 * 새 장소가 필요하면 Location을 만든다. 장면 본문은 쓰지 않는다.
 */
export async function planNextChapter(worldId: Id, opts: StoryGenOptions = {}): Promise<Id> {
  const { signal, onProgress } = opts;
  const world = await loadWorld(worldId);
  const profile = await resolveStructuredProfile();
  signal?.throwIfAborted();

  const [cast, locations, chapters] = await Promise.all([castOf(worldId), db.locations.where('worldId').equals(worldId).toArray(), chaptersOf(worldId)]);
  const chapterIndex = chapters.reduce((m, c) => Math.max(m, c.index), 0) + 1;
  onProgress?.(`${chapterIndex}장 계획 세우는 중`);

  const castNames = cast.map((c) => c.name);
  const { value } = await generateJson(
    profile,
    planMessages(
      { world, cast, locations, chapterIndex, nodeCount: BEATS_PER_CHAPTER, storySoFar: formatStorySoFar(chapters, 4), lore: await knownLore(worldId), player: await activePlayer(worldId) },
      await promptCtx('story-plan'),
    ),
    planSchema({ nodeCount: BEATS_PER_CHAPTER, castNames, locationNames: locations.map((l) => l.name), maxCastPerNode: MAX_CAST_PER_NODE }),
    { signal, maxTokens: profile.maxTokens ?? 8192, temperature: profile.temperature ?? 0.9 },
  );
  signal?.throwIfAborted();
  onProgress?.('챕터 저장하는 중');

  const idByName = new Map<string, Id>();
  for (const c of cast) if (!idByName.has(c.name)) idByName.set(c.name, c.id);

  const t = now();
  return db.transaction('rw', db.chapters, db.locations, async () => {
    // 그사이 다른 탭이 같은 번호를 만들었으면 그 뒤 번호로
    const taken = await db.chapters.where('[worldId+index]').between([worldId, 0], [worldId, Infinity]).toArray();
    const index = Math.max(chapterIndex, taken.reduce((m, c) => Math.max(m, c.index), 0) + 1);

    const current = await db.locations.where('worldId').equals(worldId).toArray();
    const byNorm = new Map(current.map((l) => [normName(l.name), l]));
    const fresh: Location[] = [];
    const locationId = (ref: (typeof value.nodes)[number]['location']): Id => {
      const key = normName(ref.name);
      const have = byNorm.get(key) ?? (ref.kind === 'existing' ? lookupLoose(ref.name, [...byNorm.values()]) : undefined);
      if (have) return have.id;
      const loc: Location = {
        id: newId('loc_'),
        worldId,
        name: ref.name,
        description: ref.kind === 'new' ? ref.description : '',
        imageTags: ref.kind === 'new' ? ref.imageTags : 'scenery',
        createdAt: t,
      };
      byNorm.set(key, loc);
      fresh.push(loc);
      return loc.id;
    };

    const nodes: StoryNode[] = value.nodes.map((n) => ({
      title: n.title,
      guide: n.guide,
      castIds: n.cast.map((name) => idByName.get(name)).filter((id): id is Id => !!id),
      locationId: locationId(n.location),
    }));
    const chapter: Chapter = {
      id: newId('chapter_'),
      worldId,
      index,
      title: value.title,
      synopsis: value.synopsis,
      nodes,
      status: 'planned',
      createdAt: t,
      updatedAt: t,
    };
    if (fresh.length) await db.locations.bulkAdd(fresh);
    await db.chapters.add(chapter);
    return chapter.id;
  });
}

function lookupLoose(name: string, list: Location[]): Location | undefined {
  const m = matchName(name, list.map((l) => l.name));
  return m === undefined ? undefined : list.find((l) => l.name === m);
}

// ---------- 장면 본문 ----------

interface Flight {
  promise: Promise<Beat>;
  controller: AbortController;
  /** signal 없이 기다리는 쪽이 있으면 (미리 쓰기 포함) 끝까지 쓴다 */
  pinned: boolean;
  /** signal을 들고 기다리는 쪽 수. 모두 취소하면 쓰기를 멈춘다 */
  waiters: number;
}

const inFlight = new Map<string, Flight>();
const flightKey = (chapterId: Id, index: number) => `${chapterId}#${index}`;

/** 지금 쓰는 중인지 (같은 탭 안에서) */
export function isWritingBeat(chapterId: Id, index: number): boolean {
  return inFlight.has(flightKey(chapterId, index));
}

async function storedBeat(chapterId: Id, index: number): Promise<Beat | undefined> {
  return db.beats.where('[chapterId+index]').equals([chapterId, index]).first();
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('요청이 취소되었습니다.', 'AbortError');
}

/** 한 호출자의 기다림. 자기 signal이 취소되면 자기만 빠진다 */
function attach(flight: Flight, signal: AbortSignal | undefined): Promise<Beat> {
  if (!signal) {
    flight.pinned = true;
    return flight.promise;
  }
  if (signal.aborted) return Promise.reject(abortReason(signal));
  flight.waiters++;
  return new Promise<Beat>((resolve, reject) => {
    const onAbort = () => {
      flight.waiters--;
      if (flight.waiters <= 0 && !flight.pinned) flight.controller.abort(abortReason(signal));
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    flight.promise.then(
      (b) => {
        signal.removeEventListener('abort', onAbort);
        resolve(b);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * 장면 본문. 이미 있으면 그대로, 없으면 써서 저장한다 (문장 연결, 없으면 구조화 연결).
 * 같은 장면을 동시에 두 번 쓰지 않는다: 뒤에서 미리 쓰는 중이면 그 결과를 함께 기다린다.
 */
export async function ensureBeat(chapterId: Id, index: number, opts: BeatOptions = {}): Promise<Beat> {
  const { signal } = opts;
  signal?.throwIfAborted();
  const key = flightKey(chapterId, index);
  const running = inFlight.get(key);
  if (running) return attach(running, signal);

  const have = await storedBeat(chapterId, index);
  if (have) return have;
  // 기다리는 사이 다른 호출이 시작했을 수 있다
  const raced = inFlight.get(key);
  if (raced) return attach(raced, signal);

  const controller = new AbortController();
  const flight: Flight = { controller, pinned: false, waiters: 0, promise: undefined as unknown as Promise<Beat> };
  const noticeKey = `story-beat:${chapterId}#${index}`;
  flight.promise = writeBeat(chapterId, index, controller.signal, opts.onProgress)
    .then(
      async (b) => {
        await resolveNotice(noticeKey);
        return b;
      },
      async (e: unknown) => {
        const ch = await db.chapters.get(chapterId).catch(() => undefined);
        await noticeFailure(
          { key: noticeKey, job: 'story-beat', title: `${ch ? `${ch.index}장 ` : ''}장면 ${index + 1}을(를) 쓰지 못했어요`, link: `/story/${encodeURIComponent(chapterId)}`, worldId: ch?.worldId },
          e,
          controller.signal,
        );
        throw e;
      },
    )
    .finally(() => {
      if (inFlight.get(key) === flight) inFlight.delete(key);
    });
  flight.promise.catch(() => undefined); // 기다리는 쪽이 모두 빠져도 처리되지 않은 거절로 남지 않게
  inFlight.set(key, flight);
  return attach(flight, signal);
}

async function writeBeat(chapterId: Id, index: number, signal: AbortSignal, onProgress?: (stage: string) => void): Promise<Beat> {
  const chapter = await loadChapter(chapterId);
  const node = chapter.nodes[index];
  if (!node) throw new Error(`장면 ${index + 1}이(가) 챕터에 없습니다.`);
  const world = await loadWorld(chapter.worldId);
  const profile = await resolveProseProfile();
  signal.throwIfAborted();
  onProgress?.(`장면 ${index + 1}/${chapter.nodes.length} 쓰는 중`);

  const cast = await castOf(world.id);
  const byId = new Map(cast.map((c) => [c.id, c]));
  const sceneCast = node.castIds.map((id) => byId.get(id)).filter((c): c is Character => !!c);
  const location = await db.locations.get(node.locationId);
  const nameOf = nameLookup(cast);

  // 이어 쓰기: 같은 챕터의 앞 장면, 첫 장면이면 앞 챕터의 마지막 장면
  let previous: Beat | undefined;
  if (index > 0) previous = await storedBeat(chapterId, index - 1);
  else {
    const prevChapter = await db.chapters.where('[worldId+index]').equals([world.id, chapter.index - 1]).first();
    if (prevChapter) {
      const beats = await db.beats.where('[chapterId+index]').between([prevChapter.id, 0], [prevChapter.id, Infinity]).toArray();
      previous = beats[beats.length - 1];
    }
  }
  const previousTail = (previous?.segments ?? []).slice(-PREVIOUS_TAIL).map((s) => segmentLine(s, nameOf));

  const { value } = await generateJson(
    profile,
    beatMessages(
      {
        world,
        chapter,
        index,
        cast: sceneCast,
        location,
        previousTail,
        storySoFar: await storySoFar(world.id, chapter.index, 2),
        lore: await knownLore(world.id),
        player: await activePlayer(world.id),
      },
      await promptCtx('story-beat'),
    ),
    beatSchema(),
    { signal, maxTokens: profile.maxTokens ?? 8192, temperature: profile.temperature ?? 0.9 },
  );
  signal.throwIfAborted();

  // 말하는 사람 → 캐스트 id. 이 장면 캐스트를 먼저, 그다음 월드 캐스트 전체
  const sceneNames = sceneCast.map((c) => c.name);
  const allNames = cast.map((c) => c.name);
  const idByName = new Map<string, Id>();
  for (const c of [...sceneCast, ...cast]) if (!idByName.has(c.name)) idByName.set(c.name, c.id);
  const segments: Segment[] = value.map((d) => {
    if (d.kind === 'narration' || !d.speaker) return { kind: 'narration', text: d.text };
    const name = matchName(d.speaker, sceneNames) ?? matchName(d.speaker, allNames);
    const id = name ? idByName.get(name) : undefined;
    return id ? { kind: d.kind, speakerId: id, speakerName: name, text: d.text } : { kind: d.kind, speakerName: d.speaker, text: d.text };
  });

  return db.transaction('rw', db.beats, async () => {
    // 다른 탭이 먼저 저장했으면 그것을 쓴다
    const have = await db.beats.where('[chapterId+index]').equals([chapterId, index]).first();
    if (have) return have;
    const beat: Beat = { id: newId('beat_'), worldId: world.id, chapterId, index, segments, createdAt: now() };
    await db.beats.add(beat);
    return beat;
  });
}

/** 다음 장면을 뒤에서 미리 써 둔다. 실패해도 조용히 넘어간다 */
export function prefetchBeat(chapterId: Id, index: number): void {
  void (async () => {
    const chapter = await db.chapters.get(chapterId);
    if (!chapter || index < 0 || index >= chapter.nodes.length) return;
    await ensureBeat(chapterId, index, { priority: 'background' });
  })().catch(() => undefined);
}

// ---------- 챕터 마무리 ----------

/** 챕터를 다 읽은 뒤: 요약과 장부 한 줄, 기록(사건·인물·물건)을 만들고 status를 complete로. 실패하면 알림 */
export async function finishChapter(chapterId: Id, opts: StoryGenOptions = {}): Promise<void> {
  const key = `story-finish:${chapterId}`;
  try {
    await doFinish(chapterId, opts);
    await resolveNotice(key);
  } catch (e) {
    const ch = await db.chapters.get(chapterId).catch(() => undefined);
    await noticeFailure(
      { key, job: 'story-finish', title: `${ch ? `${ch.index}장 ` : ''}챕터를 정리하지 못했어요 (요약·기록)`, link: `/story/${encodeURIComponent(chapterId)}`, worldId: ch?.worldId },
      e,
      opts.signal,
    );
    throw e;
  }
}

async function doFinish(chapterId: Id, opts: StoryGenOptions): Promise<void> {
  const { signal, onProgress } = opts;
  const chapter = await loadChapter(chapterId);
  if (chapter.status === 'complete') return;
  const world = await loadWorld(chapter.worldId);
  const profile = await resolveProseProfile();
  signal?.throwIfAborted();
  onProgress?.('이야기 정리하는 중');

  const cast = await castOf(world.id);
  const nameOf = nameLookup(cast);
  const beats = await db.beats.where('[chapterId+index]').between([chapterId, 0], [chapterId, Infinity]).toArray();
  const scenes = beats.map((b) => ({
    title: chapter.nodes[b.index]?.title ?? `#${b.index + 1}`,
    lines: capLines(b.segments.map((s) => segmentLine(s, nameOf)), 6000),
  }));

  const { value } = await generateJson(
    profile,
    finishMessages(
      { world, chapter, scenes, storySoFar: await storySoFar(world.id, chapter.index, 2), castNames: cast.map((c) => c.name), known: await knownLore(world.id) },
      await promptCtx('story-finish'),
    ),
    finishSchema(),
    { signal, maxTokens: profile.maxTokens ?? 4096, temperature: profile.temperature ?? 0.5 },
  );
  signal?.throwIfAborted();
  const drafts: LoreDraft[] = [
    ...value.events.map((l) => ({ kind: 'event' as const, ...l })),
    ...value.people.map((l) => ({ kind: 'person' as const, ...l })),
    ...value.items.map((l) => ({ kind: 'item' as const, ...l })),
  ];
  await db.transaction('rw', db.chapters, db.lore, async () => {
    // 다른 탭이 먼저 마쳤으면 기록을 두 번 넣지 않는다
    const cur = await db.chapters.get(chapterId);
    if (!cur || cur.status === 'complete') return;
    await db.chapters.update(chapterId, { summary: value.summary, ledger: value.ledger, status: 'complete', updatedAt: now() });
    const changed = mergeLore(await loreOf(world.id), drafts, { worldId: world.id, chapterId, chapterIndex: chapter.index, cast });
    if (changed.length) await db.lore.bulkPut(changed);
  });
}

/** 장면 대본이 너무 길면 앞뒤를 남기고 가운데를 줄인다 */
function capLines(lines: string[], maxChars: number): string[] {
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  if (total <= maxChars) return lines;
  const head: string[] = [];
  const tail: string[] = [];
  let used = 0;
  let i = 0;
  let j = lines.length - 1;
  while (i <= j) {
    const l = lines[i]!;
    if (used + l.length > maxChars / 2) break;
    head.push(l);
    used += l.length + 1;
    i++;
  }
  while (j >= i) {
    const l = lines[j]!;
    if (used + l.length > maxChars) break;
    tail.unshift(l);
    used += l.length + 1;
    j--;
  }
  return [...head, '(…)', ...tail];
}
