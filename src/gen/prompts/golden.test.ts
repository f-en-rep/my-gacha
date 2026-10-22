// 고친 프롬프트가 없을 때 만드는 메시지가 바꾸기 전과 글자 하나까지 같은지 (스냅숏은 리팩터링 전에 찍었다)
import { describe, expect, it } from 'vitest';
import type { Character, World } from '../../types';
import { bannerMetaMessages, cardMessages, characterMessages, setupMessages } from '../world/prompts';
import { beatMessages, finishMessages, formatStorySoFar, planMessages } from '../story/prompts';
import { chatMessages } from '../chat/prompts';
import { SAMPLE_CARD, SAMPLE_CAST, SAMPLE_CHAPTERS, SAMPLE_CHAT, SAMPLE_LOCATIONS, SAMPLE_WORLD } from './sample';

const bare: World = { ...SAMPLE_WORLD, name: '', scenario: '', directives: '  ', description: '' };
const odd: World = { ...SAMPLE_WORLD, language: 'xx-yy' };
const en: World = { ...SAMPLE_WORLD, language: 'en' };
const longCard = { ...SAMPLE_CARD, description: 'a'.repeat(7000), tags: Array.from({ length: 40 }, (_, i) => `t${i}`), alternateGreetings: [] };
const lightCast: Character[] = SAMPLE_CAST.map((c) => ({ ...c, quotes: [' '], personality: '', appearance: '' }));

describe('세계 설정', () => {
  for (const w of [SAMPLE_WORLD, bare, odd, en])
    for (const askName of [true, false])
      for (const askArt of [true, false])
        it(`${w.language} name=${askName} art=${askArt} ${w.name || 'bare'}`, () => {
          expect(setupMessages(w, { askName, askArt })).toMatchSnapshot();
        });
});

describe('캐릭터', () => {
  it('6★ 한 명 (index)', () => expect(characterMessages(SAMPLE_WORLD, SAMPLE_CAST, { rarity: 6, count: 1, detail: 'full', index: 2 })).toMatchSnapshot());
  it('5★ 한 명 (index 없음, 빈 캐스트)', () => expect(characterMessages(bare, [], { rarity: 5, count: 1, detail: 'full' })).toMatchSnapshot());
  it('3★ 묶음 + 주제', () => expect(characterMessages(SAMPLE_WORLD, SAMPLE_CAST, { rarity: 3, count: 4, detail: 'light', brief: '여름 축제' })).toMatchSnapshot());
  it('4★ 이름·설명', () =>
    expect(characterMessages(odd, SAMPLE_CAST, { rarity: 4, count: 1, detail: 'light', name: ' 리라 ', concept: '떠돌이 음유시인' })).toMatchSnapshot());
  it('특징 없는 월드', () => expect(characterMessages({ ...SAMPLE_WORLD, tags: { ...SAMPLE_WORLD.tags, trait: [] } }, [], { rarity: 6, count: 2, detail: 'full' })).toMatchSnapshot());
});

describe('카드', () => {
  it('희귀도 묻기', () => expect(cardMessages(SAMPLE_WORLD, SAMPLE_CAST, SAMPLE_CARD, { askRarity: true })).toMatchSnapshot());
  it('긴 카드, 빈 캐스트', () => expect(cardMessages(en, [], longCard, { askRarity: false })).toMatchSnapshot());
});

describe('배너', () => {
  it('한정 + 주제', () => expect(bannerMetaMessages(SAMPLE_WORLD, { featuredNames: ['아린', '세레나'], brief: '한여름 불꽃' })).toMatchSnapshot());
  it('상시, 픽업 없음', () => expect(bannerMetaMessages(bare, { featuredNames: [], kind: 'standard' })).toMatchSnapshot());
});

const ch = SAMPLE_CHAPTERS[0]!;
const ch2 = { ...ch, id: 'c2', index: 2, summary: undefined, ledger: undefined };
const many = [1, 2, 3, 4, 5, 6].map((i) => ({ ...ch, id: `x${i}`, index: i, ledger: i % 2 ? ch.ledger : undefined }));

describe('스토리', () => {
  it('1챕터 계획', () =>
    expect(planMessages({ world: SAMPLE_WORLD, cast: SAMPLE_CAST, locations: [], chapterIndex: 1, nodeCount: 6, storySoFar: '' })).toMatchSnapshot());
  it('이어지는 계획', () =>
    expect(
      planMessages({ world: bare, cast: [], locations: SAMPLE_LOCATIONS, chapterIndex: 7, nodeCount: 5, storySoFar: formatStorySoFar(many, 4) }),
    ).toMatchSnapshot());
  it('첫 장면', () =>
    expect(beatMessages({ world: SAMPLE_WORLD, chapter: ch, index: 0, cast: SAMPLE_CAST.slice(0, 1), location: SAMPLE_LOCATIONS[0], previousTail: [], storySoFar: '' })).toMatchSnapshot());
  it('중간 장면', () =>
    expect(
      beatMessages({ world: SAMPLE_WORLD, chapter: ch2, index: 1, cast: lightCast, previousTail: ['아린: "가요!"', '바람이 분다.'], storySoFar: formatStorySoFar([ch], 2) }),
    ).toMatchSnapshot());
  it('마지막 장면, 캐스트 없음', () =>
    expect(beatMessages({ world: bare, chapter: ch, index: 2, cast: [], previousTail: [], storySoFar: '' })).toMatchSnapshot());
  it('마무리', () =>
    expect(
      finishMessages({ world: SAMPLE_WORLD, chapter: ch2, scenes: [{ title: '부임', lines: ['바람이 분다.', '아린: "안녕하세요."'] }, { title: '흔들림', lines: [] }], storySoFar: formatStorySoFar([ch], 2) }),
    ).toMatchSnapshot());
  it('마무리 (장면 없음, 지시문 없음)', () => expect(finishMessages({ world: bare, chapter: ch, scenes: [], storySoFar: '' })).toMatchSnapshot());
});

describe('1:1 대화', () => {
  const c = SAMPLE_CAST[1]!;
  it('이름 있음, 최근 이야기, 카드 출신', () =>
    expect(chatMessages({ world: SAMPLE_WORLD, character: c, playerName: ' 유리 ', stance: '믿음직한 동료', level: 4, storySoFar: formatStorySoFar(SAMPLE_CHAPTERS, 2), history: SAMPLE_CHAT })).toMatchSnapshot());
  it('이름 없음, 기록 합치기', () =>
    expect(
      chatMessages({
        world: odd,
        character: lightCast[0]!,
        stance: '낯선 사람',
        level: 1,
        storySoFar: '  ',
        history: [SAMPLE_CHAT[1]!, SAMPLE_CHAT[0]!, SAMPLE_CHAT[2]!, SAMPLE_CHAT[1]!, SAMPLE_CHAT[1]!],
      }),
    ).toMatchSnapshot());
});
