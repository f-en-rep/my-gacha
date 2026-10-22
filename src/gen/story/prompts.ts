// 스토리 생성 프롬프트. 고치기 쉽게 여기에만 모아 둔다.
// 프롬프트는 영어, 결과 글은 월드 언어. 배경 그림 태그는 항상 영어 (인물 없음).
import type { ChatMessage } from '../text';
import type { Chapter, Character, Location, Segment, World } from '../../types';
import { languageName } from '../world/prompts';
import { MAX_NARRATION_CHARS, SEGMENT_LIMITS } from './schema';
import { JSON_ONLY, promptTemplate } from '../prompts/registry';
import { sectionsOf, type PromptCtx } from '../prompts/template';

/** 첫 문장 (최대 max 글자) */
export function firstSentence(text: string, max = 100): string {
  const s = text.trim().split(/(?<=[.!?。！？])\s+|\n+/)[0] ?? '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 월드 기본 정보. 지시문은 언제나 그대로, 최우선 */
export function worldBlock(world: World, short = false): string {
  const lines = [`World: ${world.name || '(untitled)'}`, `Setting:\n${short ? clip(world.description, 1200) : world.description.trim() || '(none)'}`];
  if (world.scenario.trim()) lines.push(`Premise / starting scenario:\n${short ? clip(world.scenario, 800) : world.scenario.trim()}`);
  if (world.directives.trim()) {
    lines.push(`AUTHOR DIRECTIVES — authoritative, they override everything else:\n${world.directives.trim()}`);
  }
  return lines.join('\n\n');
}

/** "지금까지의 이야기": 최근 recent개 챕터는 요약 전체, 그 전은 장부 한 줄씩 */
export function formatStorySoFar(chapters: Chapter[], recent = 4): string {
  const sorted = [...chapters].sort((a, b) => a.index - b.index);
  if (!sorted.length) return '';
  const cut = Math.max(0, sorted.length - recent);
  const older = sorted.slice(0, cut).map((c) => `- Ch.${c.index} "${c.title}": ${c.ledger?.trim() || firstSentence(c.summary ?? c.synopsis, 200)}`);
  const latest = sorted.slice(cut).map((c) => {
    const body = c.summary?.trim() ? c.summary.trim() : `(outline only, not recapped yet) ${c.synopsis.trim()}`;
    const ledger = c.ledger?.trim() ? `\n  Arc ledger: ${c.ledger.trim()}` : '';
    return `Ch.${c.index} "${c.title}":\n  ${body}${ledger}`;
  });
  const parts: string[] = [];
  if (older.length) parts.push(`Arc ledger of earlier chapters (one line each):\n${older.join('\n')}`);
  parts.push(`Most recent chapters:\n${latest.join('\n')}`);
  return parts.join('\n\n');
}

/** 플래너용 캐스트 한 줄 */
export function castPlanLine(c: Character): string {
  return (
    `- ${c.name} (${c.rarity}★, ${c.tags.role.join('/') || '-'}, ${c.tags.element || '-'}): ` +
    `looks: ${firstSentence(c.appearance, 90) || '-'} | personality: ${firstSentence(c.personality, 90) || '-'}`
  );
}

/** 장면 작가용 캐릭터 시트 */
export function castSheet(c: Character): string {
  const quotes = c.quotes.filter((q) => q.trim()).slice(0, 2);
  return [
    `- ${c.name} (${c.rarity}★, ${c.tags.role.join('/') || '-'}, ${c.tags.element || '-'})`,
    `  personality: ${clip(c.personality, 300) || '-'}`,
    `  appearance: ${firstSentence(c.appearance, 140) || '-'}`,
    quotes.length ? `  voice samples: ${quotes.map((q) => `"${clip(q, 120)}"`).join(' / ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 대본 한 줄 (이전 장면 꼬리, 챕터 마무리용) */
export function segmentLine(s: Segment, nameOf: (s: Segment) => string): string {
  if (s.kind === 'narration') return s.text;
  const who = nameOf(s) || '?';
  return s.kind === 'thought' ? `(${who}, thinking) ${s.text}` : `${who}: "${s.text}"`;
}

// ---------- 챕터 계획 ----------

/** 시스템 글: 고칠 수 있는 역할 + 고정된 JSON 지시 */
function systemOf(s: ReturnType<typeof sectionsOf>): ChatMessage {
  return { role: 'system', content: `${s.edit('persona')} ${s.lock('jsonOnly', JSON_ONLY)}` };
}

export interface PlanPromptInput {
  world: World;
  cast: Character[];
  locations: Location[];
  chapterIndex: number;
  nodeCount: number;
  storySoFar: string;
}

export function planMessages(input: PlanPromptInput, ctx?: PromptCtx): ChatMessage[] {
  const { world, cast, locations, chapterIndex, nodeCount, storySoFar } = input;
  const halfCast = Math.max(2, Math.ceil(cast.length / 2));
  const s = sectionsOf(promptTemplate('story-plan'), ctx, {
    language: languageName(world.language),
    world: world.name,
    chapter: chapterIndex,
    nodes: nodeCount,
    halfCast,
  });
  const system = systemOf(s);
  const locs = locations.length ? locations.map((l) => `- ${l.name}: ${firstSentence(l.description, 120)}`).join('\n') : '(none yet)';
  const user = [
    s.lock('task', `[task: story-plan chapter=${chapterIndex}]`),
    s.data('world', worldBlock(world)),
    `${s.lock('castRule', 'Cast (the ONLY named characters you may use; use the names exactly as written):')}\n${s.data('cast', cast.map(castPlanLine).join('\n') || '(none)')}`,
    `Existing locations:\n${s.data('locations', locs)}`,
    storySoFar ? `Story so far:\n${s.data('story', storySoFar)}` : s.edit('storyNone'),
    [
      s.edit('goal'),
      chapterIndex === 1 ? s.edit('firstChapter') : s.edit('continue'),
      s.edit('directives'),
      `${s.lock('nodeCount', `- Exactly ${nodeCount} nodes (scenes), in reading order.`)} ${s.edit('arc')}`,
      s.edit('castLimit'),
      s.edit('reuseLocations'),
      s.edit('synopsisRule'),
      s.edit('guideRule'),
      s.lock(
        'locationRule',
        `- node.location: either the exact name of an existing location (string), or a new location object {"name", "description" (one sentence), "imageTags" (English comma-separated scenery tags for an illustrator: place, architecture, time of day, weather, lighting — NO people, NO characters)}.`,
      ),
      `${s.edit('langRule')} ${s.lock('nameRule', 'Character names exactly as in the cast list. imageTags always in English.')}`,
    ].join('\n'),
    s.lock(
      'shape',
      `Reply with JSON:\n{"title": "...", "synopsis": "...", "nodes": [{"title": "...", "guide": "...", "cast": ["name", ...], "location": "existing name" | {"name": "...", "description": "...", "imageTags": "..."}}]}`,
    ),
  ].join('\n\n');
  return [system, { role: 'user', content: user }];
}

// ---------- 장면 본문 ----------

export interface BeatPromptInput {
  world: World;
  chapter: Chapter;
  index: number;
  cast: Character[];
  location?: Location;
  /** 이전 장면의 마지막 몇 토막 (대본 한 줄씩) */
  previousTail: string[];
  storySoFar: string;
}

export function beatMessages(input: BeatPromptInput, ctx?: PromptCtx): ChatMessage[] {
  const { world, chapter, index, cast, location, previousTail, storySoFar } = input;
  const node = chapter.nodes[index];
  if (!node) throw new Error(`no node ${index}`);
  const next = chapter.nodes[index + 1];
  const earlier = chapter.nodes.slice(0, index).map((n, i) => `${i + 1}. ${n.title} — ${firstSentence(n.guide, 160)}`);
  const s = sectionsOf(promptTemplate('story-beat'), ctx, {
    language: languageName(world.language),
    world: world.name,
    chapter: chapter.index,
    scene: index + 1,
    scenes: chapter.nodes.length,
    next: next ? firstSentence(next.guide, 200) : '',
    maxNarration: MAX_NARRATION_CHARS,
  });
  const system = systemOf(s);

  const user = [
    s.lock('task', `[task: story-beat chapter=${chapter.index} scene=${index + 1}/${chapter.nodes.length}]`),
    s.data('world', worldBlock(world, true)),
    storySoFar ? `Previous chapters:\n${s.data('story', storySoFar)}` : '',
    s.data('chapter', `This chapter (Ch.${chapter.index}): "${chapter.title}"\nSynopsis: ${chapter.synopsis}`),
    earlier.length ? `Scenes already written in this chapter:\n${s.data('earlier', earlier.join('\n'))}` : s.edit('firstScene'),
    previousTail.length ? `${s.edit('tailIntro')}\n${s.data('tail', previousTail.join('\n'))}` : '',
    [
      s.data(
        'scene',
        [`NOW WRITE scene ${index + 1}: "${node.title}"`, `Guide: ${node.guide}`, `Location: ${location ? `${location.name} — ${location.description}` : '(unspecified)'}`].join('\n'),
      ),
      cast.length ? `Named characters in this scene:\n${s.data('cast', cast.map(castSheet).join('\n'))}` : s.edit('noCast'),
    ].join('\n'),
    next ? s.edit('nextDirection') : s.edit('lastScene'),
    [
      'Rules:',
      `${s.lock('segmentCount', `- ${SEGMENT_LIMITS.ask.min}–${SEGMENT_LIMITS.ask.max} segments.`)} ${s.edit('pacing')}`,
      s.lock('kinds', '- kind: "narration" (no speaker), "line" (spoken aloud, needs speaker), "thought" (inner voice, needs speaker).'),
      `${s.lock('speaker', '- speaker: the exact cast name.')} ${s.edit('extras')}`,
      s.edit('voice'),
      s.edit('continuity'),
      s.edit('langRule'),
    ].join('\n'),
    s.lock(
      'shape',
      'Reply with JSON:\n{"segments": [{"kind": "narration", "text": "..."}, {"kind": "line", "speaker": "name", "text": "..."}, {"kind": "thought", "speaker": "name", "text": "..."}]}',
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
  return [system, { role: 'user', content: user }];
}

// ---------- 챕터 마무리 ----------

export interface FinishPromptInput {
  world: World;
  chapter: Chapter;
  /** 장면별 대본 */
  scenes: { title: string; lines: string[] }[];
  storySoFar: string;
}

export function finishMessages(input: FinishPromptInput, ctx?: PromptCtx): ChatMessage[] {
  const { world, chapter, scenes, storySoFar } = input;
  const s = sectionsOf(promptTemplate('story-finish'), ctx, { language: languageName(world.language), world: world.name, chapter: chapter.index });
  const system = systemOf(s);
  const script = scenes.length
    ? scenes.map((sc, i) => `## Scene ${i + 1}: ${sc.title}\n${sc.lines.join('\n')}`).join('\n\n')
    : `(scenes not available; outline) ${chapter.synopsis}`;
  const user = [
    s.lock('task', `[task: story-recap chapter=${chapter.index}]`),
    world.directives.trim() ? `Author directives (the ledger exists to track them):\n${s.data('directives', world.directives.trim())}` : '',
    storySoFar ? `Story before this chapter:\n${s.data('story', storySoFar)}` : '',
    s.data('chapter', `Chapter ${chapter.index}: "${chapter.title}"\nPlanned synopsis: ${chapter.synopsis}`),
    `Full script of the chapter:\n${s.data('script', script)}`,
    ['Write:', s.edit('summaryRule'), s.edit('ledgerRule'), s.edit('langRule')].join('\n'),
    s.lock('shape', 'Reply with JSON:\n{"summary": "...", "ledger": "..."}'),
  ]
    .filter(Boolean)
    .join('\n\n');
  return [system, { role: 'user', content: user }];
}
