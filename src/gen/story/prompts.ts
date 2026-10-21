// 스토리 생성 프롬프트. 고치기 쉽게 여기에만 모아 둔다.
// 프롬프트는 영어, 결과 글은 월드 언어. 배경 그림 태그는 항상 영어 (인물 없음).
import type { ChatMessage } from '../text';
import type { Chapter, Character, Location, Segment, World } from '../../types';
import { languageName } from '../world/prompts';
import { MAX_NARRATION_CHARS, SEGMENT_LIMITS } from './schema';

const JSON_ONLY = 'Always answer with a single JSON object only — no explanations, no markdown, no code fences.';

const SYSTEM_PLANNER =
  'You are the head writer of an anime-style gacha game (think Arknights) planning its main story chapter by chapter. ' +
  'You keep long-running continuity, honour the author directives exactly, and give every chapter a clear shape. ' +
  JSON_ONLY;

const SYSTEM_WRITER =
  'You are the scenario writer of an anime-style gacha game, writing visual-novel scenes (think Arknights or Blue Archive story mode). ' +
  'Your prose is vivid but easy to read on a phone, characters sound like themselves, and every scene moves the story. ' +
  JSON_ONLY;

const SYSTEM_EDITOR =
  'You are the story editor of an anime-style gacha game. You write precise recaps that later writers rely on for continuity. ' + JSON_ONLY;

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

export interface PlanPromptInput {
  world: World;
  cast: Character[];
  locations: Location[];
  chapterIndex: number;
  nodeCount: number;
  storySoFar: string;
}

export function planMessages(input: PlanPromptInput): ChatMessage[] {
  const { world, cast, locations, chapterIndex, nodeCount, storySoFar } = input;
  const lang = languageName(world.language);
  const halfCast = Math.max(2, Math.ceil(cast.length / 2));
  const locs = locations.length ? locations.map((l) => `- ${l.name}: ${firstSentence(l.description, 120)}`).join('\n') : '(none yet)';
  const user = [
    `[task: story-plan chapter=${chapterIndex}]`,
    worldBlock(world),
    `Cast (the ONLY named characters you may use; use the names exactly as written):\n${cast.map(castPlanLine).join('\n') || '(none)'}`,
    `Existing locations:\n${locs}`,
    storySoFar ? `Story so far:\n${storySoFar}` : 'Story so far: nothing yet — this is the very first chapter.',
    [
      `Plan chapter ${chapterIndex}.`,
      chapterIndex === 1
        ? '- This is chapter 1: introduce the premise of the starting scenario and the main situation the player is thrown into.'
        : `- Continue directly from the story so far. Keep continuity: what happened stays happened, the dead stay dead, relationships carry over. Do not repeat earlier chapters.`,
      `- Re-read the author directives. If a directive is periodic or conditional (e.g. "someone dies every three chapters"), use the chapter numbers and the arc ledger above to decide whether chapter ${chapterIndex} must fulfil it, and if so plan it explicitly.`,
      `- Exactly ${nodeCount} nodes (scenes), in reading order. Together they form one chapter with a beginning, rising tension and a closing hook.`,
      `- Use about half of the cast at most in this chapter (≤ ${halfCast} different named characters), at most 3 named characters per node. A node with no named character (narration, unnamed extras, the player alone) is fine.`,
      '- Prefer reusing existing locations; invent a new one only when the story needs it.',
      `- synopsis: 3–5 sentences describing the whole chapter.`,
      `- node.guide: 2–4 sentences of instructions for the scene writer: what happens, the emotional turn, how it ends.`,
      `- node.location: either the exact name of an existing location (string), or a new location object {"name", "description" (one sentence), "imageTags" (English comma-separated scenery tags for an illustrator: place, architecture, time of day, weather, lighting — NO people, NO characters)}.`,
      `- Write title, synopsis, guides, location names and descriptions in ${lang}. Character names exactly as in the cast list. imageTags always in English.`,
    ].join('\n'),
    `Reply with JSON:\n{"title": "...", "synopsis": "...", "nodes": [{"title": "...", "guide": "...", "cast": ["name", ...], "location": "existing name" | {"name": "...", "description": "...", "imageTags": "..."}}]}`,
  ].join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PLANNER },
    { role: 'user', content: user },
  ];
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

