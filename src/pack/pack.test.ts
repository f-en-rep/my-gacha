import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { db } from '../db';
import { SCHEMA_VERSION, type Asset, type Banner, type Beat, type Chapter, type Character, type ChatLine, type Location, type PullRecord, type Save, type World } from '../types';
import { exportBackup, exportWorldPack, importBackup, importWorldPack, packFilename, PackError } from './index';

const T = '2026-10-01T00:00:00.000Z';
const IMG = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 87, 69, 66, 80, 9, 9, 9]);

function world(over: Partial<World> = {}): World {
  return {
    id: 'w1',
    schemaVersion: SCHEMA_VERSION,
    name: '별의 정원 / 테스트',
    language: 'ko',
    description: '하늘에 떠 있는 정원 도시',
    scenario: '정원사가 된 첫날',
    directives: '밝게',
    tags: { position: ['근거리', '원거리'], role: ['딜러', '치료'], element: ['불', '물'], trait: ['신입', '엘리트'] },
    currency: { pull: '성석', shop: '자격증' },
    art: { positiveTags: 'watercolor', negativeTags: 'lowres' },
    author: '나',
    status: 'ready',
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

function char(id: string, rarity: Character['rarity'], portraitId?: string): Character {
  return {
    id,
    worldId: 'w1',
    name: '캐릭터 ' + id,
    rarity,
    tags: { position: '근거리', role: ['딜러'], element: '불', trait: ['신입'] },
    appearance: '빨간 머리',
    imageTags: '1girl, red hair',
    personality: '활발',
    background: '정원사',
    quotes: ['안녕!'],
    portraitId,
    detail: rarity >= 5 ? 'full' : 'light',
    createdAt: T,
    updatedAt: T,
  };
}

async function seed() {
  const asset: Asset = {
    id: 'a1',
    worldId: 'w1',
    mime: 'image/webp',
    blob: new Blob([IMG], { type: 'image/webp' }),
    width: 832,
    height: 1216,
    prompt: '1girl, red hair',
    seed: 42,
    createdAt: T,
  };
  const chars = [char('c6', 6, 'a1'), char('c5', 5), char('c4', 4), char('c3', 3)];
  const banner: Banner = {
    id: 'b1',
    worldId: 'w1',
    kind: 'limited',
    name: '한정',
    featured6: ['c6'],
    featured5: ['c5'],
    pool: ['c6', 'c5', 'c4', 'c3'],
    artId: 'a1',
    createdAt: T,
  };
  const save: Save = {
    id: 's1',
    worldId: 'w1',
    name: '기본',
    wallet: { pull: 1234, shop: 5 },
    owned: { c6: { characterId: 'c6', potential: 2, obtainedAt: T }, c3: { characterId: 'c3', potential: 1, obtainedAt: T } },
    pity: { standard: { sinceSix: 3 }, b1: { sinceSix: 17 } },
    banners: { b1: { pulls: 20, firstTenSatisfied: true, sparkPoints: 20 } },
    freeMode: true,
    rngState: 99,
    featuredCharacterId: 'c6',
    createdAt: T,
    updatedAt: T,
  };
  const pulls: PullRecord[] = [
    { saveId: 's1', bannerId: 'b1', characterId: 'c6', rarity: 6, pityBefore: 10, isNew: true, at: T },
    { saveId: 's1', bannerId: 'b1', characterId: 'c3', rarity: 3, pityBefore: 0, isNew: true, at: T },
  ];
  await db.worlds.put(world());
  await db.characters.bulkPut(chars);
  await db.banners.put(banner);
  await db.assets.put(asset);
  await db.saves.put(save);
  await db.pulls.bulkAdd(pulls);
  await db.profiles.put({ id: 'p1', type: 'text', provider: 'openrouter', label: 'x', apiKey: 'sk-SECRET-KEY', model: 'm', useRelay: false });
  await db.settings.put({ id: 'app', routing: { structured: 'p1' }, autoPaintLowRarity: false, activeWorldId: 'w1', activeSaveId: 's1' });
}

async function unzipBlob(b: Blob) {
  return unzipSync(new Uint8Array(await b.arrayBuffer()));
}

function zipBlob(files: Record<string, unknown>): Blob {
  const z: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) z[k] = v instanceof Uint8Array ? v : strToU8(typeof v === 'string' ? v : JSON.stringify(v));
  return new Blob([zipSync(z).slice()]);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seed();
});

