// 월드 팩과 세이브 백업.
// 월드 팩: 월드 + 캐릭터 + 배너 + 그림 (+ 선택: 스토리). 진행과 API 키는 절대 넣지 않는다.
// 세이브 백업: 월드 팩 전부 + 그 월드의 세이브와 뽑기 기록. API 키는 넣지 않는다.
//
// zip 안의 모양:
//   manifest.json          형식, 버전, 월드 이름, 그림 목록
//   world.json             World (status, genProgress, importedFrom 빼고)
//   characters/<id>.json   Character
//   banners/<id>.json      Banner
//   images/<assetId>.webp  그림 (mime에 따라 .png / .jpg). 장소 배경은 스토리를 넣을 때만
//   story/chapters/<id>.json   Chapter   (스토리 포함일 때, 백업은 항상)
//   story/beats/<id>.json      Beat
//   story/locations/<id>.json  Location
//   saves/<id>.json        Save            (백업만)
//   pulls.json             PullRecord[]    (백업만)
//
// 가져올 때는 월드·캐릭터·배너·그림·챕터·장면·장소·세이브 id를 전부 새로 만들고 참조를 바꿔 끼운다.
// 그래서 같은 팩을 두 번 가져와도 서로 다른 월드가 된다.
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { ZodType, ZodTypeDef } from 'zod';
import { db, getSettings } from '../db';
import { newId, now } from '../core/id';
import { newSave } from '../game/store';
import {
  SCHEMA_VERSION,
  type Asset,
  type Banner,
  type Beat,
  type Chapter,
  type Character,
  type Id,
  type Location,
  type PullRecord,
  type Save,
  type World,
} from '../types';
import {
  BACKUP_FORMAT,
  FORMAT_VERSION,
  PACK_FORMAT,
  bannerSchema,
  beatSchema,
  chapterSchema,
  characterSchema,
  locationSchema,
  manifestSchema,
  pullsFileSchema,
  saveSchema,
  worldFileSchema,
  type Manifest,
  type WorldFile,
} from './schemas';

export { BACKUP_FORMAT, FORMAT_VERSION, PACK_FORMAT } from './schemas';

export interface ExportOptions {
  includeStory: boolean;
}

/** 가져오기·내보내기 실패. message는 화면에 그대로 보여 줄 한국어 */
export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackError';
  }
}

/** zip 파일 자체의 최대 크기 */
export const MAX_PACK_BYTES = 200 * 1024 * 1024;
/** 풀었을 때 최대 크기 (zip 폭탄 방지) */
const MAX_UNPACKED_BYTES = 400 * 1024 * 1024;
const MAX_FILES = 5000;

const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

// ── 내보내기 ──────────────────────────────────────────

export async function exportWorldPack(worldId: Id, opts: ExportOptions): Promise<{ blob: Blob; filename: string }> {
  const data = await collectWorld(worldId);
  const files = await worldEntries(data, PACK_FORMAT, opts);
  return { blob: toZip(files), filename: packFilename(data.world.name, 'gachapack') };
}

export async function exportBackup(worldId: Id): Promise<{ blob: Blob; filename: string }> {
  const data = await collectWorld(worldId);
  const saves = await db.saves.where('worldId').equals(worldId).toArray();
  const pulls: Omit<PullRecord, 'id'>[] = [];
  for (const s of saves) {
    const list = await db.pulls.where('saveId').equals(s.id).sortBy('id');
    for (const { id: _auto, ...rest } of list) pulls.push(rest);
  }
  // 백업에는 스토리가 항상 들어간다 (세이브의 읽은 위치가 챕터 id를 가리키므로)
  const files = await worldEntries(data, BACKUP_FORMAT, { includeStory: true }, saves.length);
  for (const s of saves) files[`saves/${safeName(s.id)}.json`] = json(s);
  files['pulls.json'] = json(pulls);
  const blob = toZip(files);
  const s = await getSettings();
  await db.settings.put({ ...s, lastBackupAt: now() });
  return { blob, filename: packFilename(data.world.name, 'backup') };
}

interface WorldData {
  world: World;
  characters: Character[];
  banners: Banner[];
  assets: Asset[];
  chapters: Chapter[];
  beats: Beat[];
  locations: Location[];
}

