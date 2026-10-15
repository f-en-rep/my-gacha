// Reads RisuAI / SillyTavern cards and RisuAI modules into one model (RisuChar).
// Lorebook conversion follows RisuAI characterCards.ts convertCharbook (GPL-3.0).

import { b64ToBytes, decodeUtf8, isPng, readPngTexts, readRisum, readZipDirectory, readZipEntry } from './formats'

export interface LoadedAsset {
  /** card asset type: icon, x-risu-asset, emotion, background, user_icon, ... */
  type: string
  name: string
  ext: string
  size: number
  data: () => Promise<Uint8Array>
  from: string
}

export interface RisuLore {
  key: string
  secondkey: string
  insertorder: number
  comment: string
  content: string
  mode: string
  alwaysActive: boolean
  selective: boolean
  useRegex?: boolean
  activationPercent?: number
  folder?: string
  id?: string
  extentions?: any
}

export interface RisuTrigger {
  comment: string
  type: string
  conditions: any[]
  effect: any[]
  lowLevelAccess?: boolean
}

export interface RisuChar {
  sourceKind: 'risu' | 'st'
  spec: string
  name: string
  description: string
  personality: string
  scenario: string
  firstMessage: string
  alternateGreetings: string[]
  groupOnlyGreetings: string[]
  exampleMessage: string
  systemPrompt: string
  postHistoryInstructions: string
  creatorNotes: string
  creator: string
  characterVersion: string
  tags: string[]
  nickname: string
  depthPrompt?: { depth: number; prompt: string; role?: string }
  lore: RisuLore[]
  loreSettings?: { tokenBudget?: number; scanDepth?: number; recursiveScanning?: boolean; fullWordMatching?: boolean }
  regex: any[]
  triggers: RisuTrigger[]
  defaultVariables: string
  toggles: string
  backgroundHTML: string
  lowLevelAccess: boolean
  icon?: LoadedAsset
  assets: LoadedAsset[]
  /** original ST extensions (kept when the source is an ST card) */
  stExtensions: Record<string, any>
  stCharacterBook?: any
  notes: string[]
  modules: string[]
}

function guessExt(name: string, fallback = 'png') {
  const m = name.match(/\.([a-z0-9]{2,5})$/i)
  return m ? m[1].toLowerCase() : fallback
}

function convertCharbook(charbook: any, notes: string[]): { lore: RisuLore[]; settings: RisuChar['loreSettings'] } {
  const lore: RisuLore[] = []
  let settings: RisuChar['loreSettings'] = undefined
  if (charbook.recursive_scanning != null && charbook.scan_depth != null && charbook.token_budget != null) {
    settings = {
      tokenBudget: charbook.token_budget,
      scanDepth: charbook.scan_depth,
      recursiveScanning: charbook.recursive_scanning,
      fullWordMatching: charbook?.extensions?.risu_fullWordMatching ?? false,
    }
  }
  for (const book0 of charbook.entries ?? []) {
    const book = { ...book0 }
    let content = book.content ?? ''
    if (book.use_regex && !book.keys?.[0]?.startsWith('/')) book.use_regex = false
    const extensions = { ...(book.extensions ?? {}) }
    if (extensions.useProbability && extensions.probability !== undefined && extensions.probability !== 100) {
      content = `@@probability ${extensions.probability}\n` + content
      delete extensions.useProbability
      delete extensions.probability
    }
    if (extensions.position === 4 && typeof extensions.depth === 'number' && typeof extensions.role === 'number') {
      content = `@@depth ${extensions.depth}\n@@role ${['system', 'user', 'assistant'][extensions.role]}\n` + content
      delete extensions.position
      delete extensions.depth
      delete extensions.role
    }
    if (typeof extensions.selectiveLogic === 'number' && book.secondary_keys && book.secondary_keys.length > 0) {
      switch (extensions.selectiveLogic) {
        case 1:
          book.selective = false
          content = `@@exclude_keys_all ${book.secondary_keys.join(',')}\n` + content
          break
        case 2:
          book.selective = false
          for (const k of book.secondary_keys) content = `@@exclude_keys ${k}\n` + content
          break
        case 3:
          book.selective = false
          for (const k of book.secondary_keys) content = `@@additional_keys ${k}\n` + content
          break
      }
    }
    if (typeof extensions.delay === 'number' && extensions.delay > 0) {
      content = `@@activate_only_after ${extensions.delay}\n` + content
      delete extensions.delay
    }
    if (extensions.match_whole_words === true) { content = `@@match_full_word\n` + content; delete extensions.match_whole_words }
    if (extensions.match_whole_words === false) { content = `@@match_partial_word\n` + content; delete extensions.match_whole_words }
    lore.push({
      key: (book.keys ?? []).join(', '),
      secondkey: book.secondary_keys?.join(', ') ?? '',
      insertorder: book.insertion_order ?? 100,
      comment: book.name ?? book.comment ?? '',
      content,
      mode: book.mode ?? 'normal',
      alwaysActive: book.constant ?? false,
      selective: book.selective ?? false,
      extentions: { ...extensions, risu_case_sensitive: book.case_sensitive },
      activationPercent: book.extensions?.risu_activationPercent,
      useRegex: book.use_regex ?? false,
      folder: book.folder,
      id: book.id != null ? String(book.id) : undefined,
    })
    if (book.enabled === false) notes.push(`로어북 "${lore[lore.length - 1].comment || '(이름 없음)'}"은 원본에서 꺼져 있었습니다.`)
  }
  return { lore, settings }
}