describe('월드 팩', () => {
  it('내보내기에 진행·키가 없다', async () => {
    const { blob, filename } = await exportWorldPack('w1', { includeStory: false });
    expect(filename).toMatch(/^별의-정원-테스트-\d{4}-\d{2}-\d{2}\.gachapack\.zip$/);
    const files = await unzipBlob(blob);
    const names = Object.keys(files).sort();
    expect(names).toEqual(
      ['banners/b1.json', 'characters/c3.json', 'characters/c4.json', 'characters/c5.json', 'characters/c6.json', 'images/a1.webp', 'manifest.json', 'world.json'].sort(),
    );
    const all = names.map((n) => (n.endsWith('.json') ? strFromU8(files[n]!) : '')).join('\n');
    expect(all).not.toContain('sk-SECRET-KEY');
    expect(all).not.toContain('rngState');
    expect(all).not.toContain('genProgress');
    const w = JSON.parse(strFromU8(files['world.json']!));
    expect(w.status).toBeUndefined();
    const m = JSON.parse(strFromU8(files['manifest.json']!));
    expect(m).toMatchObject({ format: 'my-gacha-world', formatVersion: 1, worldName: '별의 정원 / 테스트', author: '나', characters: 4, includes: { story: false } });
    expect(m.images[0]).toMatchObject({ file: 'images/a1.webp', assetId: 'a1', mime: 'image/webp', width: 832, height: 1216, seed: 42 });
  });

  it('왕복: 새 id로 들어가고 참조가 이어진다', async () => {
    const { blob } = await exportWorldPack('w1', { includeStory: false });
    const file = new File([blob], '정원.gachapack.zip');
    const id1 = await importWorldPack(file);
    const id2 = await importWorldPack(file);
    expect(id1).not.toBe('w1');
    expect(id2).not.toBe(id1);

    const w = (await db.worlds.get(id1))!;
    expect(w.status).toBe('ready');
    expect(w.importedFrom?.packName).toBe('정원.gachapack.zip');
    expect(w.name).toBe('별의 정원 / 테스트');
    expect(w.tags.element).toEqual(['불', '물']);

    const chars = await db.characters.where('worldId').equals(id1).toArray();
    expect(chars).toHaveLength(4);
    const ids = new Set(chars.map((c) => c.id));
    for (const old of ['c3', 'c4', 'c5', 'c6']) expect(ids.has(old)).toBe(false);
    const six = chars.find((c) => c.rarity === 6)!;
    const five = chars.find((c) => c.rarity === 5)!;
    expect(six.portraitId).toBeTruthy();
    expect(six.portraitId).not.toBe('a1');

    const asset = (await db.assets.get(six.portraitId!))!;
    expect(asset.worldId).toBe(id1);
    expect(asset.mime).toBe('image/webp');
    expect(asset.seed).toBe(42);
    expect(new Uint8Array(await asset.blob.arrayBuffer())).toEqual(IMG);

    const [b] = await db.banners.where('worldId').equals(id1).toArray();
    expect(b!.id).not.toBe('b1');
    expect(b!.featured6).toEqual([six.id]);
    expect(b!.featured5).toEqual([five.id]);
    expect(b!.pool!.every((p) => ids.has(p))).toBe(true);
    expect(b!.artId).toBe(asset.id);

    // 진행은 안 따라온다: 빈 세이브 하나
    const saves = await db.saves.where('worldId').equals(id1).toArray();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.owned).toEqual({});
    expect(await db.pulls.where('saveId').equals(saves[0]!.id).count()).toBe(0);

    // 원래 월드는 그대로
    expect(await db.characters.where('worldId').equals('w1').count()).toBe(4);
  });

  it('생성 중인 월드는 내보낼 수 없다', async () => {
    await db.worlds.update('w1', { status: 'generating' });
    await expect(exportWorldPack('w1', { includeStory: false })).rejects.toBeInstanceOf(PackError);
  });
});

