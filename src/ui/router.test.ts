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

describe('프롬프트 경로', () => {
  it('목록과 편집', () => {
    expect(parseHash('#' + paths.prompts)).toEqual({ name: 'settings', sub: { kind: 'prompts' } });
    expect(parseHash('#' + paths.prompt('story-beat'))).toEqual({ name: 'settings', sub: { kind: 'prompts', id: 'story-beat' } });
  });
});