interface ParsedCard { card: any; assetResolver: (uri: string) => { size: number; data: () => Promise<Uint8Array> } | null; module?: any; moduleAssets?: LoadedAsset[]; notes: string[] }

async function parseCardFile(name: string, bytes: Uint8Array): Promise<ParsedCard> {
  const notes: string[] = []
  if (isPng(bytes)) {
    const info = readPngTexts(bytes)!
    const raw = info.texts['ccv3'] ?? info.texts['chara']
    if (!raw) throw new Error('PNG 안에 카드 데이터가 없습니다')
    const card = JSON.parse(decodeUtf8(b64ToBytes(raw)))
    const chunks = new Map<string, string>()
    for (const [k, v] of Object.entries(info.texts)) if (k.startsWith('chara-ext-asset_')) chunks.set(k.replace(/^chara-ext-asset_:?/, ''), v)
    const avatar = bytes
    return {
      card,
      notes,
      assetResolver: uri => {
        if (uri === 'ccdefault:') return { size: avatar.length, data: async () => avatar }
        if (uri.startsWith('__asset:')) {
          const v = chunks.get(uri.slice(8))
          if (!v) return null
          return { size: Math.floor(v.length * 0.75), data: async () => b64ToBytes(v) }
        }
        if (uri.startsWith('data:')) {
          const b = uri.split(',')[1] ?? ''
          return { size: Math.floor(b.length * 0.75), data: async () => b64ToBytes(b) }
        }
        return null
      },
    }
  }

  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (ext === 'json' || bytes[0] === 0x7b || (bytes[0] === 0xef && bytes[3] === 0x7b)) {
    const card = JSON.parse(decodeUtf8(bytes).replace(/^﻿/, ''))
    return { card, notes, assetResolver: uri => (uri.startsWith('data:') ? { size: uri.length, data: async () => b64ToBytes(uri.split(',')[1] ?? '') } : null) }
  }

  const zip = readZipDirectory(bytes)
  if (!zip) throw new Error('알 수 없는 파일 형식입니다')
  const byName = new Map(zip.map(e => [e.name, e]))
  const cardEntry = byName.get('card.json')
  if (!cardEntry) throw new Error('charx 안에 card.json이 없습니다')
  const card = JSON.parse(decodeUtf8(await readZipEntry(bytes, cardEntry)))
  let module: any
  const moduleEntry = byName.get('module.risum')
  if (moduleEntry) {
    try { module = readRisum(await readZipEntry(bytes, moduleEntry)).module } catch (e: any) { notes.push('module.risum을 읽지 못했습니다: ' + e.message) }
  }
  return {
    card,
    module,
    notes,
    assetResolver: uri => {
      const m = uri.match(/^(?:embeded|embedded):\/\/(.+)$/)
      if (!m) {
        if (uri.startsWith('data:')) return { size: uri.length, data: async () => b64ToBytes(uri.split(',')[1] ?? '') }
        return null
      }
      const e = byName.get(m[1])
      if (!e) return null
      return { size: e.size, data: () => readZipEntry(bytes, e) }
    },
  }
}