describe('백업', () => {
  it('왕복: 세이브와 뽑기 기록이 새 id로 이어진다', async () => {
    const { blob, filename } = await exportBackup('w1');
    expect(filename).toMatch(/\.backup\.zip$/);
    expect((await db.settings.get('app'))!.lastBackupAt).toBeTruthy();
    const files = await unzipBlob(blob);
    expect(Object.keys(files)).toContain('saves/s1.json');
    expect(Object.keys(files)).toContain('pulls.json');
    expect(Object.values(files).map((f) => strFromU8(f)).join('')).not.toContain('sk-SECRET-KEY');

    const id = await importBackup(blob);
    const chars = await db.characters.where('worldId').equals(id).toArray();
    const byRarity = (r: number) => chars.find((c) => c.rarity === r)!;
    const [banner] = await db.banners.where('worldId').equals(id).toArray();
    const [save] = await db.saves.where('worldId').equals(id).toArray();
    expect(save!.id).not.toBe('s1');
    expect(save!.wallet).toEqual({ pull: 1234, shop: 5 });
    expect(save!.freeMode).toBe(true);
    expect(Object.keys(save!.owned).sort()).toEqual([byRarity(6).id, byRarity(3).id].sort());
    expect(save!.owned[byRarity(6).id]!.potential).toBe(2);
    expect(save!.featuredCharacterId).toBe(byRarity(6).id);
    expect(save!.pity).toEqual({ standard: { sinceSix: 3 }, [banner!.id]: { sinceSix: 17 } });
    expect(Object.keys(save!.banners)).toEqual([banner!.id]);

    const pulls = await db.pulls.where('saveId').equals(save!.id).toArray();
    expect(pulls).toHaveLength(2);
    for (const p of pulls) {
      expect(p.bannerId).toBe(banner!.id);
      expect(chars.some((c) => c.id === p.characterId)).toBe(true);
    }
  });

  it('팩과 백업을 서로 잘못 열면 알려 준다', async () => {
    const pack = (await exportWorldPack('w1', { includeStory: false })).blob;
    const backup = (await exportBackup('w1')).blob;
    await expect(importBackup(pack)).rejects.toThrow(/월드 팩입니다/);
    await expect(importWorldPack(backup)).rejects.toThrow(/세이브 백업입니다/);
  });
});

describe('잘못된 파일', () => {
  const before = async () => db.worlds.count();

  it('zip이 아닌 파일', async () => {
    const n = await before();
    await expect(importWorldPack(new Blob(['hello']))).rejects.toThrow(/zip 파일을 열 수 없습니다/);
    expect(await db.worlds.count()).toBe(n);
  });

  it('다른 형식의 zip', async () => {
    await expect(importWorldPack(zipBlob({ 'readme.txt': 'hi' }))).rejects.toThrow(/manifest.json이 없습니다/);
    await expect(importWorldPack(zipBlob({ 'manifest.json': { format: 'something-else' } }))).rejects.toThrow(/월드 팩이나 백업이 아닙니다/);
  });

  it('더 새 형식 버전', async () => {
    const files = await unzipBlob((await exportWorldPack('w1', { includeStory: false })).blob);
    const m = JSON.parse(strFromU8(files['manifest.json']!));
    files['manifest.json'] = strToU8(JSON.stringify({ ...m, formatVersion: 2 }));
    await expect(importWorldPack(zipBlob(files))).rejects.toThrow(/더 새 버전/);
  });

  it('망가진 캐릭터 JSON이면 아무것도 쓰지 않는다', async () => {
    const n = await before();
    const files = await unzipBlob((await exportWorldPack('w1', { includeStory: false })).blob);
    const c = JSON.parse(strFromU8(files['characters/c4.json']!));
    files['characters/c4.json'] = strToU8(JSON.stringify({ ...c, rarity: 9 }));
    await expect(importWorldPack(zipBlob(files))).rejects.toThrow(/characters\/c4.json 내용이 올바르지 않습니다/);
    expect(await db.worlds.count()).toBe(n);
    expect(await db.assets.count()).toBe(1);
  });

  it('world.json이 없으면', async () => {
    const files = await unzipBlob((await exportWorldPack('w1', { includeStory: false })).blob);
    delete files['world.json'];
    await expect(importWorldPack(zipBlob(files))).rejects.toThrow(/world.json 파일이 없습니다/);
  });
});

