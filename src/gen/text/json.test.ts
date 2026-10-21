import { describe, expect, it } from 'vitest';
import { extractJson, removeTrailingCommas } from './json';

const value = (raw: string) => {
  const r = extractJson(raw);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('extractJson', () => {
  it('plain object and array', () => {
    expect(value('{"a":1}')).toEqual({ a: 1 });
    expect(value(' [1,2] ')).toEqual([1, 2]);
  });

  it('strips code fences and chatter', () => {
    expect(value('Here you go:\n```json\n{"a": "b"}\n```\nThanks')).toEqual({ a: 'b' });
    expect(value('```\n[{"x":1}]\n```')).toEqual([{ x: 1 }]);
  });

  it('finds the outermost object amid prose', () => {
    expect(value('Result: {"a": {"b": [1, {"c": "}"}]}} done.')).toEqual({ a: { b: [1, { c: '}' }] } });
  });

  it('skips bracketed prose before the real JSON', () => {
    expect(value('[note] here is it: {"ok": true}')).toEqual({ ok: true });
  });

  it('removes <think> blocks', () => {
    expect(value('<think>maybe {"wrong": 1}</think>{"right": 2}')).toEqual({ right: 2 });
  });

  it('tolerates trailing commas', () => {
    expect(value('{"a": [1, 2,], "b": {"c": 3,},}')).toEqual({ a: [1, 2], b: { c: 3 } });
  });

  it('keeps commas inside strings', () => {
    expect(removeTrailingCommas('{"a": "x,}"}')).toBe('{"a": "x,}"}');
  });

  it('tolerates smart quotes used as delimiters', () => {
    expect(value('{“name”: “아리”}')).toEqual({ name: '아리' });
  });

  it('keeps smart quotes inside valid strings untouched', () => {
    expect(value('{"line": "그녀는 “안녕”이라고 말했다"}')).toEqual({ line: '그녀는 “안녕”이라고 말했다' });
  });

  it('handles escaped quotes in strings', () => {
    expect(value('x {"a": "he said \\"{hi}\\""} y')).toEqual({ a: 'he said "{hi}"' });
  });

  it('reports truncation', () => {
    const r = extractJson('```json\n{"a": [1, 2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/incomplete/);
  });

  it('reports missing JSON and empty replies', () => {
    const r = extractJson('I cannot do that.');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no JSON/);
    expect(extractJson('   ').ok).toBe(false);
  });
});
