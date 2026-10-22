import { describe, expect, it } from 'vitest';
import { parseHash, paths } from './router';

describe('캐릭터 경로', () => {
  it('새 캐릭터, 카드 가져오기, 편집', () => {
    expect(parseHash('#' + paths.newCharacter)).toEqual({ name: 'characters', mode: 'new' });
    expect(parseHash('#' + paths.importCards)).toEqual({ name: 'characters', mode: 'import' });
    expect(parseHash('#' + paths.editCharacter('char_1'))).toEqual({ name: 'characters', id: 'char_1', mode: 'edit' });
    expect(parseHash('#' + paths.character('char_1'))).toEqual({ name: 'characters', id: 'char_1' });
  });
});

describe('기록·알림 경로', () => {
  it('종류, 기록 하나, 새 기록, 내 프로필', () => {
    expect(parseHash('#' + paths.archive)).toEqual({ name: 'archive' });
    expect(parseHash('#' + paths.loreKind('person'))).toEqual({ name: 'archive', kind: 'person' });
    expect(parseHash('#' + paths.lore('item', 'lore_1'))).toEqual({ name: 'archive', kind: 'item', id: 'lore_1' });
    expect(parseHash('#' + paths.newLore('event'))).toEqual({ name: 'archive', kind: 'event', mode: 'new' });
    expect(parseHash('#' + paths.playerProfile)).toEqual({ name: 'archive', mode: 'profile' });
    expect(parseHash('#/archive/monster/x')).toEqual({ name: 'archive' });
    expect(parseHash('#' + paths.notices)).toEqual({ name: 'notices' });
  });
});

describe('프롬프트 경로', () => {
  it('목록과 편집', () => {
    expect(parseHash('#' + paths.prompts)).toEqual({ name: 'settings', sub: { kind: 'prompts' } });
    expect(parseHash('#' + paths.prompt('story-beat'))).toEqual({ name: 'settings', sub: { kind: 'prompts', id: 'story-beat' } });
  });
});
