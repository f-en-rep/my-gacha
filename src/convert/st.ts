// RisuAI card -> SillyTavern .charx with the CardBridge runtime (JS-Slash-Runner script).
// SillyTavern 1.19 imports .charx itself and unpacks image assets:
//   sprites (emotion)  -> characters/<name>/<base-with-hyphens>.<ext>
//   background         -> characters/<name>/backgrounds/<base>.<ext>
//   everything else    -> user/images/<name>/<base>.<ext>
// We compute the same file names so the runtime can point Risu asset names at them.

import type { RisuChar, LoadedAsset } from '../load'
import { ZipWriter, bytesToB64 } from '../formats'
import { convertLore } from './lore'
import { Report } from './report'
import { protectCbs, hasCbs } from './cbs-text'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'apng', 'avif', 'bmp', 'jfif'])
const SPRITE_TYPES = new Set(['emotion', 'expression'])
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', svg: 'image/svg+xml',
}
const INLINE_LIMIT = 4 * 1024 * 1024

/** sanitize-filename, as used by SillyTavern */
export function sanitizeFilename(input: string): string {
  let s = input.replace(/[\/\?<>\\:\*\|"]/g, '').replace(/[\x00-\x1f\x80-\x9f]/g, '')
  if (/^\.+$/.test(s)) s = ''
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(s)) s = ''
  s = s.replace(/[\. ]+$/, '')
  const enc = new TextEncoder()
  while (enc.encode(s).length > 255) s = s.slice(0, -1)
  return s
}

function stBaseName(name: string, fallback: string, hyphen: boolean) {
  const sep = hyphen ? '-' : '_'
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^${sep}|${sep}$`, 'g'), '')
  return (base || fallback).toLowerCase()
}

function stripImageExt(name: string, ext: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.' + ext)) return name.slice(0, -(ext.length + 1))
  for (const e of IMAGE_EXT) if (lower.endsWith('.' + e)) return name.slice(0, -(e.length + 1))
  return name
}

export interface RuntimeAsset { name: string; ext: string; type: string; url: string }

export interface StOutput {
  blob: Blob
  fileName: string
  report: Report
  card: any
  runtime: any
}

export interface StOptions {
  bridgeCode: string
  bridgeVersion: string
  onProgress?: (done: number, total: number) => void
}

export async function buildSillyTavern(char: RisuChar, opts: StOptions): Promise<StOutput> {
  const report = new Report()
  const folder = sanitizeFilename(char.name) || 'character'
  const zip = new ZipWriter()
  const cardAssets: any[] = []
  const runtimeAssets: RuntimeAsset[] = []
  const usedPaths = new Map<string, string>()
  let inlineBytes = 0

  // avatar
  if (char.icon) {
    const data = await char.icon.data()
    const path = `assets/icon/images/main.${char.icon.ext || 'png'}`
    zip.add(path, data)
    cardAssets.push({ type: 'icon', uri: `embeded://${path}`, name: 'main', ext: char.icon.ext || 'png' })
  } else {
    report.warn('에셋', '대표 이미지(아바타)가 없어 ST 기본 아바타가 쓰입니다.')
  }

  let order = cardAssets.length
  let done = 0
  for (const a of char.assets) {
    const ext = (a.ext || 'png').toLowerCase()
    const i = order++
    if (!IMAGE_EXT.has(ext)) {
      // ST does not unpack non-image assets; small ones are inlined into the runtime data
      if (a.size <= INLINE_LIMIT && inlineBytes + a.size <= 16 * 1024 * 1024) {
        const data = await a.data()
        inlineBytes += data.length
        runtimeAssets.push({ name: a.name, ext, type: a.type, url: `data:${MIME[ext] ?? 'application/octet-stream'};base64,${bytesToB64(data)}` })
        report.info('에셋', `"${a.name}.${ext}"는 이미지가 아니라 실행기 안에 직접 넣었습니다.`)
      } else {
        report.manual('에셋', `"${a.name}.${ext}" (${(a.size / 1048576).toFixed(1)}MB)는 ST가 가져오지 않는 형식이라 빠졌습니다.`)
      }
      continue
    }
    const sprite = SPRITE_TYPES.has(a.type)
    const background = a.type === 'background'
    const category = sprite ? 'sprite' : background ? 'background' : 'misc'
    const base = stBaseName(stripImageExt(a.name, ext), `${category}-${i}`, sprite)
    const dir = sprite ? 'emotion' : background ? 'background' : 'other'
    const zipPath = `assets/${dir}/image/${i}_${base}.${ext}`
    zip.add(zipPath, await a.data())
    cardAssets.push({ type: sprite ? 'emotion' : background ? 'background' : 'x-risu-asset', uri: `embeded://${zipPath}`, name: a.name, ext })
    const enc = encodeURIComponent(folder)
    const url = sprite
      ? `/characters/${enc}/${base}.${ext}`
      : background
        ? `/characters/${enc}/backgrounds/${base}.${ext}`
        : `/user/images/${enc}/${base}.${ext}`
    const prev = usedPaths.get(url)
    if (prev && prev !== a.name) report.warn('에셋', `"${prev}"와 "${a.name}"는 ST에서 같은 파일 이름(${base}.${ext})이 되어 하나만 남습니다.`)
    usedPaths.set(url, a.name)
    runtimeAssets.push({ name: a.name, ext, type: a.type, url })
    done++
    if (done % 50 === 0) opts.onProgress?.(done, char.assets.length)
  }
  opts.onProgress?.(char.assets.length, char.assets.length)

  // text fields: CBS is protected from SillyTavern's macro engine and evaluated by the runtime
  const p = (t: string) => protectCbs(t ?? '')
  const lore = convertLore(char, t => p(t), report)

  const runtime = {
    version: opts.bridgeVersion,
    name: char.name,
    folder,
    regex: char.regex,
    triggers: char.triggers,
    defaultVariables: char.defaultVariables,
    toggles: char.toggles,
    backgroundHTML: char.backgroundHTML,
    lowLevelAccess: char.lowLevelAccess,
    firstMessage: char.firstMessage,
    alternateGreetings: char.alternateGreetings,
    assets: runtimeAssets,
    lore: char.lore,
  }

  const script = {
    type: 'script',
    enabled: true,
    name: 'CardBridge 리스 실행기',
    id: crypto.randomUUID(),
    content: `const RISU_DATA = ${JSON.stringify(runtime)};\n${opts.bridgeCode}`,
    info: 'RisuAI 카드의 조건문(CBS), 정규식, Lua 트리거, 토글, 이미지를 SillyTavern에서 리스와 같은 방식으로 실행합니다. CardBridge로 변환됨.',
    button: { enabled: true, buttons: [{ name: '리스 설정', visible: true }, { name: '화면 새로고침', visible: false }] },
    data: {},
    export_with: { data: true, button: true },
  }

  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: char.name,
      description: p(char.description),
      personality: p(char.personality),
      scenario: p(char.scenario),
      first_mes: p(char.firstMessage),
      mes_example: p(char.exampleMessage),
      creator_notes: char.creatorNotes,
      system_prompt: p(char.systemPrompt),
      post_history_instructions: p(char.postHistoryInstructions),
      alternate_greetings: char.alternateGreetings.map(p),
      group_only_greetings: char.groupOnlyGreetings.map(p),
      tags: char.tags,
      creator: char.creator,
      character_version: char.characterVersion,
      nickname: char.nickname,
      character_book: lore,
      assets: cardAssets,
      extensions: {
        ...char.stExtensions,
        depth_prompt: char.depthPrompt ? { ...char.depthPrompt, prompt: p(char.depthPrompt.prompt), role: char.depthPrompt.role ?? 'system' } : undefined,
        regex_scripts: [],
        tavern_helper: { scripts: [script], variables: {} },
        cardbridge: { version: opts.bridgeVersion, source: 'risuai' },
      },
    },
  }

  zip.addText('card.json', JSON.stringify(card))

  // report
  const cbsFields = [char.description, char.firstMessage, ...char.alternateGreetings, char.personality, char.scenario].filter(hasCbs).length
  report.ok('본문', `설명·인사말 등 본문을 옮겼습니다. 리스 문법(CBS)이 든 항목 ${cbsFields}개는 실행기가 리스와 같은 방식으로 계산합니다.`)
  report.ok('로어북', `로어북 ${lore.entries.length}개를 ST 월드인포로 옮겼습니다.`)
  if (char.regex.length) report.ok('정규식', `리스 정규식 ${char.regex.length}개를 실행기가 리스 순서 그대로 적용합니다 (ST 정규식 탭에는 나타나지 않습니다).`)
  const luaCount = char.triggers.filter(t => t.effect?.some((e: any) => e.type === 'triggerlua')).length
  if (luaCount) report.ok('트리거', `Lua 트리거 ${luaCount}개를 리스와 같은 Lua 엔진(wasmoon)으로 실행합니다.`)
  const otherTriggers = char.triggers.filter(t => t.effect?.length && !t.effect.some((e: any) => e.type === 'triggerlua'))
  if (otherTriggers.length) report.manual('트리거', `블록형(비-Lua) 트리거 ${otherTriggers.length}개는 1차 버전에서 아직 실행하지 않습니다.`)
  if (char.toggles.trim()) report.ok('토글', `토글 설정은 ST 화면 아래 스크립트 버튼 "리스 설정"에서 고를 수 있습니다.`)
  if (char.backgroundHTML.trim()) report.ok('배경 HTML', '배경 HTML/CSS를 채팅창 뒤에 그대로 넣습니다.')
  if (char.lowLevelAccess) report.info('트리거', '이 카드는 리스의 "저수준 접근"(외부 요청, 추가 AI 호출)을 씁니다. 실행기는 이를 허용합니다.')
  report.ok('에셋', `이미지 ${runtimeAssets.filter(a => !a.url.startsWith('data:')).length}개를 charx에 넣었습니다. ST가 가져올 때 자동으로 풀립니다.`)
  report.info('필수', 'ST에서 JS-Slash-Runner(Tavern Helper) 확장이 켜져 있어야 하고, 카드를 처음 열 때 "스크립트 허용"을 눌러야 합니다.')

  return {
    blob: zip.finish('application/zip'),
    fileName: `${folder}.charx`,
    report,
    card,
    runtime,
  }
}

export type { LoadedAsset }
