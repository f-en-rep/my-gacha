// 모델 답변 검사 (zod). 너그럽게 받아서 정규화하고, 정말 틀린 것만 재시도 피드백으로 돌려보낸다.
import { z, type ZodType } from 'zod';
import type { ArtStyle, CurrencyNames, TagCatalog } from '../../types';
import { ARCHETYPES, type Archetype } from './stats';
import { defaultTraits, knownPositions, matchPosition, matchTag, normTag } from './tags';

// ---------- 느슨한 값 읽기 ----------

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function keyNorm(k: string): string {
  return k.toLowerCase().replace(/[\s_\-]+/g, '');
}

/** 이름이 조금 다른 키도 받아 준다 (image_tags, ImageTags, imagetags ...) */
export function pick(obj: Obj, ...aliases: string[]): unknown {
  const want = aliases.map(keyNorm);
  for (const w of want) {
    for (const [k, v] of Object.entries(obj)) if (keyNorm(k) === w && v !== undefined && v !== null) return v;
  }
  return undefined;
}

/** 문자열 하나로. 숫자는 글자로, 배열은 이어 붙임 */
export function looseStr(v: unknown, joiner = ' '): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => looseStr(x, joiner)).filter(Boolean).join(joiner);
  if (isObj(v)) {
    const inner = pick(v, 'text', 'value', 'name', 'line', 'quote');
    if (inner !== undefined) return looseStr(inner, joiner);
  }
  return '';
}

/** 문자열 목록으로. 문자열이면 split으로 나눈다 */
export function looseList(v: unknown, split: RegExp = /[,\n、，;；]/): string[] {
  let items: string[];
  if (Array.isArray(v)) items = v.map((x) => looseStr(x));
  else if (typeof v === 'string') items = v.split(split);
  else if (v === undefined || v === null) items = [];
  else items = [looseStr(v)];
  return items.map((s) => s.trim()).filter(Boolean);
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = normTag(s) || s;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 숫자 또는 "6★", "6 star" 같은 글자에서 숫자 */
export function looseInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const m = /\d+/.exec(v);
    if (m) return Number(m[0]);
    const stars = (v.match(/★|☆|\*/g) ?? []).length;
    if (stars) return stars;
  }
  return undefined;
}

/** zod transform 결과(입력 unknown)를 generateJson이 받는 타입으로 */
function asSchema<T>(s: z.ZodType<T, z.ZodTypeDef, unknown>): ZodType<T> {
  return s as unknown as ZodType<T>;
}

