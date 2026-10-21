import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { parseCardJson, type ParsedCard } from '../import/card';
import { SCHEMA_VERSION, type Asset, type Banner, type Beat, type Chapter, type Character, type Save, type World } from '../types';
import { characterSchema } from '../pack/schemas';
import { appearanceSection, cardQuotes, characterFromCard, fallbackSheet, importCard, withUser } from './cardImport';
import { blankForm, characterFromForm, deleteCharacter, formOf, saveCharacter, swapRarityTrait, validateCharacterForm } from './characters';

const T = '2026-10-01T00:00:00.000Z';

function world(over: Partial<World> = {}): World {
  return {
    id: 'w1',
    schemaVersion: SCHEMA_VERSION,
    name: '별의 정원',
    language: 'ko',
    description: '하늘 정원',
    scenario: '',
    directives: '',
    tags: { position: ['근거리', '원거리'], role: ['딜러', '방어형', '치료'], element: ['불', '물', '바람'], trait: ['신입', '숙련', '베테랑', '엘리트'] },
    currency: { pull: '성석', shop: '자격증' },
    art: { positiveTags: '', negativeTags: '' },
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

function save(id: string, over: Partial<Save> = {}): Save {
  return {
    id,
    worldId: 'w1',
    name: '기본',
    wallet: { pull: 0, shop: 0 },
    owned: {},
    pity: {},
    banners: {},
    freeMode: false,
    rngState: 1,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

const CARD: ParsedCard = parseCardJson({
  spec: 'chara_card_v2',
  data: {
    name: '세라',
    description: '외모: 은발에 푸른 눈, 검은 망토.\n성격: 차분함\n\n{{char}}는 북쪽 성채의 검사였다.',
    personality: '차분하고 {{user}}에게 다정하다.',
    scenario: '{{user}}와 {{char}}는 여관에서 만났다.',
    first_mes: '*세라가 고개를 든다.* "어서 와, {{user}}." 그녀가 웃는다. "오늘도 무사했구나."',
    mes_example: '<START>\n{{user}}: 안녕\n{{char}}: 검은 내 친구야.',
    alternate_greetings: [],
    tags: ['fantasy', '치료사', '물'],
    creator: 'tester',
  },
});

async function resetDb() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

describe('카드 기본 정리 (AI 없음)', () => {
  it('{{user}}를 이름(없으면 당신)으로 바꾸고 칸을 옮긴다', () => {
    const card = withUser(CARD, '당신');
    expect(card.personality).toBe('차분하고 당신에게 다정하다.');
    const sheet = fallbackSheet(card, world().tags);
    expect(sheet.appearance).toBe('은발에 푸른 눈, 검은 망토.');
    expect(sheet.background).toContain('세라는 북쪽 성채의 검사였다.');
    expect(sheet.personality).toBe('차분하고 당신에게 다정하다.');
    // 카드 태그가 목록에 맞으면 그 값, 아니면 첫 값
    expect(sheet.role).toEqual(['치료']);
    expect(sheet.element).toBe('물');
    expect(sheet.position).toBe('근거리');
    expect(sheet.imageTags).toBe('');
    expect(sheet.quotes).toEqual(['어서 와, 당신.', '오늘도 무사했구나.', '검은 내 친구야.']);
  });

  it('외모 칸이 없으면 설명 전체를 외형으로', () => {
    const card = { ...CARD, description: '그냥 설명', tags: [] };
    const sheet = fallbackSheet(card, world().tags);
    expect(sheet.appearance).toBe('그냥 설명');
    expect(sheet.role).toEqual(['딜러']);
    expect(sheet.element).toBe('불');
    expect(appearanceSection('Name: X\nAppearance: tall\nwith scars\nPersonality: kind')).toBe('tall\nwith scars');
  });

  it('따옴표가 없으면 첫 인사 첫 문장', () => {
    expect(cardQuotes({ name: 'A', firstMes: '*waves* Hello there. How are you?', alternateGreetings: [], mesExample: '' })).toEqual(['Hello there.']);
  });

  it('캐릭터는 팩 검사를 통과하고 출처를 남긴다', () => {
    const w = world();
    const card = withUser(CARD, '당신');
    const c = characterFromCard(card, fallbackSheet(card, w.tags), w, 5, 'sera.png');
    expect(c.detail).toBe('full');
    expect(c.tags.trait).toEqual(['베테랑']);
    expect(c.stats?.hp).toBeGreaterThan(0);
    expect(c.origin).toMatchObject({ kind: 'card', fileName: 'sera.png', creator: 'tester', spec: 'chara_card_v2' });
    expect(c.origin?.scenario).toBe('당신와 세라는 여관에서 만났다.');
    const parsed = characterSchema.safeParse(c);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.origin?.kind).toBe('card');
  });
});

describe('importCard (DB)', () => {
  beforeEach(resetDb);

  it('AI 없이 가져와 캐스트에 넣고, 그림을 초상화로, 바로 보유', async () => {
    await db.worlds.add(world());
    await db.saves.add(save('s1', { playerName: '지휘관' }));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 0, 0, 0, 2, 0]);
    const card = { ...CARD, image: new Blob([png], { type: 'image/png' }) };
    const r = await importCard('w1', card, 'sera.png', { ai: false, rarity: 'auto', ownSaveId: 's1', playerName: '지휘관' });
    expect(r.usedAi).toBe(false);
    const c = (await db.characters.get(r.characterId))!;
    expect(c.rarity).toBe(4);
    expect(c.detail).toBe('light');
    expect(c.personality).toBe('차분하고 지휘관에게 다정하다.');
    const a = (await db.assets.get(c.portraitId!))!;
    expect(a.worldId).toBe('w1');
    expect([a.width, a.height]).toEqual([256, 512]);
    const s = (await db.saves.get('s1'))!;
    expect(s.owned[c.id]).toMatchObject({ characterId: c.id, potential: 1 });
  });
});

describe('직접 고치기', () => {
  beforeEach(resetDb);

  it('폼 검사: 한국어 오류, 목록 밖 태그 거절', () => {
    const w = world();
    const f = blankForm(w.tags);
    const r = validateCharacterForm({ ...f, imageTags: '은발' }, w.tags);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.name).toBe('이름을 입력해 주세요.');
      expect(r.errors['tags.role']).toBe('역할을 하나 이상 골라 주세요.');
      expect(r.errors['tags.element']).toContain('속성');
      expect(r.errors.imageTags).toContain('영어');
    }
    const ok = validateCharacterForm({ ...f, name: ' 새 친구 ', tags: { ...f.tags, role: ['딜러'], element: '불' }, quotes: ['', ' 안녕 '] }, w.tags);
    expect(ok.ok && ok.value.name).toBe('새 친구');
    expect(ok.ok && ok.value.quotes).toEqual(['안녕']);
  });

  it('희귀도를 바꾸면 능력치·시트 종류·특징이 바뀐다', () => {
    const w = world();
    const orig = { ...char('c1', 3), stats: { hp: 1, atk: 1, def: 1, spd: 1, range: 1, block: 1 } };
    const same = characterFromForm(formOf(orig), 'w1', w.tags, orig);
    expect(same.stats).toEqual(orig.stats);
    const f = formOf(orig);
    f.rarity = 6;
    f.tags.trait = swapRarityTrait(f.tags.trait, w.tags, 3, 6);
    expect(f.tags.trait).toEqual(['엘리트']);
    const up = characterFromForm(f, 'w1', w.tags, orig);
    expect(up.detail).toBe('full');
    expect(up.stats!.hp).toBeGreaterThan(1000);
  });

  it('초상화를 바꾸거나 지우면 옛 그림을 지운다', async () => {
    await db.worlds.add(world());
    const a1: Asset = { id: 'a1', worldId: 'w1', mime: 'image/webp', blob: new Blob([new Uint8Array([1])]), width: 1, height: 1, createdAt: T };
    await db.assets.add(a1);
    await db.characters.add(char('c1', 4, 'a1'));
    await saveCharacter({ ...char('c1', 4, 'a1'), name: '바뀜' }, { ...a1, id: 'a2' });
    expect((await db.characters.get('c1'))!.portraitId).toBe('a2');
    expect(await db.assets.get('a1')).toBeUndefined();
    await saveCharacter((await db.characters.get('c1'))!, null);
    expect((await db.characters.get('c1'))!.portraitId).toBeUndefined();
    expect(await db.assets.count()).toBe(0);
  });
});