const BG = new Uint8Array([137, 80, 78, 71, 5, 6, 7]);

/** 장소 하나(배경 그림 a2), 챕터 두 개, 장면 두 개. 세이브에 읽은 위치 */
async function seedStory() {
  const bg: Asset = { id: 'a2', worldId: 'w1', mime: 'image/png', blob: new Blob([BG], { type: 'image/png' }), width: 1216, height: 832, createdAt: T };
  const loc: Location = { id: 'l1', worldId: 'w1', name: '온실', description: '유리 온실', imageTags: 'greenhouse, no humans', artId: 'a2', createdAt: T };
  const ch1: Chapter = {
    id: 'ch1',
    worldId: 'w1',
    index: 1,
    title: '첫날',
    synopsis: '정원사가 된다',
    nodes: [
      { title: '도착', guide: '온실에 도착', castIds: ['c6', 'ghost'], locationId: 'l1' },
      { title: '만남', guide: '만난다', castIds: ['c5'], locationId: 'nowhere' },
    ],
    summary: '요약',
    ledger: '장부',
    status: 'complete',
    createdAt: T,
    updatedAt: T,
  };
  const ch2: Chapter = { ...ch1, id: 'ch2', index: 2, title: '둘째 날', nodes: [{ title: '아침', guide: '', castIds: [], locationId: 'l1' }], summary: undefined, ledger: undefined, status: 'planned' };
  const beats: Beat[] = [
    {
      id: 'bt1',
      worldId: 'w1',
      chapterId: 'ch1',
      index: 0,
      segments: [
        { kind: 'narration', text: '바람이 분다.' },
        { kind: 'line', speakerId: 'c6', speakerName: '캐릭터 c6', text: '안녕!' },
        { kind: 'thought', speakerId: 'ghost', speakerName: '지나가던 사람', text: '…' },
      ],
      createdAt: T,
    },
    { id: 'bt2', worldId: 'w1', chapterId: 'ch1', index: 1, segments: [{ kind: 'line', speakerName: '행인', text: '어서 와' }], createdAt: T },
  ];
  await db.assets.put(bg);
  await db.locations.put(loc);
  await db.chapters.bulkPut([ch1, ch2]);
  await db.beats.bulkPut(beats);
  await db.saves.update('s1', { story: { ch1: { beat: 1, segment: 0, clearedAt: T }, ch2: { beat: 0, segment: 3 }, gone: { beat: 0, segment: 0 } } });
}

