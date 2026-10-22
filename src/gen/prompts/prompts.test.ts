import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, db } from '../../db';
import { bannerMetaMessages, cardMessages, characterMessages, setupMessages } from '../world/prompts';
import { beatMessages, finishMessages, planMessages } from '../story/prompts';
import { chatMessages } from '../chat/prompts';
import { PROMPT_TEMPLATES, promptCtx, promptTemplate, type PromptId } from './index';
import { cleanOverrides, fill, type PromptCtx, type TraceEntry } from './template';
import { SAMPLE_PREVIEW, previewMessages } from './preview';
import { SAMPLE_CARD, SAMPLE_CAST, SAMPLE_CHAPTERS, SAMPLE_CHAT, SAMPLE_LOCATIONS, SAMPLE_WORLD } from './sample';

const ch = SAMPLE_CHAPTERS[0]!;
const bare = { ...SAMPLE_WORLD, language: 'xx', directives: '' };

/** 모든 갈래를 한 번씩 지나가게 만든 입력들 */
function allVariants(ctxFor: (id: PromptId) => PromptCtx) {
  const w = SAMPLE_WORLD;
  setupMessages(bare, { askName: true, askArt: true }, ctxFor('world-setup'));
  characterMessages(w, SAMPLE_CAST, { rarity: 6, count: 1, detail: 'full', brief: '축제', name: '리라', concept: '음유시인' }, ctxFor('characters'));
  for (const r of [5, 4, 3] as const) characterMessages(w, [], { rarity: r, count: 2, detail: 'light' }, ctxFor('characters'));
  cardMessages(w, SAMPLE_CAST, SAMPLE_CARD, { askRarity: true }, ctxFor('card'));
  bannerMetaMessages(w, { featuredNames: ['아린'], brief: '여름' }, ctxFor('banner'));
  bannerMetaMessages(w, { featuredNames: [] }, ctxFor('banner'));
  for (const chapterIndex of [1, 2]) planMessages({ world: w, cast: SAMPLE_CAST, locations: [], chapterIndex, nodeCount: 6, storySoFar: chapterIndex > 1 ? 'x' : '' }, ctxFor('story-plan'));
  for (const index of [0, 1, 2])
    beatMessages({ world: w, chapter: ch, index, cast: index === 2 ? [] : SAMPLE_CAST, previousTail: index ? ['a'] : [], storySoFar: 'x' }, ctxFor('story-beat'));
  finishMessages({ world: w, chapter: ch, scenes: [], storySoFar: 'x' }, ctxFor('story-finish'));
  for (const playerName of ['유리', undefined])
    chatMessages({ world: w, character: SAMPLE_CAST[0]!, playerName, stance: 's', level: 1, storySoFar: 'x', history: SAMPLE_CHAT }, ctxFor('chat'));
}

describe('프롬프트 목록', () => {
  it('칸 key가 겹치지 않고, 고칠 칸에는 기본 글이 있다', () => {
    for (const t of PROMPT_TEMPLATES) {
      const keys = t.sections.map((s) => s.key);
      expect(new Set(keys).size, t.id).toBe(keys.length);
      for (const s of t.sections) if (s.kind === 'edit') expect(s.text, `${t.id}.${s.key}`).toBeTruthy();
    }
  });

  it('목록의 칸은 전부 실제 프롬프트에 쓰인다', () => {
    const seen = new Map<string, TraceEntry[]>();
    allVariants((id) => {
      const trace = seen.get(id) ?? [];
      seen.set(id, trace);
      return { trace };
    });
    for (const t of PROMPT_TEMPLATES) {
      const used = new Set(seen.get(t.id)?.map((e) => e.key));
      for (const s of t.sections) expect(used.has(s.key), `${t.id}.${s.key}`).toBe(true);
    }
  });

  it('변수 안내에 없는 {{변수}}를 기본 글에 쓰지 않는다', () => {
    for (const t of PROMPT_TEMPLATES) {
      const known = new Set(t.vars.map((v) => v.name));
      for (const s of t.sections)
        for (const m of (s.text ?? '').matchAll(/\{\{(\w+)\}\}/g)) expect(known.has(m[1]!), `${t.id}.${s.key} {{${m[1]}}}`).toBe(true);
    }
  });
});

describe('변수 채우기', () => {
  it('아는 것만 바꾸고 모르는 것은 그대로', () => {
    expect(fill('{{a}} {{ b }} {{c}} {a}', { a: 1, b: 'x' })).toBe('1 x {{c}} {a}');
  });
  it('넣은 값 안의 {{...}}와 $는 다시 건드리지 않는다', () => {
    expect(fill('{{a}}{{b}}', { a: '{{b}}', b: '$&' })).toBe('{{b}}$&');
  });
});

