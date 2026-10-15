// RisuAI card -> Marinara Engine character card (Character Card V2 JSON inside a PNG).
// Marinara imports ST-style cards: character_book, extensions.regex_scripts, depth_prompt.
// Scripts (Lua, JS) cannot run in Marinara, so CBS is translated to Marinara macros and the rest is baked.

import type { RisuChar } from '../load'
import { bytesToB64, textToB64 } from '../formats'
import { convertLore } from './lore'
import { Report } from './report'
import { toMarinara, parseDefaultVariables, type MarinaraContext } from './cbs-text'

export interface MarinaraOptions {
  /** chosen toggle values: { 'toggle_<key>': value } */
  toggles: Record<string, string>
  /** chosen variable values for baking; also used as fallbacks */
  bake: Record<string, string>
  /** inline image assets used by display regexes as data URIs (bytes limit) */
  inlineLimit: number
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' }

function regexPlacement(type: string): { placement: number[]; markdownOnly: boolean; promptOnly: boolean } | null {
  switch (type) {
    case 'editdisplay': return { placement: [1, 2], markdownOnly: true, promptOnly: false }
    case 'editoutput': return { placement: [2], markdownOnly: false, promptOnly: false }
    case 'editinput': return { placement: [1], markdownOnly: false, promptOnly: false }
    case 'editprocess': return { placement: [1, 2], markdownOnly: false, promptOnly: true }
  }
  return null
}

export async function buildMarinara(char: RisuChar, opts: MarinaraOptions) {
  const report = new Report()
  const defaults = parseDefaultVariables(char.defaultVariables)

  // images referenced by name -> data URI (only those actually referenced)
  const referenced = new Set<string>()
  const allText = [char.description, char.firstMessage, ...char.alternateGreetings, ...char.regex.map((r: any) => r.out ?? ''), char.backgroundHTML].join('\n')
  for (const m of allText.matchAll(/{{(?:raw|path|img|image|asset|emotion|bg)::(.+?)}}/g)) referenced.add(m[1].toLowerCase())
  const dataUris = new Map<string, string>()
  let used = 0
  for (const a of char.assets) {
    const key = a.name.toLowerCase()
    if (!referenced.has(key) || dataUris.has(key) || !MIME[a.ext]) continue
    if (used + a.size > opts.inlineLimit) continue
    const bytes = await a.data()
    used += bytes.length
    dataUris.set(key, `data:${MIME[a.ext]};base64,${bytesToB64(bytes)}`)
  }
  if (referenced.size > dataUris.size) {
    report.manual('에셋', `본문·정규식이 부르는 이미지 ${referenced.size}개 중 ${referenced.size - dataUris.size}개는 넣지 못했습니다 (용량 한도 또는 이름 없음).`)
  }

  const ctx = (where: string): MarinaraContext => ({
    defaults,
    toggles: opts.toggles,
    bake: { ...defaults, ...opts.bake },
    assetUrl: name => dataUris.get(name.toLowerCase()) ?? null,
    report,
    where,
  })
  const t = (text: string, where: string) => toMarinara(text ?? '', ctx(where))

  // regex
  const regexScripts: any[] = []
  for (const [i, r] of (char.regex as any[]).entries()) {
    const place = regexPlacement(r.type)
    const label = r.comment || `#${i + 1}`
    if (!place) { report.manual('정규식', `"${label}": 알 수 없는 종류(${r.type})라 빠졌습니다.`); continue }
    if (!r.in) continue
    let flag = 'g'
    if (r.ableFlag) flag = (r.flag || 'g').replace(/<.+?>/g, '')
    flag = [...new Set(flag.replace(/[^gimsuy]/g, '').split(''))].join('') || 'u'
    if (r.ableFlag && /<.+?>/.test(r.flag ?? '')) report.warn('정규식', `"${label}": 리스 전용 동작 옵션(${r.flag})은 빠졌습니다.`)
    let out = String(r.out ?? '').replaceAll('$n', '\n').replace(/{{data}}/g, '$&')
    if (out.startsWith('@@')) { report.manual('정규식', `"${label}": 리스 전용 명령(${out.split(' ')[0]})이라 옮기지 못했습니다.`); continue }
    if (/risu-(trigger|btn)=/.test(out)) report.manual('버튼', `"${label}": 리스 버튼(Lua 실행)이 들어 있어 Marinara에서는 눌러도 반응하지 않습니다.`)
    regexScripts.push({
      id: crypto.randomUUID(),
      scriptName: label,
      findRegex: `/${r.in}/${flag}`,
      replaceString: t(out, `정규식 "${label}"`),
      trimStrings: [],
      placement: place.placement,
      disabled: false,
      markdownOnly: place.markdownOnly,
      promptOnly: place.promptOnly,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: null,
      maxDepth: null,
    })
  }

  const lore = convertLore(char, (text, where) => t(text, where), report)

  if (char.triggers.length) {
    const lua = char.triggers.filter(tr => tr.effect?.some((e: any) => e.type === 'triggerlua')).length
    report.manual('트리거', `트리거 ${char.triggers.length}개(Lua ${lua}개)는 Marinara에서 실행할 수 없어 빠졌습니다. 수치 계산 같은 기능은 Marinara의 트래커 에이전트로 대신할 수 있습니다.`)
  }
  if (char.backgroundHTML.trim()) report.manual('배경 HTML', 'Marinara에는 카드 배경 HTML 기능이 없어 빠졌습니다.')
  if (char.toggles.trim()) report.ok('토글', '토글은 변환할 때 고른 값으로 고정했습니다.')
  if (Object.keys(defaults).length) report.ok('변수', `기본 변수 ${Object.keys(defaults).length}개는 조건식 안에 기본값으로 반영했습니다.`)

  const data = {
    name: char.name,
    description: t(char.description, '설명'),
    personality: t(char.personality, '성격'),
    scenario: t(char.scenario, '시나리오'),
    first_mes: t(char.firstMessage, '첫 메시지'),
    mes_example: t(char.exampleMessage, '예시 대화'),
    creator_notes: char.creatorNotes,
    system_prompt: t(char.systemPrompt, '시스템 프롬프트'),
    post_history_instructions: t(char.postHistoryInstructions, '후속 지시'),
    alternate_greetings: char.alternateGreetings.map((g, i) => t(g, `대체 인사말 ${i + 1}`)),
    tags: char.tags,
    creator: char.creator,
    character_version: char.characterVersion,
    character_book: lore,
    extensions: {
      ...char.stExtensions,
      regex_scripts: regexScripts,
      depth_prompt: char.depthPrompt ? { ...char.depthPrompt, prompt: t(char.depthPrompt.prompt, '깊이 프롬프트'), role: char.depthPrompt.role ?? 'system' } : undefined,
      cardbridge: { source: 'risuai', target: 'marinara' },
    },
  }
  const card = { spec: 'chara_card_v2', spec_version: '2.0', data }
  report.ok('본문', '본문을 Marinara 문법({{#if var:이름 == "값"}})으로 옮겼습니다.')
  report.ok('정규식', `정규식 ${regexScripts.length}개를 Marinara 정규식으로 옮겼습니다.`)
  report.ok('로어북', `로어북 ${lore.entries.length}개를 옮겼습니다.`)
  return { card, report, cardB64: textToB64(JSON.stringify(card)) }
}