describe('스토리', () => {
  beforeEach(seedStory);

  it('스토리 없이 내보내면 story/ 파일과 장소 그림이 없다', async () => {
    const files = await unzipBlob((await exportWorldPack('w1', { includeStory: false })).blob);
    const names = Object.keys(files);
    expect(names.some((n) => n.startsWith('story/'))).toBe(false);
    expect(names).not.toContain('images/a2.png');
    expect(names).toContain('images/a1.webp');
    const m = JSON.parse(strFromU8(files['manifest.json']!));
    expect(m.includes).toEqual({ story: false });
    expect(m.story).toBeUndefined();
    expect(m.images.map((i: { assetId: string }) => i.assetId)).toEqual(['a1']);

    const id = await importWorldPack(new Blob([await (await exportWorldPack('w1', { includeStory: false })).blob.arrayBuffer()]));
    expect(await db.chapters.where('worldId').equals(id).count()).toBe(0);
    expect(await db.locations.where('worldId').equals(id).count()).toBe(0);
  });

  it('스토리 포함 내보내기', async () => {
    const files = await unzipBlob((await exportWorldPack('w1', { includeStory: true })).blob);
    const names = Object.keys(files);
    for (const n of ['story/chapters/ch1.json', 'story/chapters/ch2.json', 'story/beats/bt1.json', 'story/beats/bt2.json', 'story/locations/l1.json', 'images/a2.png']) {
      expect(names).toContain(n);
    }
    const m = JSON.parse(strFromU8(files['manifest.json']!));
    expect(m.formatVersion).toBe(1);
    expect(m.includes).toEqual({ story: true });
    expect(m.story).toEqual({ chapters: 2, beats: 2, locations: 1 });
    expect(m.images.find((i: { assetId: string }) => i.assetId === 'a2')).toMatchObject({ file: 'images/a2.png', mime: 'image/png' });
    // 진행은 여전히 없다
    expect(names.some((n) => n.startsWith('saves/'))).toBe(false);
  });

  it('왕복: 챕터·장면·장소 id와 참조가 새로 이어진다', async () => {
    const id = await importWorldPack((await exportWorldPack('w1', { includeStory: true })).blob);
    const chars = await db.characters.where('worldId').equals(id).toArray();
    const byRarity = (r: number) => chars.find((c) => c.rarity === r)!;

    const [loc] = await db.locations.where('worldId').equals(id).toArray();
    expect(loc!.id).not.toBe('l1');
    expect(loc!.name).toBe('온실');
    expect(loc!.artId).toBeTruthy();
    expect(loc!.artId).not.toBe('a2');
    const art = (await db.assets.get(loc!.artId!))!;
    expect(art.worldId).toBe(id);
    expect(new Uint8Array(await art.blob.arrayBuffer())).toEqual(BG);

    const chapters = (await db.chapters.where('worldId').equals(id).toArray()).sort((a, b) => a.index - b.index);
    expect(chapters).toHaveLength(2);
    const [c1, c2] = chapters;
    expect(c1!.id).not.toBe('ch1');
    expect(c1!.status).toBe('complete');
    expect(c1!.summary).toBe('요약');
    expect(c1!.ledger).toBe('장부');
    expect(c2!.status).toBe('planned');
    expect(c1!.nodes[0]!.castIds).toEqual([byRarity(6).id]); // 없는 캐릭터는 빠진다
    expect(c1!.nodes[0]!.locationId).toBe(loc!.id);
    expect(c1!.nodes[1]!.castIds).toEqual([byRarity(5).id]);
    expect(c1!.nodes[1]!.locationId).toBe('');
    expect(c2!.nodes[0]!.locationId).toBe(loc!.id);

    const beats = (await db.beats.where('chapterId').equals(c1!.id).toArray()).sort((a, b) => a.index - b.index);
    expect(beats).toHaveLength(2);
    expect(beats.every((b) => b.worldId === id && b.id !== 'bt1' && b.id !== 'bt2')).toBe(true);
    const segs = beats[0]!.segments;
    expect(segs[1]).toEqual({ kind: 'line', speakerId: byRarity(6).id, speakerName: '캐릭터 c6', text: '안녕!' });
    expect(segs[2]).toEqual({ kind: 'thought', speakerName: '지나가던 사람', text: '…' });
    expect(beats[1]!.segments[0]!.speakerId).toBeUndefined();

    // 원래 스토리는 그대로
    expect(await db.chapters.get('ch1')).toBeTruthy();
  });

  it('백업: 스토리가 늘 들어가고 세이브의 읽은 위치가 새 챕터 id로 이어진다', async () => {
    const { blob } = await exportBackup('w1');
    const files = await unzipBlob(blob);
    expect(Object.keys(files)).toContain('story/chapters/ch1.json');
    expect(Object.keys(files)).toContain('images/a2.png');
    expect(JSON.parse(strFromU8(files['saves/s1.json']!)).story.ch1.beat).toBe(1);

    const id = await importBackup(blob);
    const chapters = (await db.chapters.where('worldId').equals(id).toArray()).sort((a, b) => a.index - b.index);
    const [save] = await db.saves.where('worldId').equals(id).toArray();
    expect(save!.story).toEqual({
      [chapters[0]!.id]: { beat: 1, segment: 0, clearedAt: T },
      [chapters[1]!.id]: { beat: 0, segment: 3 },
    });
    expect(await db.beats.where('worldId').equals(id).count()).toBe(2);
    const [loc] = await db.locations.where('worldId').equals(id).toArray();
    expect(await db.assets.get(loc!.artId!)).toBeTruthy();
  });

  it('스토리 파일 없는 예전 팩도 열린다', async () => {
    const files = await unzipBlob((await exportWorldPack('w1', { includeStory: false })).blob);
    const m = JSON.parse(strFromU8(files['manifest.json']!));
    delete m.story;
    files['manifest.json'] = strToU8(JSON.stringify(m));
    const id = await importWorldPack(zipBlob(files));
    expect(await db.characters.where('worldId').equals(id).count()).toBe(4);
    expect(await db.chapters.where('worldId').equals(id).count()).toBe(0);

    // 스토리 이전 형식의 백업 (세이브에 story 없음)
    const bfiles = await unzipBlob((await exportBackup('w1')).blob);
    for (const n of Object.keys(bfiles)) if (n.startsWith('story/')) delete bfiles[n];
    const s = JSON.parse(strFromU8(bfiles['saves/s1.json']!));
    delete s.story;
    bfiles['saves/s1.json'] = strToU8(JSON.stringify(s));
    const bid = await importBackup(zipBlob(bfiles));
    const [save] = await db.saves.where('worldId').equals(bid).toArray();
    expect(save!.story).toBeUndefined();
    expect(save!.wallet.pull).toBe(1234);
  });

  it('망가진 스토리 파일이면 아무것도 쓰지 않는다', async () => {
    const n = await db.worlds.count();
    const chapters = await db.chapters.count();
    const files = await unzipBlob((await exportWorldPack('w1', { includeStory: true })).blob);
    const b = JSON.parse(strFromU8(files['story/beats/bt1.json']!));
    files['story/beats/bt1.json'] = strToU8(JSON.stringify({ ...b, segments: [{ kind: 'shout', text: 'x' }] }));
    await expect(importWorldPack(zipBlob(files))).rejects.toThrow(/story\/beats\/bt1.json 내용이 올바르지 않습니다/);
    expect(await db.worlds.count()).toBe(n);
    expect(await db.chapters.count()).toBe(chapters);
  });
});