describe('deleteCharacter', () => {
  beforeEach(resetDb);

  it('가리키는 것을 전부 정리한다', async () => {
    await db.worlds.add(world());
    await db.assets.add({ id: 'a1', worldId: 'w1', mime: 'image/webp', blob: new Blob([new Uint8Array([1])]), width: 1, height: 1, createdAt: T });
    await db.characters.bulkAdd([char('c1', 6, 'a1'), char('c2', 6), char('c3', 5)]);
    const banners: Banner[] = [
      { id: 'b1', worldId: 'w1', kind: 'standard', name: '상시', featured6: ['c1', 'c2'], featured5: ['c3'], createdAt: T },
      { id: 'b2', worldId: 'w1', kind: 'limited', name: '한정', featured6: ['c1'], featured5: [], pool: ['c1'], createdAt: T },
    ];
    await db.banners.bulkAdd(banners);
    await db.saves.add(
      save('s1', {
        owned: { c1: { characterId: 'c1', potential: 2, obtainedAt: T }, c2: { characterId: 'c2', potential: 1, obtainedAt: T } },
        bonds: { c1: { points: 10, claimed: [] }, c2: { points: 3, claimed: [] } },
        featuredCharacterId: 'c1',
      }),
    );
    await db.chatLines.bulkAdd([
      { saveId: 's1', characterId: 'c1', role: 'user', text: '안녕', at: T },
      { saveId: 's1', characterId: 'c2', role: 'user', text: '안녕', at: T },
    ]);
    await db.pulls.add({ saveId: 's1', bannerId: 'b1', characterId: 'c1', rarity: 6, pityBefore: 0, isNew: true, at: T });
    const chapter: Chapter = {
      id: 'ch1',
      worldId: 'w1',
      index: 1,
      title: '1장',
      synopsis: '',
      nodes: [{ title: '만남', guide: '', castIds: ['c1', 'c2'], locationId: 'l1' }],
      status: 'planned',
      createdAt: T,
      updatedAt: T,
    };
    await db.chapters.add(chapter);
    const beat: Beat = {
      id: 'bt1',
      worldId: 'w1',
      chapterId: 'ch1',
      index: 0,
      segments: [
        { kind: 'line', speakerId: 'c1', text: '가자' },
        { kind: 'line', speakerId: 'c2', speakerName: '캐릭터 c2', text: '응' },
      ],
      createdAt: T,
    };
    await db.beats.add(beat);

    await deleteCharacter('c1');

    expect(await db.characters.get('c1')).toBeUndefined();
    expect(await db.assets.get('a1')).toBeUndefined();
    const b1 = (await db.banners.get('b1'))!;
    expect(b1.featured6).toEqual(['c2']);
    expect(b1.featured5).toEqual(['c3']);
    const b2 = (await db.banners.get('b2'))!;
    expect(b2.featured6).toEqual([]);
    expect(b2.pool).toBeUndefined();
    const s = (await db.saves.get('s1'))!;
    expect(Object.keys(s.owned)).toEqual(['c2']);
    expect(Object.keys(s.bonds!)).toEqual(['c2']);
    expect(s.featuredCharacterId).toBeUndefined();
    expect((await db.chatLines.toArray()).map((l) => l.characterId)).toEqual(['c2']);
    expect(await db.pulls.count()).toBe(1);
    expect((await db.chapters.get('ch1'))!.nodes[0]!.castIds).toEqual(['c2']);
    const segs = (await db.beats.get('bt1'))!.segments;
    expect(segs[0]).toEqual({ kind: 'line', speakerName: '캐릭터 c1', text: '가자' });
    expect(segs[1]!.speakerId).toBe('c2');
  });

  it('없는 캐릭터는 아무 일도 하지 않는다', async () => {
    await expect(deleteCharacter('nope')).resolves.toBeUndefined();
  });
});
