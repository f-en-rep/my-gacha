// 프롬프트 틀: 칸(section)을 순서대로 나누고, 고칠 수 있는 칸은 사용자가 바꾼 글로 갈아 끼운다.
// edit: 고칠 수 있는 글 ({{변수}} 사용 가능) / lock: 형식이라 고정 / data: 실행 때 채우는 자료 (월드, 캐스트 ...)

export type SectionKind = 'edit' | 'lock' | 'data';

export interface PromptSection {
  key: string;
  kind: SectionKind;
  /** 어느 메시지에 들어가는지. history = 대화 기록 (user/assistant 차례로) */
  msg: 'system' | 'user' | 'history';
  /** 화면에 보이는 이름 */
  label: string;
  /** 언제 들어가는지 등 짧은 설명 */
  hint?: string;
  /** edit 칸의 기본 글 (지금까지 쓰던 문구 그대로) */
  text?: string;
}

export interface PlaceholderDoc {
  name: string;
  desc: string;
}

export interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  vars: PlaceholderDoc[];
  sections: PromptSection[];
}

/** 프롬프트 하나의 고친 칸들: 칸 key → 글 */
export type SectionOverrides = Record<string, string>;

/** 미리 보기용 기록: 어떤 칸이 어떤 글로 들어갔는지 */
export interface TraceEntry {
  key: string;
  text: string;
}

/** 프롬프트 만들 때 넘기는 것. 없으면 기본 프롬프트 그대로 */
export interface PromptCtx {
  overrides?: SectionOverrides;
  trace?: TraceEntry[];
}

export type Vars = Record<string, string | number>;

/** {{이름}}을 값으로. 모르는 이름은 그대로 둔다. 넣은 값 안의 {{...}}는 다시 바꾸지 않는다 */
export function fill(text: string, vars: Vars): string {
  return text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

/** 고친 글로 칠지: 비었거나 기본값과 같으면 아니다 */
export function isOverride(def: string, v: string | undefined): v is string {
  return v !== undefined && v.trim() !== '' && v !== def;
}

/** 기본값과 같거나 빈 칸, 틀에 없는 칸을 걷어 낸다. 남는 게 없으면 undefined */
export function cleanOverrides(tpl: PromptTemplate, ov: SectionOverrides | undefined): SectionOverrides | undefined {
  if (!ov) return undefined;
  const out: SectionOverrides = {};
  for (const s of tpl.sections) {
    if (s.kind !== 'edit') continue;
    const v = ov[s.key];
    if (isOverride(s.text ?? '', v)) out[s.key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 빌더가 쓰는 도구. edit은 고친 글(또는 기본)에 변수를 채우고, lock·data는 그대로. trace가 있으면 기록 */
export function sectionsOf(tpl: PromptTemplate, ctx: PromptCtx | undefined, vars: Vars) {
  const find = (key: string, kind: SectionKind) => {
    const s = tpl.sections.find((x) => x.key === key);
    if (!s || s.kind !== kind) throw new Error(`prompt ${tpl.id}: no ${kind} section "${key}"`);
    return s;
  };
  const record = (key: string, text: string) => {
    ctx?.trace?.push({ key, text });
    return text;
  };
  return {
    edit(key: string): string {
      const def = find(key, 'edit').text ?? '';
      const v = ctx?.overrides?.[key];
      return record(key, fill(isOverride(def, v) ? v : def, vars));
    },
    lock(key: string, text: string): string {
      find(key, 'lock');
      return record(key, text);
    },
    data(key: string, text: string): string {
      find(key, 'data');
      return record(key, text);
    },
  };
}