export async function loadCard(fileName: string, bytes: Uint8Array): Promise<RisuChar> {
  const parsed = await parseCardFile(fileName, bytes)
  const card = parsed.card
  const data = card.data ?? card
  const risu = data?.extensions?.risuai
  const notes = [...parsed.notes]

  const char: RisuChar = {
    sourceKind: risu ? 'risu' : 'st',
    spec: card.spec ?? 'chara_card_v1',
    name: data.name ?? 'Unknown',
    description: data.description ?? '',
    personality: data.personality ?? '',
    scenario: data.scenario ?? '',
    firstMessage: data.first_mes ?? '',
    alternateGreetings: data.alternate_greetings ?? [],
    groupOnlyGreetings: data.group_only_greetings ?? [],
    exampleMessage: data.mes_example ?? '',
    systemPrompt: data.system_prompt ?? '',
    postHistoryInstructions: data.post_history_instructions ?? '',
    creatorNotes: data.creator_notes ?? '',
    creator: data.creator ?? '',
    characterVersion: data.character_version != null ? String(data.character_version) : '',
    tags: data.tags ?? [],
    nickname: data.nickname ?? '',
    depthPrompt: data.extensions?.depth_prompt,
    lore: [],
    regex: risu?.customScripts ?? [],
    triggers: risu?.triggerscript ?? [],
    defaultVariables: risu?.defaultVariables ?? '',
    toggles: typeof risu?.toggles === 'string' ? risu.toggles : '',
    backgroundHTML: risu?.backgroundHTML ?? '',
    lowLevelAccess: risu?.lowLevelAccess ?? false,
    assets: [],
    stExtensions: risu ? {} : { ...(data.extensions ?? {}) },
    stCharacterBook: risu ? undefined : data.character_book,
    notes,
    modules: [],
  }

  if (parsed.module) {
    char.triggers = parsed.module.trigger ?? char.triggers
    char.regex = parsed.module.regex ?? char.regex
  }
  if (parsed.module?.lorebook) {
    char.lore = parsed.module.lorebook
  } else if (data.character_book) {
    const c = convertCharbook(data.character_book, notes)
    char.lore = c.lore
    char.loreSettings = c.settings
  }
  if (data.character_book && parsed.module?.lorebook) {
    const c = convertCharbook(data.character_book, [])
    char.loreSettings = c.settings
  }

  // assets (V3 list)
  const seen = new Set<string>()
  if (Array.isArray(data.assets)) {
    for (const a of data.assets) {
      if (!a || typeof a.uri !== 'string') continue
      const r = parsed.assetResolver(a.uri)
      if (!r) { if (a.uri !== 'ccdefault:') notes.push(`에셋 "${a.name}"의 파일을 찾지 못했습니다 (${a.uri.slice(0, 40)})`); continue }
      const asset: LoadedAsset = { type: a.type ?? 'x-risu-asset', name: a.name ?? '', ext: (a.ext ?? guessExt(a.uri)).toLowerCase(), size: r.size, data: r.data, from: fileName }
      if (asset.type === 'icon' && (asset.name === 'main' || !char.icon)) { char.icon = asset; continue }
      seen.add(asset.type + ':' + asset.name)
      char.assets.push(asset)
    }
  }
  // V2 Risu card: assets kept in extensions.risuai
  if (risu?.additionalAssets && Array.isArray(risu.additionalAssets)) {
    for (const [n, uri, ext] of risu.additionalAssets) {
      if (seen.has('x-risu-asset:' + n)) continue
      const r = parsed.assetResolver(String(uri))
      if (r) char.assets.push({ type: 'x-risu-asset', name: n, ext: (ext ?? 'png').toLowerCase(), size: r.size, data: r.data, from: fileName })
    }
  }
  if (risu?.emotions && Array.isArray(risu.emotions)) {
    for (const [n, uri] of risu.emotions) {
      if (seen.has('emotion:' + n)) continue
      const r = parsed.assetResolver(String(uri))
      if (r) char.assets.push({ type: 'emotion', name: n, ext: 'png', size: r.size, data: r.data, from: fileName })
    }
  }
  if (!char.icon && isPng(bytes)) char.icon = { type: 'icon', name: 'main', ext: 'png', size: bytes.length, data: async () => bytes, from: fileName }
  return char
}

/** Adds a RisuAI module (.risum) to a character: assets, regex, triggers, lorebook. */
export function addModule(char: RisuChar, fileName: string, bytes: Uint8Array, opts: { scripts: boolean } = { scripts: true }) {
  const r = readRisum(bytes)
  const m = r.module
  let added = 0
  ;(m.assets ?? []).forEach((a: [string, string, string], i: number) => {
    const fn = r.assetData[i]
    if (!fn) return
    char.assets.push({ type: 'x-risu-asset', name: a[0], ext: (a[2] || 'png').toLowerCase(), size: r.assetSizes[i], data: async () => fn(), from: fileName })
    added++
  })
  if (opts.scripts) {
    if (m.regex?.length) char.regex = [...char.regex, ...m.regex]
    if (m.trigger?.length) char.triggers = [...char.triggers, ...m.trigger]
    if (m.lorebook?.length) char.lore = [...char.lore, ...m.lorebook]
    if (m.customModuleToggle) char.toggles = [char.toggles, m.customModuleToggle].filter(Boolean).join('\n')
    if (m.backgroundEmbedding) char.backgroundHTML = [char.backgroundHTML, m.backgroundEmbedding].filter(Boolean).join('\n')
  }
  char.modules.push(`${fileName} (${m.name ?? '모듈'}): 에셋 ${added}개, 정규식 ${m.regex?.length ?? 0}개, 트리거 ${m.trigger?.length ?? 0}개, 로어북 ${m.lorebook?.length ?? 0}개`)
  return m
}
