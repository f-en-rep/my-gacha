// 스토리 답변 검사 (zod). 월드 생성과 같은 방식: 너그럽게 받아 정규화하고, 정말 틀린 것만 재시도 피드백으로.
import { z, type ZodType } from 'zod';
import type { SegmentKind } from '../../types';
import { cleanTags, looseList, looseStr, pick } from '../world/schema';
import { matchTag, normTag } from '../world/tags';

type Obj = Record<string, unknown>;
type Ctx = z.RefinementCtx;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asSchema<T>(s: z.ZodType<T, z.ZodTypeDef, unknown>): ZodType<T> {
  return s as unknown as ZodType<T>;
}

function issue(ctx: Ctx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

/** 객체 안에서 목록을 찾는다 (키 이름이 조금 달라도, 한 겹 감싸져 있어도) */
function findList(raw: unknown, ...aliases: string[]): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (!isObj(raw)) return undefined;
  const direct = pick(raw, ...aliases);
  if (Array.isArray(direct)) return direct;
  for (const v of Object.values(raw)) {
    if (isObj(v)) {
      const inner = pick(v, ...aliases);
      if (Array.isArray(inner)) return inner;
    }
  }
  return undefined;
}

/** 이름 비교용 (대소문자·공백·문장부호 무시) */
export function normName(s: string): string {
  return normTag(s);
}

/** 사람(인물) 태그: 배경 그림에는 넣지 않는다 */
const PEOPLE_TAG =
  /^(\d+\+?\s*(girl|boy|other)s?|solo|solo focus|multiple (girls|boys)|girl|boy|woman|man|women|men|people|person|crowd|character|portrait|looking at viewer|upper body|cowboy shot|full body)$/i;

/** 배경용 영어 태그로 정리: ASCII만, 인물 태그 제거 */
export function sceneryTags(v: unknown): string {
  const { ascii } = cleanTags(looseList(v, /[,\n]/));
  return ascii.filter((t) => !PEOPLE_TAG.test(t)).join(', ');
}

// ---------- 챕터 계획 ----------

export type LocationRef = { kind: 'existing'; name: string } | { kind: 'new'; name: string; description: string; imageTags: string };

export interface NodeDraft {
  title: string;
  guide: string;
  /** 캐스트 이름 (정규화된 원래 이름). 모르는 이름은 빠진다 */
  cast: string[];
  location: LocationRef;
}

export interface PlanDraft {
  title: string;
  synopsis: string;
  nodes: NodeDraft[];
}

export interface PlanSchemaOptions {
  nodeCount: number;
  castNames: string[];
  locationNames: string[];
  /** 한 장면에 이름 있는 인물 최대 수 */
  maxCastPerNode?: number;
}

/** 캐스트 이름 맞추기 (월드 생성의 태그 맞추기와 같은 너그러움). 못 맞추면 undefined */
export function matchName(value: string, names: readonly string[]): string | undefined {
  return matchTag(value, names);
}

export function planSchema(opts: PlanSchemaOptions): ZodType<PlanDraft> {
  const maxCast = opts.maxCastPerNode ?? 3;
  return asSchema(
    z.unknown().transform((raw, ctx): PlanDraft => {
      const obj: Obj = isObj(raw) ? (isObj(pick(raw, 'chapter')) ? (pick(raw, 'chapter') as Obj) : raw) : {};
      const title = looseStr(pick(obj, 'title', 'chapterTitle', 'name'));
      const synopsis = looseStr(pick(obj, 'synopsis', 'summary', 'plot', 'outline'));
      if (!title) issue(ctx, ['title'], 'missing chapter title');
      if (!synopsis) issue(ctx, ['synopsis'], 'missing synopsis (3–5 sentences)');

      const rawNodes = findList(raw, 'nodes', 'scenes', 'beats') ?? [];
      if (rawNodes.length < opts.nodeCount) {
        issue(ctx, ['nodes'], `need exactly ${opts.nodeCount} nodes, got ${rawNodes.length}`);
        return { title, synopsis, nodes: [] };
      }

      // 이번 계획에서 새로 만든 장소도 뒤 장면에서 이름으로 부를 수 있다
      const known = [...opts.locationNames];
      const nodes: NodeDraft[] = [];
      rawNodes.slice(0, opts.nodeCount).forEach((n, i) => {
        const o: Obj = isObj(n) ? n : { guide: looseStr(n) };
        const nodeTitle = looseStr(pick(o, 'title', 'name', 'sceneTitle'));
        const guide = looseStr(pick(o, 'guide', 'description', 'summary', 'content', 'events', 'plan'));
        if (!nodeTitle) issue(ctx, ['nodes', i, 'title'], 'missing title');
        if (!guide) issue(ctx, ['nodes', i, 'guide'], 'missing guide');

        const cast: string[] = [];
        for (const name of looseList(pick(o, 'cast', 'characters', 'castNames', 'appearing'))) {
          const m = matchName(name, opts.castNames);
          if (m && !cast.includes(m)) cast.push(m);
        }

        const location = readLocation(pick(o, 'location', 'place', 'setting', 'locationName'), known);
        if (!location) {
          issue(
            ctx,
            ['nodes', i, 'location'],
            `unknown location. Use the exact name of an existing location (${opts.locationNames.join(', ') || 'none yet'}) or an object {name, description, imageTags} for a new one`,
          );
          return;
        }
        if (location.kind === 'new') known.push(location.name);
        nodes.push({ title: nodeTitle, guide, cast: cast.slice(0, maxCast), location });
      });
      return { title, synopsis, nodes };
    }),
  );
}