describe('대화와 호감도', () => {
  beforeEach(async () => {
    const lines: ChatLine[] = [
      { saveId: 's1', characterId: 'c6', role: 'user', text: '안녕', at: T },
      { saveId: 's1', characterId: 'c6', role: 'char', text: '반가워!', at: T },
      { saveId: 's1', characterId: 'ghost', role: 'user', text: '없는 캐릭터', at: T },
      { saveId: 'other', characterId: 'c6', role: 'user', text: '다른 세이브', at: T },
    ];
    await db.chatLines.bulkAdd(lines);
    await db.saves.update('s1', {
      playerName: '별지기 민',
      bonds: {
        c6: { points: 120, claimed: [1, 2], today: { day: '2026-10-21', points: 30 } },
        c3: { points: 5, claimed: [] },
        ghost: { points: 999, claimed: [1] },
      },
    });
  });

  it('백업 왕복: 대화와 호감도가 새 id로 이어진다', async () => {
    const { blob } = await exportBackup('w1');
    const files = await unzipBlob(blob);
    const chats = JSON.parse(strFromU8(files['chats.json']!));
    // 이 월드 세이브의 대화만, 자동 번호 없이
    expect(chats).toHaveLength(3);
    expect(chats.every((l: ChatLine) => l.saveId === 's1' && l.id === undefined)).toBe(true);

    const id = await importBackup(blob);
    const chars = await db.characters.where('worldId').equals(id).toArray();
    const byRarity = (r: number) => chars.find((c) => c.rarity === r)!;
    const [save] = await db.saves.where('worldId').equals(id).toArray();
    expect(save!.playerName).toBe('별지기 민');
    expect(save!.bonds).toEqual({
      [byRarity(6).id]: { points: 120, claimed: [1, 2], today: { day: '2026-10-21', points: 30 } },
      [byRarity(3).id]: { points: 5, claimed: [] },
    });
    const lines = await db.chatLines.where('saveId').equals(save!.id).sortBy('id');
    expect(lines.map((l) => [l.characterId, l.role, l.text])).toEqual([
      [byRarity(6).id, 'user', '안녕'],
      [byRarity(6).id, 'char', '반가워!'],
    ]);
    // 원래 대화는 그대로
    expect(await db.chatLines.where('saveId').equals('s1').count()).toBe(3);
  });

  it('월드 팩에는 대화도 호감도도 없다', async () => {
    for (const includeStory of [false, true]) {
      const files = await unzipBlob((await exportWorldPack('w1', { includeStory })).blob);
      expect(Object.keys(files)).not.toContain('chats.json');
      const all = Object.entries(files)
        .filter(([n]) => n.endsWith('.json'))
        .map(([, f]) => strFromU8(f))
        .join('\n');
      expect(all).not.toContain('반가워');
      expect(all).not.toContain('bonds');
      expect(all).not.toContain('별지기 민');
    }
    const id = await importWorldPack((await exportWorldPack('w1', { includeStory: true })).blob);
    const [save] = await db.saves.where('worldId').equals(id).toArray();
    expect(save!.bonds).toBeUndefined();
    expect(await db.chatLines.where('saveId').equals(save!.id).count()).toBe(0);
  });

  it('chats.json 없는 예전 백업도 열린다', async () => {
    const files = await unzipBlob((await exportBackup('w1')).blob);
    delete files['chats.json'];
    const id = await importBackup(zipBlob(files));
    const [save] = await db.saves.where('worldId').equals(id).toArray();
    expect(await db.chatLines.where('saveId').equals(save!.id).count()).toBe(0);
  });

  it('망가진 chats.json이면 아무것도 쓰지 않는다', async () => {
    const n = await db.worlds.count();
    const files = await unzipBlob((await exportBackup('w1')).blob);
    files['chats.json'] = strToU8(JSON.stringify([{ saveId: 's1', characterId: 'c6', role: 'narrator', text: 'x', at: T }]));
    await expect(importBackup(zipBlob(files))).rejects.toThrow(/chats.json 내용이 올바르지 않습니다/);
    expect(await db.worlds.count()).toBe(n);
  });
});

describe('파일 이름', () => {
  it('못 쓰는 글자를 뺀다', () => {
    const d = new Date(2026, 9, 21);
    expect(packFilename('월드 이름', 'gachapack', d)).toBe('월드-이름-2026-10-21.gachapack.zip');
    expect(packFilename('a/b:c*?', 'backup', d)).toBe('abc-2026-10-21.backup.zip');
    expect(packFilename('  ', 'backup', d)).toBe('world-2026-10-21.backup.zip');
  });
});