async function collectWorld(worldId: Id): Promise<WorldData> {
  const world = await db.worlds.get(worldId);
  if (!world) throw new PackError('월드를 찾을 수 없습니다.');
  if (world.status !== 'ready') throw new PackError('생성이 끝난 월드만 내보낼 수 있습니다.');
  const [characters, banners, assets, chapters, beats, locations] = await Promise.all([
    db.characters.where('worldId').equals(worldId).toArray(),
    db.banners.where('worldId').equals(worldId).toArray(),
    db.assets.where('worldId').equals(worldId).toArray(),
    db.chapters.where('worldId').equals(worldId).toArray(),
    db.beats.where('worldId').equals(worldId).toArray(),
    db.locations.where('worldId').equals(worldId).toArray(),
  ]);
  return { world, characters, banners, assets, chapters, beats, locations };
}

async function worldEntries(d: WorldData, format: string, opts: ExportOptions, saveCount?: number): Promise<Zippable> {
  const files: Zippable = {};
  const images: Manifest['images'] = [];
  const story = opts.includeStory;
  // 장소 배경 그림은 스토리를 넣을 때만 (캐릭터·배너도 쓰는 그림이면 그대로 넣는다)
  const used = new Set<string>();
  for (const c of d.characters) if (c.portraitId) used.add(c.portraitId);
  for (const b of d.banners) if (b.artId) used.add(b.artId);
  const locationArt = new Set(d.locations.map((l) => l.artId).filter((i): i is string => !!i && !used.has(i)));
  for (const a of d.assets) {
    if (!story && locationArt.has(a.id)) continue;
    const ext = EXT[a.mime];
    if (!ext || !a.blob) continue;
    const file = `images/${safeName(a.id)}.${ext}`;
    // 그림은 이미 압축돼 있으니 다시 압축하지 않는다
    files[file] = [new Uint8Array(await a.blob.arrayBuffer()), { level: 0 }];
    images.push({
      file,
      assetId: a.id,
      mime: a.mime as Manifest['images'][number]['mime'],
      width: a.width,
      height: a.height,
      ...(a.prompt !== undefined && { prompt: a.prompt }),
      ...(a.negativePrompt !== undefined && { negativePrompt: a.negativePrompt }),
      ...(a.seed !== undefined && { seed: a.seed }),
    });
  }
  const { status: _s, genProgress: _g, importedFrom: _i, ...worldFile } = d.world;
  const manifest: Manifest = {
    format,
    formatVersion: FORMAT_VERSION,
    schemaVersion: d.world.schemaVersion ?? SCHEMA_VERSION,
    worldName: d.world.name,
    ...(d.world.author && { author: d.world.author }),
    createdAt: now(),
    includes: { story },
    characters: d.characters.length,
    images,
    ...(saveCount !== undefined && { saves: saveCount }),
    ...(story && { story: { chapters: d.chapters.length, beats: d.beats.length, locations: d.locations.length } }),
  };
  files['manifest.json'] = json(manifest);
  files['world.json'] = json(worldFile);
  for (const c of d.characters) files[`characters/${safeName(c.id)}.json`] = json(c);
  for (const b of d.banners) files[`banners/${safeName(b.id)}.json`] = json(b);
  if (story) {
    for (const c of d.chapters) files[`story/chapters/${safeName(c.id)}.json`] = json(c);
    for (const b of d.beats) files[`story/beats/${safeName(b.id)}.json`] = json(b);
    for (const l of d.locations) files[`story/locations/${safeName(l.id)}.json`] = json(l);
  }
  return files;
}

function json(v: unknown): Uint8Array {
  return strToU8(JSON.stringify(v, null, 1));
}

function toZip(files: Zippable): Blob {
  const bytes = zipSync(files, { level: 6 });
  return new Blob([bytes.slice()], { type: 'application/zip' });
}

/** 파일 이름에 못 쓰는 글자 빼기 */
function safeName(s: string): string {
  return s.replace(/[^\w.-]/g, '_').slice(0, 120);
}