describe('고친 글', () => {
  const chatInput = { world: SAMPLE_WORLD, character: SAMPLE_CAST[0]!, playerName: '유리', stance: '동료', level: 3, storySoFar: '', history: SAMPLE_CHAT };

  it('고친 칸만 바뀌고 나머지는 그대로', () => {
    const base = chatMessages(chatInput);
    const out = chatMessages(chatInput, { overrides: { persona: 'Be {{char}} talking to {{user}} in {{language}} at {{level}}. {{nope}}' } });
    expect(out[0]!.content.startsWith('Be 아린 talking to 유리 in Korean (한국어) at 3. {{nope}}\n\n')).toBe(true);
    expect(out[0]!.content.slice(out[0]!.content.indexOf('\n\n'))).toBe(base[0]!.content.slice(base[0]!.content.indexOf('\n\n')));
    expect(out.slice(1)).toEqual(base.slice(1));
  });

  it('이름이 없으면 {{user}}는 중립 호칭', () => {
    const out = chatMessages({ ...chatInput, playerName: undefined }, { overrides: { playerUnnamed: 'Call them {{user}}.' } });
    expect(out[0]!.content).toContain('THE PLAYER\nCall them 당신.');
  });

  it('빈 칸, 공백, 기본값과 같은 글은 고치지 않은 것', () => {
    const tpl = promptTemplate('story-beat');
    const def = tpl.sections.find((s) => s.key === 'voice')!.text!;
    const base = beatMessages({ world: SAMPLE_WORLD, chapter: ch, index: 0, cast: SAMPLE_CAST, previousTail: [], storySoFar: '' });
    const ov = { voice: def, continuity: '  \n', langRule: '' };
    expect(beatMessages({ world: SAMPLE_WORLD, chapter: ch, index: 0, cast: SAMPLE_CAST, previousTail: [], storySoFar: '' }, { overrides: ov })).toEqual(base);
    expect(cleanOverrides(tpl, ov)).toBeUndefined();
  });

  it('잠긴 칸과 모르는 칸은 고칠 수 없다', () => {
    const tpl = promptTemplate('characters');
    expect(cleanOverrides(tpl, { shape: 'x', task: 'y', world: 'z', what: 'w', persona: 'P' })).toEqual({ persona: 'P' });
    const out = characterMessages(SAMPLE_WORLD, [], { rarity: 6, count: 1, detail: 'full' }, { overrides: { shape: 'HACK', task: 'HACK' } });
    expect(out[1]!.content).not.toContain('HACK');
    expect(out[1]!.content).toContain('[task: characters rarity=6 count=1]');
  });

  it('JSON 지시는 역할 글을 고쳐도 남는다', () => {
    const out = planMessages(
      { world: SAMPLE_WORLD, cast: SAMPLE_CAST, locations: SAMPLE_LOCATIONS, chapterIndex: 2, nodeCount: 6, storySoFar: 'x' },
      { overrides: { persona: 'You plan {{world}} chapter {{chapter}}.', arc: 'Make it sad.' } },
    );
    expect(out[0]!.content).toBe('You plan 아스트라 chapter 2. Always answer with a single JSON object only — no explanations, no markdown, no code fences.');
    expect(out[1]!.content).toContain('- Exactly 6 nodes (scenes), in reading order. Make it sad.');
  });

  it('설정에 저장된 고친 글을 읽는다', async () => {
    await db.delete();
    await db.open();
    expect(await promptCtx('chat')).toEqual({});
    await db.settings.put({ ...DEFAULT_SETTINGS, prompts: { chat: { persona: 'Hi {{char}}', style: '   ' }, 'story-beat': { shape: 'x' } } });
    expect(await promptCtx('chat')).toEqual({ overrides: { persona: 'Hi {{char}}' } });
    expect(await promptCtx('story-beat')).toEqual({});
  });
});

describe('미리 보기', () => {
  it('예시 데이터로 모든 프롬프트를 만든다', () => {
    for (const t of PROMPT_TEMPLATES) {
      const { messages, trace } = previewMessages(t.id as PromptId, undefined, SAMPLE_PREVIEW);
      expect(messages.length, t.id).toBeGreaterThan(1);
      expect(trace.length, t.id).toBeGreaterThan(0);
      expect(messages.map((m) => m.content).join('\n'), t.id).not.toMatch(/undefined|\{\{\w+\}\}/);
    }
  });
  it('캐릭터 없는 월드도 만든다', () => {
    const d = { ...SAMPLE_PREVIEW, world: { ...SAMPLE_WORLD, id: 'w2' }, cast: [], chapters: [], locations: [] };
    for (const t of PROMPT_TEMPLATES) expect(() => previewMessages(t.id as PromptId, undefined, d), t.id).not.toThrow();
  });
});
