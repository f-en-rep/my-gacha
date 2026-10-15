// CBS text helpers.
//  - protectCbs / unprotectCbs: hide RisuAI CBS from SillyTavern's macro engine (the runtime evaluates it).
//  - toMarinara: translate CBS into Marinara Engine macros; anything without an equivalent is baked
//    (evaluated once with the chosen variable values) and reported.

import { risuChatParser } from '../risu/parser'
import { setEnv } from '../risu/env'
import type { Report } from './report'

export const OPEN = '⦃⦃'
export const CLOSE = '⦄⦄'

export const hasCbs = (t: string) => typeof t === 'string' && (t.includes('{{') || /<(user|char|bot)>/i.test(t))
export const protectCbs = (t: string) => (t ? t.replaceAll('{{', OPEN).replaceAll('}}', CLOSE) : t)
export const unprotectCbs = (t: string) => (t ? t.replaceAll(OPEN, '{{').replaceAll(CLOSE, '}}') : t)

// ---------- AST ----------
type Node = string | Macro | Block
interface Macro { kind: 'macro'; raw: string; name: string; args: Node[][] }
interface Block { kind: 'block'; raw: string; head: string; headNodes: Node[]; then: Node[]; else?: Node[] }

function findClose(s: string, i: number): number {
  let depth = 0
  for (let j = i; j < s.length - 1; j++) {
    if (s[j] === '{' && s[j + 1] === '{') { depth++; j++ }
    else if (s[j] === '}' && s[j + 1] === '}') { depth--; j++; if (depth === 0) return j + 1 }
  }
  return -1
}

function splitTop(s: string, sep = '::'): string[] {
  const out: string[] = []
  let depth = 0, last = 0
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith('{{', i)) { depth++; i++; continue }
    if (s.startsWith('}}', i)) { depth--; i++; continue }
    if (depth === 0 && s.startsWith(sep, i)) { out.push(s.slice(last, i)); last = i + sep.length; i += sep.length - 1 }
  }
  out.push(s.slice(last))
  return out
}

/** Parses text into nodes. Block openers: {{#...}} closed by {{/...}}; {{:else}} splits. */
function parse(s: string): Node[] {
  const out: Node[] = []
  const stack: { block: Block; target: Node[] }[] = []
  let cur = out
  let i = 0, text = ''
  const flush = () => { if (text) { cur.push(text); text = '' } }
  while (i < s.length) {
    if (s.startsWith('{{', i)) {
      const end = findClose(s, i)
      if (end > 0) {
        const raw = s.slice(i, end)
        const inner = raw.slice(2, -2)
        if (inner.startsWith('#') && !inner.startsWith('#escape')) {
          flush()
          const block: Block = { kind: 'block', raw, head: inner, headNodes: parse(inner), then: [] }
          cur.push(block)
          stack.push({ block, target: cur })
          cur = block.then
          i = end
          continue
        }
        if (inner.trim() === ':else' && stack.length) {
          flush()
          const top = stack[stack.length - 1].block
          top.else = []
          cur = top.else
          i = end
          continue
        }
        if (inner.startsWith('/') && !inner.startsWith('//') && stack.length) {
          flush()
          const top = stack.pop()!
          cur = top.target
          i = end
          continue
        }
        flush()
        const parts = splitTop(inner)
        cur.push({ kind: 'macro', raw, name: parts[0].trim().toLowerCase().replace(/[\s_-]/g, ''), args: parts.slice(1).map(parse) })
        i = end
        continue
      }
    }
    text += s[i++]
  }
  flush()
  return out
}