/** "월드이름-2026-10-21.gachapack.zip" */
export function packFilename(worldName: string, kind: 'gachapack' | 'backup', date = new Date()): string {
  const name =
    worldName
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/^\.+/, '')
      .slice(0, 60) || 'world';
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  return `${name}-${day}.${kind}.zip`;
}

// ── 가져오기 ──────────────────────────────────────────

/** 새 월드로 들어간다 (같은 월드를 두 번 가져와도 별개의 월드). 빈 세이브도 하나 만든다. 새 월드 id를 돌려준다 */
export async function importWorldPack(file: Blob): Promise<Id> {
  const files = await readZip(file);
  const manifest = readManifest(files, PACK_FORMAT);
  const prepared = await prepareWorld(files, manifest, packName(file, manifest));
  const save = newSave(prepared.world.id);
  await writeAll(prepared, [save], []);
  return prepared.world.id;
}

/** 백업을 새 월드로 되살린다 (세이브·뽑기 기록 포함, id는 전부 새로). 새 월드 id를 돌려준다 */
export async function importBackup(file: Blob): Promise<Id> {
  const files = await readZip(file);
  const manifest = readManifest(files, BACKUP_FORMAT);
  const prepared = await prepareWorld(files, manifest, packName(file, manifest));
  const { world, charMap, bannerMap, chapterMap } = prepared;

  const saveMap = new Map<string, string>();
  const saves: Save[] = [];
  for (const name of listJson(files, 'saves/')) {
    const s = parseJson(files, name, saveSchema);
    if (saveMap.has(s.id)) throw new PackError(`세이브 id가 겹칩니다: ${name}`);
    const sid = newId('save_');
    saveMap.set(s.id, sid);
    const owned: Save['owned'] = {};
    for (const o of Object.values(s.owned)) {
      const cid = charMap.get(o.characterId);
      if (cid) owned[cid] = { ...o, characterId: cid };
    }
    const pity: Save['pity'] = {};
    for (const [k, v] of Object.entries(s.pity)) {
      // 배너 id 키는 바꿔 끼우고, "standard" 같은 공용 키는 그대로
      pity[bannerMap.get(k) ?? k] = v;
    }
    const banners: Save['banners'] = {};
    for (const [k, v] of Object.entries(s.banners)) {
      const bid = bannerMap.get(k);
      if (bid) banners[bid] = v;
    }
    const featured = s.featuredCharacterId ? charMap.get(s.featuredCharacterId) : undefined;
    let story: Save['story'];
    if (s.story) {
      story = {};
      for (const [k, v] of Object.entries(s.story)) {
        const cid = chapterMap.get(k);
        if (cid) story[cid] = v;
      }
    }
    saves.push({
      ...s,
      id: sid,
      worldId: world.id,
      owned,
      pity,
      banners,
      featuredCharacterId: featured,
      story,
    });
  }
  if (!saves.length) saves.push(newSave(world.id));

  const pulls: PullRecord[] = [];
  if (files['pulls.json']) {
    for (const r of parseJson(files, 'pulls.json', pullsFileSchema)) {
      const saveId = saveMap.get(r.saveId);
      const bannerId = bannerMap.get(r.bannerId);
      const characterId = charMap.get(r.characterId);
      if (saveId && bannerId && characterId) pulls.push({ ...r, saveId, bannerId, characterId });
    }
  }
  await writeAll(prepared, saves, pulls);
  return world.id;
}

type Files = Record<string, Uint8Array>;

