// RisuAI lorebook (with @@decorators) -> Character Card V2 character_book entries
// using the extension fields SillyTavern and Marinara Engine both read.

import type { RisuLore, RisuChar } from '../load'
import type { Report } from './report'

const ROLE = { system: 0, user: 1, assistant: 2 } as Record<string, number>
const POS = { before: 0, after: 1, atDepth: 4 }

export interface Decorator { name: string; args: string[]; fallback: boolean; raw: string }

export function splitDecorators(content: string): { decorators: Decorator[]; body: string } {
  const decorators: Decorator[] = []
  const lines = content.split('\n')
  const keep: string[] = []
  for (const line of lines) {
    const m = line.match(/^@@(@?)([a-z_]+)(?:\s+(.*))?$/i)
    if (m && !/@@\s*$/.test(line.slice(2))) {
      const rest = (m[3] ?? '').trim()
      decorators.push({ name: m[2].toLowerCase(), args: rest ? rest.split(',').map(s => s.trim()) : [], fallback: m[1] === '@', raw: line })
    } else keep.push(line)
  }
  return { decorators, body: keep.join('\n') }
}

export function convertLore(char: RisuChar, transform: (text: string, where: string) => string, report: Report) {
  const entries: any[] = []
  let index = 0
  for (const lore of char.lore as RisuLore[]) {
    const label = lore.comment || (lore.key ? lore.key.split(',')[0] : '') || `#${index + 1}`
    if (lore.mode === 'folder') continue
    if (lore.mode === 'child') report.warn('로어북', `"${label}": 리스의 하위(child) 항목은 일반 항목으로 옮겼습니다.`)

    const { decorators, body } = splitDecorators(lore.content ?? '')
    const ext: any = {
      position: POS.after,
      depth: 4,
      role: 0,
      probability: 100,
      useProbability: true,
      display_index: index,
      case_sensitive: lore.extentions?.risu_case_sensitive ?? null,
      match_whole_words: null,
      scan_depth: null,
      exclude_recursion: false,
      prevent_recursion: false,
      selectiveLogic: 0,
    }
    let enabled = true
    let constant = !!lore.alwaysActive
    let secondary: string[] = lore.selective && lore.secondkey ? lore.secondkey.split(',').map(s => s.trim()).filter(Boolean) : []
    let selective = !!lore.selective && secondary.length > 0
    const unsupported: string[] = []

    for (const d of decorators) {
      const a0 = d.args[0] ?? ''
      switch (d.name) {
        case 'depth': ext.position = POS.atDepth; ext.depth = parseInt(a0) || 0; break
        case 'end': ext.position = POS.atDepth; ext.depth = 0; break
        case 'reverse_depth': unsupported.push(d.raw); break
        case 'role': if (a0 in ROLE) ext.role = ROLE[a0]; break
        case 'scan_depth': ext.scan_depth = parseInt(a0) || null; break
        case 'probability': ext.probability = parseInt(a0); ext.useProbability = true; break
        case 'activate': constant = true; break
        case 'dont_activate': enabled = false; break
        case 'activate_only_after': ext.delay = parseInt(a0) || null; break
        case 'match_full_word': ext.match_whole_words = true; break
        case 'match_partial_word': ext.match_whole_words = false; break
        case 'unrecursive': ext.prevent_recursion = true; break
        case 'no_recursive_search': ext.exclude_recursion = true; break
        case 'recursive': break
        case 'priority': break
        case 'ignore_on_max_context': break
        case 'position':
          if (a0 === 'before_desc') ext.position = POS.before
          else if (a0 === 'after_desc') ext.position = POS.after
          else { unsupported.push(d.raw) }
          break
        case 'additional_keys':
          if (selective && ext.selectiveLogic !== 0) unsupported.push(d.raw)
          else { secondary.push(...d.args); selective = true; ext.selectiveLogic = 0 }
          break
        case 'exclude_keys':
          if (selective && ext.selectiveLogic !== 2) unsupported.push(d.raw)
          else { secondary.push(...d.args); selective = true; ext.selectiveLogic = 2 }
          break
        case 'exclude_keys_all':
          if (selective && ext.selectiveLogic !== 1) unsupported.push(d.raw)
          else { secondary.push(...d.args); selective = true; ext.selectiveLogic = 1 }
          break
        default: unsupported.push(d.raw)
      }
    }
    if (unsupported.length) report.warn('로어북', `"${label}": ST/Marinara에 없는 설정이라 빠졌습니다 → ${unsupported.join(' / ')}`)

    let keys = (lore.key ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (lore.useRegex) keys = keys.map(k => (k.startsWith('/') ? k : `/${k}/`))
    if (!keys.length && !constant) {
      report.warn('로어북', `"${label}": 키워드가 없어 항상 켜짐으로 바꿨습니다.`)
      constant = true
    }

    entries.push({
      id: index,
      keys,
      secondary_keys: secondary,
      comment: lore.comment ?? '',
      content: transform(body, `로어북 "${label}"`),
      constant,
      selective,
      insertion_order: lore.insertorder ?? 100,
      enabled,
      position: ext.position === POS.before ? 'before_char' : 'after_char',
      use_regex: !!lore.useRegex,
      extensions: ext,
    })
    index++
  }
  const s = char.loreSettings
  return {
    name: char.name,
    description: '',
    scan_depth: s?.scanDepth ?? 5,
    token_budget: s?.tokenBudget ?? 2048,
    recursive_scanning: s?.recursiveScanning ?? true,
    extensions: {},
    entries,
  }
}