function nodesToRaw(nodes: Node[]): string {
  return nodes.map(n => (typeof n === 'string' ? n : n.kind === 'macro' ? n.raw : blockRaw(n))).join('')
}
function blockRaw(b: Block): string {
  const closeName = b.head.match(/^#([a-z_]+)/i)?.[1] ?? 'if'
  return `{{${b.head}}}${nodesToRaw(b.then)}${b.else ? '{{:else}}' + nodesToRaw(b.else) : ''}{{/${closeName}}}`
}

// ---------- Marinara emitter ----------
export interface MarinaraContext {
  defaults: Record<string, string>
  toggles: Record<string, string>
  /** variables used for baking (defaults + user choices) */
  bake: Record<string, string>
  assetUrl: (name: string) => string | null
  report: Report
  where: string
}

class Untranslatable extends Error {}

const quote = (v: string) => `"${v.replace(/"/g, "'")}"`

/** A value usable inside a Marinara #if condition. */
type Operand = { kind: 'lit'; v: string } | { kind: 'var'; name: string; def: string } | { kind: 'macro'; expr: string }

function operandOf(nodes: Node[], ctx: MarinaraContext): Operand {
  const meaningful = nodes.filter(n => !(typeof n === 'string' && n === ''))
  if (meaningful.length === 0) return { kind: 'lit', v: '' }
  if (meaningful.every(n => typeof n === 'string')) return { kind: 'lit', v: (meaningful as string[]).join('') }
  if (meaningful.length === 1 && typeof meaningful[0] !== 'string' && meaningful[0].kind === 'macro') {
    const m = meaningful[0]
    const arg0 = m.args[0] ? nodesToRaw(m.args[0]).trim() : ''
    switch (m.name) {
      case 'getvar': return { kind: 'var', name: arg0, def: ctx.defaults[arg0] ?? '' }
      case 'getglobalvar': return { kind: 'lit', v: ctx.toggles[arg0] ?? 'null' }
      case 'user': return { kind: 'macro', expr: 'user' }
      case 'char': case 'bot': return { kind: 'macro', expr: 'char' }
    }
  }
  throw new Untranslatable()
}

function opExpr(o: Operand) {
  return o.kind === 'lit' ? quote(o.v) : o.kind === 'var' ? `var:${o.name}` : o.expr
}

function staticCompare(op: string, a: string, b: string): boolean {
  switch (op) {
    case '==': return a === b
    case '!=': return a !== b
    case '>': return parseFloat(a) > parseFloat(b)
    case '<': return parseFloat(a) < parseFloat(b)
    case '>=': return parseFloat(a) >= parseFloat(b)
    case '<=': return parseFloat(a) <= parseFloat(b)
  }
  return false
}

/** Comparison honoring RisuAI defaultVariables (unset variable reads its default). */
function compare(op: string, left: Operand, right: Operand): string {
  if (left.kind === 'lit' && right.kind === 'lit') return staticCompare(op, left.v, right.v) ? '"1" == "1"' : '"1" == "0"'
  if (right.kind === 'var' && left.kind !== 'var') {
    const flip: Record<string, string> = { '>': '<', '<': '>', '>=': '<=', '<=': '>=' }
    return compare(flip[op] ?? op, right, left)
  }
  const base = `${opExpr(left)} ${op} ${opExpr(right)}`
  if (left.kind === 'var' && left.def !== '' && right.kind === 'lit') {
    return staticCompare(op, left.def, right.v) ? `(var:${left.name} == "" || ${base})` : `(var:${left.name} != "" && ${base})`
  }
  return base
}

const truthy = (o: Operand) => `(${compare('==', o, { kind: 'lit', v: '1' })} || ${compare('==', o, { kind: 'lit', v: 'true' })})`
const falsy = (o: Operand) => `(${compare('!=', o, { kind: 'lit', v: '1' })} && ${compare('!=', o, { kind: 'lit', v: 'true' })})`

/** Expression that is '1'/'0' in Risu (equal, and, or, not...) -> Marinara boolean expression. */
function boolExpr(nodes: Node[], ctx: MarinaraContext, negate = false): string {
  const meaningful = nodes.filter(n => !(typeof n === 'string' && n.trim() === ''))
  if (meaningful.length === 1 && typeof meaningful[0] !== 'string' && meaningful[0].kind === 'macro') {
    const m = meaningful[0]
    const a = (i: number) => m.args[i] ?? []
    const cmp = (op: string, neg: string) => compare(negate ? neg : op, operandOf(a(0), ctx), operandOf(a(1), ctx))
    switch (m.name) {
      case 'equal': return cmp('==', '!=')
      case 'notequal': return cmp('!=', '==')
      case 'greater': return cmp('>', '<=')
      case 'greaterequal': return cmp('>=', '<')
      case 'less': return cmp('<', '>=')
      case 'lessequal': return cmp('<=', '>')
      case 'not': return boolExpr(a(0), ctx, !negate)
      case 'and': return negate ? `(${boolExpr(a(0), ctx, true)} || ${boolExpr(a(1), ctx, true)})` : `(${boolExpr(a(0), ctx)} && ${boolExpr(a(1), ctx)})`
      case 'or': return negate ? `(${boolExpr(a(0), ctx, true)} && ${boolExpr(a(1), ctx, true)})` : `(${boolExpr(a(0), ctx)} || ${boolExpr(a(1), ctx)})`
    }
  }
  const o = operandOf(nodes, ctx)
  return negate ? falsy(o) : truthy(o)
}

/** RisuAI #when statement (right-to-left stack) -> Marinara condition. */
function whenExpr(head: string, ctx: MarinaraContext): { expr: string; keep: boolean } {
  let keep = false
  if (head.startsWith('#when ')) return { expr: boolExpr(parse(head.slice(6)), ctx), keep }
  const statement: Array<{ nodes?: Node[]; expr?: string; neg?: string }> = splitTop(head).slice(1).map(s => ({ nodes: parse(s) }))
  const textOf = (x: { nodes?: Node[] }) => (x.nodes ? nodesToRaw(x.nodes).trim() : '')
  const asExpr = (x: { nodes?: Node[]; expr?: string }, neg = false) => (x.expr ? (neg ? `!(${x.expr})` : x.expr) : boolExpr(x.nodes!, ctx, neg))
  const negExpr = (x: { nodes?: Node[]; expr?: string; neg?: string }) => (x.expr ? x.neg! : boolExpr(x.nodes!, ctx, true))
  while (statement.length > 1) {
    const condition = statement.pop()!
    const operator = textOf(statement.pop()!)
    const bin = (op: string, inv: string) => {
      const c2 = statement.pop()!
      if (!c2?.nodes || !condition.nodes) throw new Untranslatable()
      const l = operandOf(c2.nodes, ctx), r = operandOf(condition.nodes, ctx)
      statement.push({ expr: compare(op, l, r), neg: compare(inv, l, r) })
    }
    switch (operator) {
      case 'not': statement.push({ expr: negExpr(condition), neg: asExpr(condition) }); break
      case 'keep': keep = true; statement.push(condition); break
      case 'legacy': statement.push(condition); break
      case 'and': { const c2 = statement.pop()!; statement.push({ expr: `(${asExpr(c2)} && ${asExpr(condition)})`, neg: `(${negExpr(c2)} || ${negExpr(condition)})` }); break }
      case 'or': { const c2 = statement.pop()!; statement.push({ expr: `(${asExpr(c2)} || ${asExpr(condition)})`, neg: `(${negExpr(c2)} && ${negExpr(condition)})` }); break }
      case 'is': bin('==', '!='); break
      case 'isnot': bin('!=', '=='); break
      case '>': bin('>', '<='); break
      case '<': bin('<', '>='); break
      case '>=': bin('>=', '<'); break
      case '<=': bin('<=', '>'); break
      case 'var': { const name = textOf(condition); const o: Operand = { kind: 'var', name, def: ctx.defaults[name] ?? '' }; statement.push({ expr: truthy(o), neg: falsy(o) }); break }
      case 'toggle': { const v = ctx.toggles['toggle_' + textOf(condition)] ?? 'null'; const t = v === '1' || v === 'true'; statement.push({ expr: t ? '"1" == "1"' : '"1" == "0"', neg: t ? '"1" == "0"' : '"1" == "1"' }); break }
      case 'vis': case 'visnot': {
        const varName = textOf(statement.pop()!)
        const o: Operand = { kind: 'var', name: varName, def: ctx.defaults[varName] ?? '' }
        const r = operandOf(condition.nodes ?? [], ctx)
        statement.push(operator === 'vis' ? { expr: compare('==', o, r), neg: compare('!=', o, r) } : { expr: compare('!=', o, r), neg: compare('==', o, r) })
        break
      }
      case 'tis': case 'tisnot': {
        const tv = ctx.toggles['toggle_' + textOf(statement.pop()!)] ?? 'null'
        const eq = tv === textOf(condition)
        const t = operator === 'tis' ? eq : !eq
        statement.push({ expr: t ? '"1" == "1"' : '"1" == "0"', neg: t ? '"1" == "0"' : '"1" == "1"' })
        break
      }
      default: statement.push({ expr: asExpr(condition), neg: negExpr(condition) })
    }
  }
  return { expr: asExpr(statement[0]), keep }
}

function bake(raw: string, ctx: MarinaraContext): string {
  const vars = { ...ctx.bake }
  setEnv({
    getChatVar: k => vars[k] ?? ctx.defaults[k] ?? 'null',
    setChatVar: (k, v) => { vars[k] = v },
    getGlobalChatVar: k => ctx.toggles[k] ?? 'null',
    getUserName: () => '\u0000USER\u0000',
  })
  return risuChatParser(raw, {}).replaceAll('\u0000USER\u0000', '{{user}}')
}

function emit(nodes: Node[], ctx: MarinaraContext): string {
  let out = ''
  for (const n of nodes) {
    if (typeof n === 'string') { out += n.replace(/<(user|char|bot)>/gi, (_m, w) => `{{${w.toLowerCase() === 'bot' ? 'char' : w.toLowerCase()}}}`); continue }
    if (n.kind === 'macro') { out += emitMacro(n, ctx); continue }
    out += emitBlock(n, ctx)
  }
  return out
}

function emitMacro(m: Macro, ctx: MarinaraContext): string {
  const arg = (i: number) => (m.args[i] ? emit(m.args[i], ctx) : '')
  switch (m.name) {
    case 'user': return '{{user}}'
    case 'char': case 'bot': return '{{char}}'
    case 'getvar': {
      const name = arg(0).trim()
      const def = ctx.defaults[name]
      if (def) return `{{#if var:${name} == ""}}${def}{{else}}{{getvar::${name}}}{{/if}}`
      return `{{getvar::${name}}}`
    }
    case 'setvar': return `{{setvar::${arg(0)}::${arg(1)}}}`
    case 'addvar': return `{{addnumvar::${arg(0)}::${arg(1)}}}`
    case 'getglobalvar': return ctx.toggles[arg(0).trim()] ?? 'null'
    case 'random': return m.args.length ? `{{random::${m.args.map(a => emit(a, ctx)).join('::')}}}` : '{{random}}'
    case 'roll': case 'dice': return `{{roll:${arg(0).trim()}}}`
    case 'br': case 'newline': return '\n'
    case 'raw': case 'path': case 'img': case 'image': case 'asset': case 'emotion': case 'bg': {
      const url = ctx.assetUrl(arg(0).trim())
      if (!url) { ctx.report.manual('에셋', `${ctx.where}: 이미지 "${arg(0)}"를 Marinara로 옮기지 못했습니다.`); return '' }
      if (m.name === 'raw' || m.name === 'path') return url
      return `<img src="${url}" alt="">`
    }
    case 'button':
      ctx.report.manual('버튼', `${ctx.where}: 리스 버튼 "${arg(0)}"은 Marinara에서 동작하지 않아 빠졌습니다.`)
      return ''
  }
  // Anything else: evaluate once (bake)
  const baked = bake(m.raw, ctx)
  if (baked !== m.raw) {
    ctx.report.warn('문법', `${ctx.where}: {{${m.name}}}는 Marinara에 없어 지금 값으로 고정했습니다.`)
    return baked
  }
  ctx.report.manual('문법', `${ctx.where}: {{${m.name}}}를 옮기지 못해 원문 그대로 두었습니다.`)
  return m.raw
}

/** Evaluates a condition made only of quoted literals (e.g. after toggles were fixed). null = depends on runtime values. */
function evalConstant(expr: string): boolean | null {
  const tokens = expr.match(/"[^"]*"|==|!=|>=|<=|>|<|&&|\|\||\(|\)|\S+/g) ?? []
  if (tokens.some(t => !/^("[^"]*"|==|!=|>=|<=|>|<|&&|\|\||\(|\))$/.test(t))) return null
  let i = 0
  const atom = (): boolean => {
    if (tokens[i] === '(') { i++; const v = or(); i++; return v }
    const a = tokens[i++].slice(1, -1), op = tokens[i++], b = tokens[i++].slice(1, -1)
    return staticCompare(op, a, b)
  }
  const and = (): boolean => { let v = atom(); while (tokens[i] === '&&') { i++; const r = atom(); v = v && r } return v }
  const or = (): boolean => { let v = and(); while (tokens[i] === '||') { i++; const r = and(); v = v || r } return v }
  try { return or() } catch { return null }
}

function emitBlock(b: Block, ctx: MarinaraContext): string {
  const thenText = () => emit(b.then, ctx)
  const elseText = () => (b.else ? emit(b.else, ctx) : '')
  try {
    let expr: string | null = null
    if (b.head.startsWith('#when')) expr = whenExpr(b.head, ctx).expr
    else if (b.head.startsWith('#if_pure ') || b.head.startsWith('#if ')) {
      const cond = b.head.startsWith('#if_pure ') ? b.head.slice(9) : b.head.slice(4)
      expr = boolExpr(parse(cond), ctx)
    }
    if (expr) {
      const constant = evalConstant(expr)
      if (constant === true) return thenText()
      if (constant === false) return elseText()
      const e = b.else ? `{{else}}${elseText()}` : ''
      return `{{#if ${expr}}}${thenText()}${e}{{/if}}`
    }
  } catch (e) {
    if (!(e instanceof Untranslatable)) throw e
  }
  ctx.report.warn('조건문', `${ctx.where}: 조건 "{{${b.head.slice(0, 60)}}}"는 Marinara 문법으로 옮길 수 없어 고른 값으로 미리 계산했습니다.`)
  return emit(parse(bake(blockRaw(b), ctx)), ctx)
}

export function toMarinara(text: string, ctx: MarinaraContext): string {
  if (!hasCbs(text)) return text
  return emit(parse(text), ctx)
}

export function parseDefaultVariables(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of (src ?? '').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1)
  }
  return out
}