function readLocation(v: unknown, known: string[]): LocationRef | undefined {
  if (typeof v === 'string' || typeof v === 'number') {
    const s = String(v).trim();
    const exact = known.find((k) => normName(k) === normName(s));
    const m = exact ?? (s ? matchTag(s, known) : undefined);
    return m ? { kind: 'existing', name: m } : undefined;
  }
  if (!isObj(v)) return undefined;
  const name = looseStr(pick(v, 'name', 'title', 'location'));
  if (!name) return undefined;
  const exact = known.find((k) => normName(k) === normName(name));
  const description = looseStr(pick(v, 'description', 'desc', 'details'));
  const imageTags = sceneryTags(pick(v, 'imageTags', 'tags', 'image', 'sceneryTags'));
  // 이름만 있는 객체 = 기존 장소를 부른 것
  if (exact) return { kind: 'existing', name: exact };
  if (!description && !imageTags) {
    const m = matchTag(name, known);
    return m ? { kind: 'existing', name: m } : undefined;
  }
  return { kind: 'new', name, description, imageTags: imageTags || 'scenery' };
}

// ---------- 장면 본문 ----------

export interface SegmentDraft {
  kind: SegmentKind;
  speaker?: string;
  text: string;
}

export const SEGMENT_LIMITS = { ask: { min: 18, max: 40 }, accept: { min: 8, max: 80 } } as const;
/** 지문 한 토막 최대 길이 (넘으면 문장 단위로 나눈다) */
export const MAX_NARRATION_CHARS = 220;

const NARRATOR = new Set(['narrator', 'narration', 'none', 'null', '', '나레이션', '내레이션', '해설', '지문', 'ナレーション', '旁白']);

function readKind(v: unknown, hasSpeaker: boolean): SegmentKind {
  const k = normName(looseStr(v));
  if (/^(thought|think|thinking|monologue|inner|innermonologue|mind|속마음|생각|독백|心の声|内心)/.test(k)) return 'thought';
  if (/^(narration|narrator|narrative|description|desc|action|scene|지문|나레이션|내레이션|서술|ナレーション|地の文|旁白)/.test(k)) return 'narration';
  if (/^(line|dialogue|dialog|speech|say|says|talk|quote|대사|セリフ|台词)/.test(k)) return 'line';
  return hasSpeaker ? 'line' : 'narration';
}

/** 긴 글을 문장 단위로 max 이하 조각으로 나눈다 */
export function splitLong(text: string, max = MAX_NARRATION_CHARS): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?。！？…\n]+(?:[.!?。！？…]+["'”’」』)]*|\n|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const out: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur) out.push(cur);
    cur = '';
  };
  for (const s of sentences) {
    if (s.length > max) {
      flush();
      // 문장 하나가 너무 길면 공백에서 자른다
      let rest = s;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(' ', max);
        if (cut < max / 2) cut = max;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      cur = rest;
      continue;
    }
    if (cur && cur.length + 1 + s.length > max) flush();
    cur = cur ? `${cur} ${s}` : s;
  }
  flush();
  return out.filter(Boolean);
}

