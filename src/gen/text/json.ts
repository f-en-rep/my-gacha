// 모델 답변에서 JSON을 너그럽게 꺼낸다.
// 코드 펜스, 앞뒤 잡담, <think> 블록, 끝 쉼표, 둥근 따옴표 정도는 받아 준다.

export type JsonExtractResult = { ok: true; value: unknown } | { ok: false; error: string };

/** 답변 문자열에서 JSON 값을 꺼낸다. 실패하면 이유를 돌려준다 */
export function extractJson(raw: string): JsonExtractResult {
  const text = stripNoise(raw);
  if (!text) return { ok: false, error: 'the reply was empty' };

  const candidates: string[] = [];
  // ```json ... ``` 펜스 안쪽을 먼저 본다
  const fenceRe = /```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/g;
  for (const m of text.matchAll(fenceRe)) {
    const inner = m[1]?.trim();
    if (inner) candidates.push(inner);
  }
  // 닫히지 않은 펜스 (잘린 답변)
  const openFence = /```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*)$/.exec(text);
  if (openFence?.[1] && !candidates.length) candidates.push(openFence[1].trim());
  candidates.push(text);

  let firstError = '';
  for (const c of candidates) {
    const r = parseCandidate(c);
    if (r.ok) return r;
    if (!firstError) firstError = r.error;
  }
  return { ok: false, error: firstError || 'no JSON object or array found' };
}

function stripNoise(raw: string): string {
  return raw
    .replace(/^﻿/, '')
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .trim();
}

function parseCandidate(text: string): JsonExtractResult {
  const direct = tryParse(text);
  if (direct.ok) return direct;

  // 산문 속 대괄호 등에 속지 않도록 여는 괄호 위치를 차례로 시도한다
  let firstError = '';
  let tries = 0;
  for (let start = nextOpen(text, 0); start >= 0 && tries < 20; start = nextOpen(text, start + 1), tries++) {
    const end = findBalancedEnd(text, start);
    if (end < 0) {
      if (!firstError) {
        firstError = 'the JSON is incomplete (brackets never close — the reply may have been cut off)';
      }
      continue;
    }
    const r = repairAndParse(text.slice(start, end + 1));
    if (r.ok) return r;
    if (!firstError) firstError = r.error;
    // 바깥 덩어리가 깨졌으면 그 안쪽은 건너뛴다
    start = end;
  }
  return { ok: false, error: firstError || 'no JSON object or array found in the reply' };
}

function nextOpen(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') return i;
  }
  return -1;
}

function repairAndParse(slice: string): JsonExtractResult {
  const sliced = tryParse(slice);
  if (sliced.ok) return sliced;
  // 값싼 수리: 끝 쉼표 제거, 그다음 둥근 따옴표를 곧은 따옴표로
  const r1 = tryParse(removeTrailingCommas(slice));
  if (r1.ok) return r1;
  const r2 = tryParse(removeTrailingCommas(straightenQuotes(slice)));
  if (r2.ok) return r2;
  return { ok: false, error: `invalid JSON syntax: ${sliced.error}` };
}

function tryParse(text: string): JsonExtractResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** start의 여는 괄호에 짝이 되는 닫는 괄호 위치. 문자열 안은 건너뛴다. 없으면 -1 */
export function findBalancedEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString: string | null = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"') inString = ch;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** 문자열 밖의 `,}` `,]` 에서 쉼표를 지운다 */
export function removeTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) out += text[++i];
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

function straightenQuotes(text: string): string {
  return text.replace(/[“”„‟″]/g, '"');
}
