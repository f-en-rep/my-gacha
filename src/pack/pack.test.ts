import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { db } from '../db';
import { SCHEMA_VERSION, type Asset, type Banner, type Character, type PullRecord, type Save, type World } from '../types';
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

describe('파일 이름', () => {
  it('못 쓰는 글자를 뺀다', () => {
    const d = new Date(2026, 9, 21);
    expect(packFilename('월드 이름', 'gachapack', d)).toBe('월드-이름-2026-10-21.gachapack.zip');
    expect(packFilename('a/b:c*?', 'backup', d)).toBe('abc-2026-10-21.backup.zip');
    expect(packFilename('  ', 'backup', d)).toBe('world-2026-10-21.backup.zip');
  });
});