async function readZip(file: Blob): Promise<Files> {
  if (file.size > MAX_PACK_BYTES) throw new PackError(`파일이 너무 큽니다 (최대 ${MAX_PACK_BYTES / 1024 / 1024}MB).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let count = 0;
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        count++;
        total += f.originalSize;
        if (count > MAX_FILES) throw new PackError(`zip 안의 파일이 너무 많습니다 (최대 ${MAX_FILES}개).`);
        if (total > MAX_UNPACKED_BYTES) throw new PackError('zip을 풀면 너무 큽니다.');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof PackError) throw e;
    throw new PackError('zip 파일을 열 수 없습니다. 망가졌거나 zip 파일이 아닙니다.');
  }
}

function readManifest(files: Files, expected: string): Manifest {
  if (!files['manifest.json']) throw new PackError('my-gacha 파일이 아닙니다 (manifest.json이 없습니다).');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    throw new PackError('manifest.json을 읽을 수 없습니다.');
  }
  const format = (raw as { format?: unknown } | null)?.format;
  if (format !== expected) {
    if (format === BACKUP_FORMAT) throw new PackError('이 파일은 세이브 백업입니다. "백업 불러오기"로 여세요.');
    if (format === PACK_FORMAT) throw new PackError('이 파일은 월드 팩입니다. "월드 팩 열기"로 여세요.');
    throw new PackError('my-gacha 월드 팩이나 백업이 아닙니다.');
  }
  const m = check(manifestSchema, raw, 'manifest.json');
  if (m.formatVersion > FORMAT_VERSION || m.schemaVersion > SCHEMA_VERSION) {
    throw new PackError('더 새 버전의 앱에서 만든 파일입니다. 앱을 새로 고친 뒤 다시 시도하세요.');
  }
  if (m.formatVersion < 1) throw new PackError('알 수 없는 형식 버전입니다.');
  return m;
}

function check<T>(schema: ZodType<T, ZodTypeDef, unknown>, raw: unknown, name: string): T {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
    throw new PackError(`${name} 내용이 올바르지 않습니다${where}.`);
  }
  return r.data;
}

function parseJson<T>(files: Files, name: string, schema: ZodType<T, ZodTypeDef, unknown>): T {
  const bytes = files[name];
  if (!bytes) throw new PackError(`${name} 파일이 없습니다.`);
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(bytes));
  } catch {
    throw new PackError(`${name}을(를) 읽을 수 없습니다.`);
  }
  return check(schema, raw, name);
}

function listJson(files: Files, dir: string): string[] {
  return Object.keys(files)
    .filter((n) => n.startsWith(dir) && n.endsWith('.json') && !n.slice(dir.length).includes('/'))
    .sort();
}

function packName(file: Blob, m: Manifest): string {
  const name = typeof File !== 'undefined' && file instanceof File ? file.name : '';
  return (name || m.worldName).slice(0, 200);
}

interface Prepared {
  world: World;
  characters: Character[];
  banners: Banner[];
  assets: Asset[];
  chapters: Chapter[];
  beats: Beat[];
  locations: Location[];
  charMap: Map<string, string>;
  bannerMap: Map<string, string>;
  chapterMap: Map<string, string>;
}

async function prepareWorld(files: Files, manifest: Manifest, name: string): Promise<Prepared> {
  const wf: WorldFile = parseJson(files, 'world.json', worldFileSchema);
  const worldId = newId('world_');
  const t = now();

  // 그림
  const assetMap = new Map<string, string>();
  const assets: Asset[] = [];
  for (const img of manifest.images) {
    const data = img.file.startsWith('images/') ? files[img.file] : undefined;
    if (!data) continue; // 빠진 그림은 건너뛴다. 초상화는 나중에 다시 그리면 된다
    if (assetMap.has(img.assetId)) throw new PackError(`그림 id가 겹칩니다: ${img.file}`);
    const aid = newId('asset_');
    assetMap.set(img.assetId, aid);
    assets.push({
      id: aid,
      worldId,
      mime: img.mime,
      blob: new Blob([data.slice()], { type: img.mime }),
      width: img.width,
      height: img.height,
      ...(img.prompt !== undefined && { prompt: img.prompt }),
      ...(img.negativePrompt !== undefined && { negativePrompt: img.negativePrompt }),
      ...(img.seed !== undefined && { seed: img.seed }),
      createdAt: t,
    });
  }

  // 캐릭터
  const charMap = new Map<string, string>();
  const rawChars = listJson(files, 'characters/').map((n) => {
    const c = parseJson(files, n, characterSchema);
    if (charMap.has(c.id)) throw new PackError(`캐릭터 id가 겹칩니다: ${n}`);
    charMap.set(c.id, newId('char_'));
    return c;
  });
  if (!rawChars.length) throw new PackError('캐릭터가 하나도 없습니다.');
  const characters: Character[] = rawChars.map((c) => ({
    ...c,
    id: charMap.get(c.id)!,
    worldId,
    portraitId: c.portraitId ? assetMap.get(c.portraitId) : undefined,
  }));

  // 배너
  const bannerMap = new Map<string, string>();
  const mapChars = (ids: string[]) => ids.map((i) => charMap.get(i)).filter((i): i is string => !!i);
  const banners: Banner[] = listJson(files, 'banners/').map((n) => {
    const b = parseJson(files, n, bannerSchema);
    if (bannerMap.has(b.id)) throw new PackError(`배너 id가 겹칩니다: ${n}`);
    const bid = newId('banner_');
    bannerMap.set(b.id, bid);
    return {
      ...b,
      id: bid,
      worldId,
      featured6: mapChars(b.featured6),
      featured5: mapChars(b.featured5),
      pool: b.pool ? mapChars(b.pool) : undefined,
      artId: b.artId ? assetMap.get(b.artId) : undefined,
    };
  });

  // 스토리 (예전 팩이나 스토리를 빼고 만든 팩에는 없다)
  const locationMap = new Map<string, string>();
  const locations: Location[] = listJson(files, 'story/locations/').map((n) => {
    const l = parseJson(files, n, locationSchema);
    if (locationMap.has(l.id)) throw new PackError(`장소 id가 겹칩니다: ${n}`);
    const lid = newId('loc_');
    locationMap.set(l.id, lid);
    return { ...l, id: lid, worldId, artId: l.artId ? assetMap.get(l.artId) : undefined };
  });
  const chapterMap = new Map<string, string>();
  const chapters: Chapter[] = listJson(files, 'story/chapters/').map((n) => {
    const c = parseJson(files, n, chapterSchema);
    if (chapterMap.has(c.id)) throw new PackError(`챕터 id가 겹칩니다: ${n}`);
    const cid = newId('chap_');
    chapterMap.set(c.id, cid);
    return {
      ...c,
      id: cid,
      worldId,
      nodes: c.nodes.map((node) => ({
        ...node,
        castIds: mapChars(node.castIds),
        // 없는 장소를 가리키면 빈 값 (화면에서는 장소 없음으로)
        locationId: locationMap.get(node.locationId) ?? '',
      })),
    };
  });
  const beatIds = new Set<string>();
  const beats: Beat[] = [];
  for (const n of listJson(files, 'story/beats/')) {
    const b = parseJson(files, n, beatSchema);
    if (beatIds.has(b.id)) throw new PackError(`장면 id가 겹칩니다: ${n}`);
    beatIds.add(b.id);
    const chapterId = chapterMap.get(b.chapterId);
    if (!chapterId) continue; // 챕터가 없는 장면은 버린다
    beats.push({
      ...b,
      id: newId('beat_'),
      worldId,
      chapterId,
      segments: b.segments.map(({ speakerId, ...seg }) => {
        const sid = speakerId ? charMap.get(speakerId) : undefined;
        return sid ? { ...seg, speakerId: sid } : seg;
      }),
    });
  }

  const { id: _old, ...rest } = wf;
  const world: World = {
    ...rest,
    id: worldId,
    schemaVersion: SCHEMA_VERSION,
    status: 'ready',
    importedFrom: { packName: name, importedAt: t },
    updatedAt: t,
  };
  return { world, characters, banners, assets, chapters, beats, locations, charMap, bannerMap, chapterMap };
}

/** 전부 한 트랜잭션으로. 중간에 실패하면 아무것도 남지 않는다 */
async function writeAll(p: Prepared, saves: Save[], pulls: PullRecord[]): Promise<void> {
  const tables = [db.worlds, db.characters, db.banners, db.assets, db.saves, db.pulls, db.chapters, db.beats, db.locations];
  await db.transaction('rw', tables, async () => {
    await db.worlds.add(p.world);
    await db.characters.bulkAdd(p.characters);
    await db.banners.bulkAdd(p.banners);
    await db.assets.bulkAdd(p.assets);
    if (p.locations.length) await db.locations.bulkAdd(p.locations);
    if (p.chapters.length) await db.chapters.bulkAdd(p.chapters);
    if (p.beats.length) await db.beats.bulkAdd(p.beats);
    await db.saves.bulkAdd(saves);
    if (pulls.length) await db.pulls.bulkAdd(pulls);
  });
}