export function beatMessages(input: BeatPromptInput): ChatMessage[] {
  const { world, chapter, index, cast, location, previousTail, storySoFar } = input;
  const lang = languageName(world.language);
  const node = chapter.nodes[index];
  if (!node) throw new Error(`no node ${index}`);
  const next = chapter.nodes[index + 1];
  const earlier = chapter.nodes.slice(0, index).map((n, i) => `${i + 1}. ${n.title} — ${firstSentence(n.guide, 160)}`);

  const user = [
    `[task: story-beat chapter=${chapter.index} scene=${index + 1}/${chapter.nodes.length}]`,
    worldBlock(world, true),
    storySoFar ? `Previous chapters:\n${storySoFar}` : '',
    `This chapter (Ch.${chapter.index}): "${chapter.title}"\nSynopsis: ${chapter.synopsis}`,
    earlier.length ? `Scenes already written in this chapter:\n${earlier.join('\n')}` : 'This is the first scene of the chapter.',
    previousTail.length ? `The previous scene ended like this (continue seamlessly from here):\n${previousTail.join('\n')}` : '',
    [
      `NOW WRITE scene ${index + 1}: "${node.title}"`,
      `Guide: ${node.guide}`,
      `Location: ${location ? `${location.name} — ${location.description}` : '(unspecified)'}`,
      cast.length ? `Named characters in this scene:\n${cast.map(castSheet).join('\n')}` : 'No named cast member appears in this scene; use narration and, if needed, unnamed extras.',
    ].join('\n'),
    next
      ? `Direction for the ending (do NOT reveal or start it, just lead toward it): the next scene will be about — ${firstSentence(next.guide, 200)}`
      : 'This is the last scene of the chapter: close the chapter with a satisfying beat and a hook for what comes next.',
    [
      'Rules:',
      `- ${SEGMENT_LIMITS.ask.min}–${SEGMENT_LIMITS.ask.max} segments. Visual-novel pacing: each segment is ONE beat of action or ONE line of dialogue, short (narration ≤ 2 sentences, under ${MAX_NARRATION_CHARS} characters).`,
      '- kind: "narration" (no speaker), "line" (spoken aloud, needs speaker), "thought" (inner voice, needs speaker).',
      '- speaker: the exact cast name. An unnamed or minor character may speak with a short descriptive name (e.g. "Guard"). Named cast members who are not listed for this scene should not appear.',
      '- Keep each character in voice (see voice samples). Show, do not tell. No meta commentary, no scene headings, no quotation marks around line text.',
      '- Follow the author directives and stay consistent with the previous chapters.',
      `- Write all text and non-cast speaker names in ${lang}.`,
    ].join('\n'),
    'Reply with JSON:\n{"segments": [{"kind": "narration", "text": "..."}, {"kind": "line", "speaker": "name", "text": "..."}, {"kind": "thought", "speaker": "name", "text": "..."}]}',
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: SYSTEM_WRITER },
    { role: 'user', content: user },
  ];
}

// ---------- 챕터 마무리 ----------

export interface FinishPromptInput {
  world: World;
  chapter: Chapter;
  /** 장면별 대본 */
  scenes: { title: string; lines: string[] }[];
  storySoFar: string;
}

export function finishMessages(input: FinishPromptInput): ChatMessage[] {
  const { world, chapter, scenes, storySoFar } = input;
  const lang = languageName(world.language);
  const script = scenes.length
    ? scenes.map((s, i) => `## Scene ${i + 1}: ${s.title}\n${s.lines.join('\n')}`).join('\n\n')
    : `(scenes not available; outline) ${chapter.synopsis}`;
  const user = [
    `[task: story-recap chapter=${chapter.index}]`,
    world.directives.trim() ? `Author directives (the ledger exists to track them):\n${world.directives.trim()}` : '',
    storySoFar ? `Story before this chapter:\n${storySoFar}` : '',
    `Chapter ${chapter.index}: "${chapter.title}"\nPlanned synopsis: ${chapter.synopsis}`,
    `Full script of the chapter:\n${script}`,
    [
      'Write:',
      '- summary: 5–8 sentences. What actually happened (as written, not as planned), who changed and how (relationships, injuries, deaths, revelations, decisions), and open threads. Use character names.',
      '- ledger: ONE line stating what this chapter did to the overall arc (e.g. "X died; the alliance broke; the gate was found"). It will be used to keep periodic author directives on schedule, so mention any event a directive cares about.',
      `- Write both in ${lang}.`,
    ].join('\n'),
    'Reply with JSON:\n{"summary": "...", "ledger": "..."}',
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: SYSTEM_EDITOR },
    { role: 'user', content: user },
  ];
}