export function beatSchema(): ZodType<SegmentDraft[]> {
  return asSchema(
    z.unknown().transform((raw, ctx): SegmentDraft[] => {
      const list = findList(raw, 'segments', 'script', 'lines', 'dialogue', 'scene');
      if (!list) {
        issue(ctx, ['segments'], 'missing "segments" array');
        return [];
      }
      const out: SegmentDraft[] = [];
      for (const item of list) {
        let o: Obj;
        if (isObj(item)) o = item;
        else if (typeof item === 'string') o = { text: item };
        else continue;
        let speaker = looseStr(pick(o, 'speaker', 'name', 'character', 'who', 'speakerName'));
        const text = looseStr(pick(o, 'text', 'content', 'line', 'dialogue', 'narration', 'thought', 'value'));
        if (!text) continue;
        if (NARRATOR.has(normName(speaker))) speaker = '';
        let kind = readKind(pick(o, 'kind', 'type', 'mode'), !!speaker);
        // 말하는 사람 없는 대사·속마음은 지문으로
        if (kind !== 'narration' && !speaker) kind = 'narration';
        if (kind === 'narration') {
          for (const part of splitLong(text)) out.push({ kind, text: part });
        } else {
          out.push({ kind, speaker, text });
        }
      }
      if (out.length < SEGMENT_LIMITS.accept.min) {
        issue(ctx, ['segments'], `too few segments (${out.length}); write ${SEGMENT_LIMITS.ask.min}–${SEGMENT_LIMITS.ask.max}`);
      }
      return out.slice(0, SEGMENT_LIMITS.accept.max);
    }),
  );
}

// ---------- 챕터 마무리 ----------

/** 기록 한 줄 (사건 제목·인물 이름·물건 이름 + 한두 줄) */
export interface LoreLine {
  name: string;
  summary: string;
}

export interface FinishDraft {
  summary: string;
  ledger: string;
  events: LoreLine[];
  people: LoreLine[];
  items: LoreLine[];
}

/** 기록 목록 읽기. 없거나 틀려도 실패로 보지 않는다 (요약이 더 중요하다). 문자열이면 "이름: 설명"으로 */
function readLore(v: unknown, max: number): LoreLine[] {
  const list = Array.isArray(v) ? v : isObj(v) ? Object.entries(v).map(([name, summary]) => ({ name, summary })) : [];
  const out: LoreLine[] = [];
  for (const item of list) {
    let name = '';
    let summary = '';
    if (isObj(item)) {
      name = looseStr(pick(item, 'name', 'title', 'event', 'person', 'item'));
      summary = looseStr(pick(item, 'summary', 'description', 'desc', 'note', 'details', 'role'));
    } else if (typeof item === 'string') {
      const m = /^\s*([^:：—-]{1,60})\s*[:：—-]\s*(.+)$/.exec(item);
      name = m ? m[1]!.trim() : item.trim();
      summary = m ? m[2]!.trim() : '';
    }
    if (!name) continue;
    if (!out.some((o) => normName(o.name) === normName(name))) out.push({ name, summary });
    if (out.length >= max) break;
  }
  return out;
}

/** 챕터 하나에서 받는 기록 수 상한 */
export const LORE_PER_CHAPTER = { events: 3, people: 8, items: 8 } as const;

export function finishSchema(): ZodType<FinishDraft> {
  return asSchema(
    z.unknown().transform((raw, ctx): FinishDraft => {
      const obj: Obj = isObj(raw) ? raw : {};
      const summary = looseStr(pick(obj, 'summary', 'recap', 'synopsis'));
      const ledger = looseStr(pick(obj, 'ledger', 'arc', 'arcLine', 'ledgerLine', 'oneLine')).replace(/\s*\n+\s*/g, ' ');
      if (!summary) issue(ctx, ['summary'], 'missing summary');
      if (!ledger) issue(ctx, ['ledger'], 'missing ledger line');
      return {
        summary,
        ledger,
        events: readLore(pick(obj, 'events', 'majorEvents', 'event'), LORE_PER_CHAPTER.events),
        people: readLore(pick(obj, 'people', 'persons', 'characters', 'npcs', 'person'), LORE_PER_CHAPTER.people),
        items: readLore(pick(obj, 'items', 'objects', 'item'), LORE_PER_CHAPTER.items),
      };
    }),
  );
}