type Ctx = z.RefinementCtx;
function issue(ctx: Ctx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

// ---------- 세계 설정 ----------

export interface SetupResult {
  name?: string;
  tags: TagCatalog;
  currency: CurrencyNames;
  art?: ArtStyle;
  standardBannerName: string;
}

export interface SetupSchemaOptions {
  language: string;
  askName: boolean;
  askArt: boolean;
}

export const ROLE_COUNT = { min: 6, max: 8 } as const;
export const ELEMENT_COUNT = { min: 4, max: 6 } as const;

export function setupSchema(opts: SetupSchemaOptions): ZodType<SetupResult> {
  return asSchema(
    z.unknown().transform((raw, ctx): SetupResult => {
      if (!isObj(raw)) {
        issue(ctx, [], 'Expected a JSON object.');
        return z.NEVER;
      }
      // 태그가 "tags" 안에 들어 있어도, 밖에 펼쳐져 있어도 받는다
      const tagsObj = pick(raw, 'tags', 'tagCatalog', 'catalog');
      const t: Obj = isObj(tagsObj) ? { ...raw, ...tagsObj } : raw;

      const name = looseStr(pick(raw, 'name', 'worldName', 'title'));
      if (opts.askName && !name) issue(ctx, ['name'], 'Required: a short world name.');

      // 위치: 아는 언어는 고정값. 모르는 언어만 모델 값
      let position = knownPositions(opts.language);
      if (!position) {
        const p = pick(t, 'position', 'positions');
        let pair: string[] = [];
        if (isObj(p)) pair = [looseStr(pick(p, 'melee', 'close', 'near')), looseStr(pick(p, 'ranged', 'range', 'far', 'long'))];
        else pair = looseList(p);
        position = pair.length === 2 && pair[0] && pair[1] && normTag(pair[0]) !== normTag(pair[1]) ? [pair[0], pair[1]] : ['Melee', 'Ranged'];
      }

      const role = dedupe(looseList(pick(t, 'role', 'roles', 'classes', 'class')));
      if (role.length < ROLE_COUNT.min) issue(ctx, ['roles'], `Need ${ROLE_COUNT.min}–${ROLE_COUNT.max} distinct role names (got ${role.length}).`);

      const element = dedupe(looseList(pick(t, 'element', 'elements', 'attribute', 'attributes', 'affinities')));
      if (element.length < ELEMENT_COUNT.min) issue(ctx, ['elements'], `Need ${ELEMENT_COUNT.min}–${ELEMENT_COUNT.max} distinct element names (got ${element.length}).`);

      // 특징: 3★→6★ 순서로 4개. 못 맞추면 기본값 (재시도까지 할 일은 아님)
      let trait = dedupe(looseList(pick(t, 'trait', 'traits', 'ranks', 'rankLabels'))).slice(0, 4);
      if (trait.length !== 4) trait = [...defaultTraits(opts.language)];

      const cur = pick(raw, 'currency', 'currencies', 'currencyNames');
      const c: Obj = isObj(cur) ? { ...raw, ...cur } : raw;
      const pull = looseStr(pick(c, 'pull', 'pullCurrency', 'gacha', 'gachaCurrency', 'premium'));
      const shop = looseStr(pick(c, 'shop', 'shopCurrency', 'token', 'tokens', 'duplicate'));
      if (!pull) issue(ctx, ['currency', 'pull'], 'Required: name of the currency spent on pulls.');
      if (!shop) issue(ctx, ['currency', 'shop'], 'Required: name of the shop currency earned from duplicates.');

      let art: ArtStyle | undefined;
      if (opts.askArt) {
        const a = pick(raw, 'artStyle', 'art', 'style', 'imageStyle');
        const ao: Obj = isObj(a) ? a : { positive: a };
        const positive = cleanTags(looseList(pick(ao, 'positive', 'positiveTags', 'positivePrompt', 'tags', 'prompt')));
        const negative = cleanTags(looseList(pick(ao, 'negative', 'negativeTags', 'negativePrompt')));
        if (positive.ascii.length < 3) issue(ctx, ['artStyle', 'positive'], 'Need at least 3 English comma-separated style tags.');
        if (positive.nonAscii.length) issue(ctx, ['artStyle', 'positive'], `Tags must be English only; remove: ${positive.nonAscii.join(', ')}`);
        art = { positiveTags: positive.ascii.join(', '), negativeTags: negative.ascii.join(', ') };
      }

      const standardBannerName = looseStr(pick(raw, 'standardBannerName', 'bannerName', 'standardBanner', 'banner'));
      if (!standardBannerName) issue(ctx, ['standardBannerName'], 'Required: a name for the always-open standard banner.');

      const result: SetupResult = {
        tags: { position: [...position], role: role.slice(0, ROLE_COUNT.max), element: element.slice(0, ELEMENT_COUNT.max), trait },
        currency: { pull, shop },
        standardBannerName,
      };
      if (opts.askName) result.name = name;
      if (art) result.art = art;
      return result;
    }),
  );
}

/** 그림 태그 정리: 쉼표 단위, 소문자, 중복 제거. 영어(ASCII)가 아닌 태그는 따로 */
export function cleanTags(list: string[]): { ascii: string[]; nonAscii: string[] } {
  const ascii: string[] = [];
  const nonAscii: string[] = [];
  const seen = new Set<string>();
  for (const raw of list.flatMap((s) => s.split(','))) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    if (/[^\x20-\x7e]/.test(tag)) {
      nonAscii.push(tag);
      continue;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ascii.push(tag);
  }
  return { ascii, nonAscii };
}

// ---------- 캐릭터 ----------

export interface CharacterDraft {
  name: string;
  position: string;
  role: string[];
  element: string;
  archetype?: Archetype;
  appearance: string;
  imageTags: string;
  personality: string;
  background: string;
  quotes: string[];
}

export interface CharacterSchemaOptions {
  catalog: TagCatalog;
  count: number;
  detail: 'full' | 'light';
  /** 이미 있는 캐스트 이름. 겹치면 다시 쓰게 한다 */
  existingNames: string[];
}

const SUBJECT_TAG = /^(\d\+?(girl|boy|other)s?|solo|no humans|multiple (girls|boys))$/i;
const QUOTE_LIMIT = { full: 6, light: 2 } as const;

/** 답변에서 캐릭터 배열을 찾는다: 배열 그대로, {characters:[...]}, {character:{...}}, 캐릭터 객체 하나 */
function findList(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (!isObj(raw)) return undefined;
  const list = pick(raw, 'characters', 'cast', 'operators', 'list', 'members', 'results');
  if (Array.isArray(list)) return list;
  const one = pick(raw, 'character', 'operator');
  if (isObj(one)) return [one];
  if (pick(raw, 'name') !== undefined) return [raw];
  const arrays = Object.values(raw).filter(Array.isArray);
  if (arrays.length === 1) return arrays[0];
  return undefined;
}

export function characterListSchema(opts: CharacterSchemaOptions): ZodType<CharacterDraft[]> {
  const { catalog } = opts;
  return asSchema(
    z.unknown().transform((raw, ctx): CharacterDraft[] => {
      const list = findList(raw);
      if (!list) {
        issue(ctx, [], 'Expected {"characters": [ ... ]}.');
        return z.NEVER;
      }
      if (list.length < opts.count) {
        issue(ctx, ['characters'], `Expected exactly ${opts.count} character(s), got ${list.length}.`);
        return z.NEVER;
      }
      const taken = new Set(opts.existingNames.map(normTag));
      const out: CharacterDraft[] = [];
      list.slice(0, opts.count).forEach((item, i) => {
        const path = ['characters', i];
        if (!isObj(item)) {
          issue(ctx, path, 'Expected a character object.');
          return;
        }
        // 태그가 "tags" 안에 묶여 와도 받는다
        const tagsObj = pick(item, 'tags');
        const c: Obj = isObj(tagsObj) ? { ...item, ...tagsObj } : item;

        const name = looseStr(pick(c, 'name', 'fullName', 'characterName'));
        if (!name) issue(ctx, [...path, 'name'], 'Required.');
        else if (taken.has(normTag(name))) issue(ctx, [...path, 'name'], `"${name}" is already used by another character; choose a different name.`);
        else taken.add(normTag(name));

        const posRaw = looseStr(pick(c, 'position', 'range', 'positionTag'));
        const position = matchPosition(posRaw, catalog);
        if (!position) issue(ctx, [...path, 'position'], `Must be one of: ${catalog.position.join(', ')} (got "${posRaw}").`);

        const roleRaw = looseList(pick(c, 'role', 'roles', 'class', 'classes'), /[,\n、，;；/]/);
        const role: string[] = [];
        const badRoles: string[] = [];
        for (const r of roleRaw) {
          const m = matchTag(r, catalog.role);
          if (m) {
            if (!role.includes(m)) role.push(m);
          } else badRoles.push(r);
        }
        if (badRoles.length) issue(ctx, [...path, 'roles'], `Unknown role(s) ${badRoles.map((r) => `"${r}"`).join(', ')}. Use only: ${catalog.role.join(', ')}.`);
        else if (role.length === 0) issue(ctx, [...path, 'roles'], `Pick 1–2 roles from: ${catalog.role.join(', ')}.`);

        const elRaw = looseStr(pick(c, 'element', 'attribute', 'affinity', 'elements'));
        const element = matchTag(elRaw, catalog.element);
        if (!element) issue(ctx, [...path, 'element'], `Must be one of: ${catalog.element.join(', ')} (got "${elRaw}").`);

        const archRaw = normTag(looseStr(pick(c, 'archetype', 'combatArchetype', 'combatRole')));
        const archetype = ARCHETYPES.find((a) => a === archRaw || (archRaw.length >= 4 && (a.startsWith(archRaw) || archRaw.startsWith(a))));

        const appearance = looseStr(pick(c, 'appearance', 'look', 'looks', 'visual', 'description'));
        if (!appearance) issue(ctx, [...path, 'appearance'], 'Required.');

        const tagParts = cleanTags(looseList(pick(c, 'imageTags', 'imagePrompt', 'danbooruTags', 'artTags', 'promptTags')));
        if (tagParts.nonAscii.length) issue(ctx, [...path, 'imageTags'], `imageTags must be English tags only; replace: ${tagParts.nonAscii.join(', ')}`);
        else if (tagParts.ascii.length < 5) issue(ctx, [...path, 'imageTags'], 'Need at least 5 English comma-separated tags (subject count, hair, eyes, build, outfit, accessories).');
        else if (!tagParts.ascii.some((t) => SUBJECT_TAG.test(t))) issue(ctx, [...path, 'imageTags'], 'Start imageTags with a subject count tag: 1girl, 1boy or 1other.');
        // 주제 태그를 맨 앞으로
        const subjectFirst = [...tagParts.ascii.filter((t) => SUBJECT_TAG.test(t)), ...tagParts.ascii.filter((t) => !SUBJECT_TAG.test(t))];

        const personality = looseStr(pick(c, 'personality', 'temperament', 'persona'));
        if (!personality) issue(ctx, [...path, 'personality'], 'Required.');
        const background = looseStr(pick(c, 'background', 'backstory', 'story', 'history', 'bio', 'biography'), '\n\n');
        if (!background) issue(ctx, [...path, 'background'], 'Required.');

        const quotes = looseList(pick(c, 'quotes', 'quote', 'lines', 'voiceLines', 'dialogue', 'sampleQuotes'), /\n+/)
          .map((q) => q.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
          .filter(Boolean)
          .slice(0, QUOTE_LIMIT[opts.detail]);
        if (quotes.length === 0) issue(ctx, [...path, 'quotes'], 'Need at least one quote.');

        const draft: CharacterDraft = {
          name,
          position: position ?? '',
          role: role.slice(0, 2),
          element: element ?? '',
          appearance,
          imageTags: subjectFirst.join(', '),
          personality,
          background,
          quotes,
        };
        if (archetype) draft.archetype = archetype;
        out.push(draft);
      });
      return out;
    }),
  );
}
