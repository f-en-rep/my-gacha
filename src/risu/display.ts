// Adapted from RisuAI (GPL-3.0, (c) Kwaroran):
//   src/ts/process/scripts.ts      processScriptFull
//   src/ts/parser/parser.svelte.ts parseAdditionalAssets, ParseMarkdown, trimMarkdown, style scoping
// Host specific work (Lua, triggers, asset URLs, current chat) is injected through DisplayHost.

import markdownit from 'markdown-it'
import createDOMPurify from 'dompurify'
import * as css from '@adobe/css-tools'
import cssSelectorParser from 'postcss-selector-parser'
import { risuChatParser, pickHashRand, type CbsConditions } from './parser'

export type ScriptMode = 'editinput' | 'editoutput' | 'editprocess' | 'editdisplay'

export interface CustomScript {
  comment: string
  in: string
  out: string
  type: string
  flag?: string
  ableFlag?: boolean
}

export interface AssetEntry {
  /** original Risu name */
  name: string
  ext: string
  /** URL usable in the host page */
  url: string
}

export interface DisplayHost {
  scripts(): CustomScript[]
  /** Risu runLuaEditTrigger. Returns the (possibly) changed data. */
  luaEdit?(mode: ScriptMode, data: string, meta: any): Promise<string>
  /** Risu runTrigger(char, 'display'). */
  displayTrigger?(data: string): Promise<string>
  /** Risu additionalAssets + module assets: [name, url, ext] */
  assets(): AssetEntry[]
  /** Risu emotionImages: [name, url] */
  emotions(): AssetEntry[]
  charAvatarUrl(): string
  userAvatarUrl(): string
  chaId(): string
  /** chat message by index, for @@repeat_back and @@inject */
  message(index: number): { role: 'user' | 'char'; data: string } | null
  setMessage?(index: number, data: string): void
  firstMessage(): string
  assetMaxDifference?: number
}

const dreg = /{{data}}/g

export async function processScriptFull(host: DisplayHost, data: string, mode: ScriptMode, chatID = -1, cbsConditions: CbsConditions = {}) {
  if (host.luaEdit && mode !== 'editprocess') data = await host.luaEdit(mode, data, { index: chatID })
  if (mode === 'editdisplay' && host.displayTrigger) {
    try { data = await host.displayTrigger(data) } catch (e) { console.error(e) }
  }
  data = risuChatParser(data, { chatID, cbsConditions })
  const scripts = host.scripts()
  if (scripts.length === 0) return { data }

  type PScript = { script: CustomScript; order: number; actions: string[] }

  function executeScript(pscript: PScript) {
    const script = pscript.script
    if (script.in === '') return
    if (script.type !== mode) return

    const outScript2 = script.out.replaceAll('$n', '\n')
    let outScript = outScript2.replace(dreg, '$&')
    let flag = 'g'
    if (script.ableFlag) flag = script.flag || 'g'
    if (outScript.startsWith('@@move_top') || outScript.startsWith('@@move_bottom') || pscript.actions.includes('move_top') || pscript.actions.includes('move_bottom')) {
      flag = flag.replace('g', '')
    }
    if (outScript.endsWith('>') && !pscript.actions.includes('no_end_nl')) outScript += '\n'
    flag = flag.trim().replace(/[^dgimsuvy]/g, '')
    flag = flag.split('').filter((v, i, a) => a.indexOf(v) === i).join('')
    if (flag.length === 0) flag = 'u'

    let input = script.in
    if (pscript.actions.includes('cbs')) input = risuChatParser(input, { chatID, cbsConditions })

    const reg = new RegExp(input, flag)
    if (outScript.startsWith('@@') || pscript.actions.length > 0) {
      if (reg.test(data)) {
        if (outScript.startsWith('@@emo ')) {
          // emotion switching has no equivalent outside RisuAI's side panel
        } else if ((outScript.startsWith('@@inject') || pscript.actions.includes('inject')) && chatID !== -1) {
          host.setMessage?.(chatID, data)
          data = data.replace(reg, '')
        } else if (outScript.startsWith('@@move_top') || outScript.startsWith('@@move_bottom') || pscript.actions.includes('move_top') || pscript.actions.includes('move_bottom')) {
          const isGlobal = flag.includes('g')
          const matchAll = isGlobal ? [...data.matchAll(reg)] : [data.match(reg)]
          data = data.replace(reg, '')
          for (const matched of matchAll) {
            if (!matched) continue
            const inData = matched[0]
            const out = outScript.replace('@@move_top ', '').replace('@@move_bottom ', '')
              .replace(/(?<!\$)\$[0-9]+/g, v => {
                const index = parseInt(v.substring(1))
                return index < matched.length ? matched[index] : v
              })
              .replace(/\$\&/g, inData)
              .replace(/(?<!\$)\$<([^>]+)>/g, v => {
                const groupName = v.substring(2, v.length - 1)
                return matched.groups && matched.groups[groupName] ? matched.groups[groupName] : v
              })
            if (outScript.startsWith('@@move_top') || pscript.actions.includes('move_top')) data = out + '\n' + data
            else data = data + '\n' + out
          }
        } else {
          data = risuChatParser(data.replace(reg, outScript), { chatID, cbsConditions })
        }
      } else if ((outScript.startsWith('@@repeat_back') || pscript.actions.includes('repeat_back')) && chatID !== -1) {
        const v = outScript.split(' ', 2)[1]
        let lastChat = host.firstMessage()
        let pointer = chatID - 1
        const me = host.message(chatID)
        while (pointer >= 0) {
          const m = host.message(pointer)
          if (m && me && m.role === me.role) { lastChat = m.data; break }
          pointer--
        }
        const r = lastChat.match(reg)
        if (!r) return
        if (!v) data = data + r[0]
        else if (r[0]) {
          switch (v) {
            case 'end': data = data + r[0]; break
            case 'start': data = r[0] + data; break
            case 'end_nl': data = data + '\n' + r[0]; break
            case 'start_nl': data = r[0] + '\n' + data; break
          }
        }
      }
    } else {
      data = risuChatParser(data.replace(reg, outScript), { chatID, cbsConditions })
    }
  }

  const parsedScripts: PScript[] = []
  let orderChanged = false
  for (const script of scripts) {
    if (script.ableFlag && script.flag?.includes('<')) {
      const scriptData = { ...script }
      let order = 0
      const actions: string[] = []
      scriptData.flag = scriptData.flag?.replace(/<(.+?)>/g, (_v: string, p1: string) => {
        for (const m of p1.split(',').map(v => v.trim())) {
          if (m.startsWith('order ')) { order = parseInt(m.substring(6)); orderChanged = true }
          else actions.push(m)
        }
        return ''
      })
      parsedScripts.push({ script: scriptData, order, actions })
      continue
    }
    parsedScripts.push({ script, order: 0, actions: [] })
  }
  if (orderChanged) parsedScripts.sort((a, b) => b.order - a.order)
  for (const s of parsedScripts) {
    try { executeScript(s) } catch (error) { console.error('[risu regex]', s.script.comment, error) }
  }
  return { data }
}

// ---------- assets ----------
export const assetRegex = /{{(raw|path|img|image|video|audio|bgm|bg|emotion|asset|video-img|source)::(.+?)}}/gms
const videoExtensions = ['mp4', 'webm', 'avi', 'm4p', 'm4v']

type AssetPaths = { [key: string]: { srcPaths: string[]; ext?: string } }

function buildAssetPaths(assets: AssetEntry[]): AssetPaths {
  const out: AssetPaths = {}
  for (const a of assets) {
    const key = a.name.toLocaleLowerCase()
    out[key] ??= { srcPaths: [], ext: a.ext }
    if (out[key].ext === a.ext) out[key].srcPaths.push(a.url)
  }
  return out
}

export function getDistance(a: string, b: string) {
  const h = a.length + 1
  const w = b.length + 1
  const d = new Int16Array(h * w)
  for (let i = 0; i < h; i++) d[i * w] = i
  for (let i = 0; i < w; i++) d[i] = i
  for (let i = 1; i < h; i++) {
    for (let j = 1; j < w; j++) {
      d[i * w + j] = Math.min(d[(i - 1) * w + j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1), d[(i - 1) * w + j] + 1, d[i * w + j - 1] + 1)
    }
  }
  return d[h * w - 1]
}

function trimmer(str: string) {
  for (const e of ['webp', 'png', 'jpg', 'jpeg', 'gif', 'mp4', 'webm', 'avi', 'm4p', 'm4v', 'mp3', 'wav', 'ogg']) {
    if (str.endsWith('.' + e)) str = str.substring(0, str.length - e.length - 1)
  }
  return str.trim().replace(/[_ -.]/g, '')
}

function getClosestMatch(assets: AssetEntry[], name: string, assetPaths: AssetPaths, maxDiff: number) {
  if (!assets.length) return null
  let closest = '', closestDist = 999999, targetPath = '', targetExt = ''
  const trimmedName = trimmer(name)
  for (const asset of assets) {
    const key = asset.name.toLocaleLowerCase()
    const dist = getDistance(trimmedName, trimmer(key))
    if (dist < closestDist) { closest = key; closestDist = dist; targetPath = asset.url; targetExt = asset.ext }
  }
  if (closestDist > maxDiff) return null
  assetPaths[closest] = { srcPaths: [targetPath], ext: targetExt }
  return assetPaths[closest]
}

export function parseAdditionalAssets(host: DisplayHost, data: string, mode: 'normal' | 'back', chatID: number) {
  const assets = host.assets()
  const assetPaths = buildAssetPaths(assets)
  const emoPaths = buildAssetPaths(host.emotions())
  let cx: number | null = null
  return data.replace(assetRegex, (_full: string, type: string, name: string) => {
    name = name.toLocaleLowerCase()
    if (type === 'emotion') {
      const p = emoPaths[name]?.srcPaths?.[0]
      return p ? `<img src="${p}" alt="${p}" style=" "/>` : ''
    }
    if (type === 'source') {
      if (name === 'char') return host.charAvatarUrl()
      if (name === 'user') return host.userAvatarUrl()
    }
    let match = assetPaths[name] ?? getClosestMatch(assets, name, assetPaths, host.assetMaxDifference ?? 4)
    if (!match) return ''
    let p = match.srcPaths[0]
    if (match.srcPaths.length > 1) {
      if (cx === null) cx = pickHashRand(chatID, (host.chaId() || 'global') + chatID)
      p = match.srcPaths[Math.floor(cx * match.srcPaths.length)]
    }
    switch (type) {
      case 'raw':
      case 'path': return p
      case 'img': return `<img src="${p}" alt="${p}" style=" "/>`
      case 'image': return `<div class="risu-inlay-image"><img src="${p}" alt="${p}" style=""/></div>\n`
      case 'video': return `<video controls autoplay loop><source src="${p}" type="video/mp4"></video>\n`
      case 'video-img': return `<video autoplay muted loop><source src="${p}" type="video/mp4"></video>\n`
      case 'audio': return `<audio controls autoplay loop><source src="${p}" type="audio/mpeg"></audio>\n`
      case 'bg':
        if (mode === 'back') return `<div style="width:100%;height:100%;background: linear-gradient(rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0.8)),url(${p}); background-size: cover;"></div>`
        return ''
      case 'asset':
        if (match.ext && videoExtensions.includes(match.ext)) return `<video autoplay muted loop><source src="${p}" type="video/mp4"></video>\n`
        return `<img src="${p}" alt="${p}" style=" "/>\n`
      case 'bgm': return `<audio autoplay loop style="display:none"><source src="${p}"></audio>\n`
    }
    return ''
  })
}

// ---------- markdown + sanitize ----------
const md = markdownit({ html: true, breaks: true, linkify: false, typographer: true, quotes: '\u{E9b0}\u{E9b1}\u{E9b2}\u{E9b3}' })
md.disable(['code'])

const replacements = ['{', '}', '(', ')', '&lt;', '&gt;', ':', ';']
export function risuUnescape(text: string) {
  return text.replace(/[-]/g, f => replacements[f.charCodeAt(0) - 0xe9b8])
}

function renderMarkdown(data: string) {
  const quotes = ['“', '”', '‘', '’']
  let text = risuUnescape(md.render(data.replace(/“|”/g, '"').replace(/‘|’/g, "'")))
  text = text.replace(//gu, '<mark risu-mark="quote2">' + quotes[0]).replace(//gu, quotes[1] + '</mark>')
  text = text.replace(//gu, '<mark risu-mark="quote1">' + quotes[2]).replace(//gu, quotes[3] + '</mark>')
  return text
}

const styleRegex = /\<style\>(.+?)\<\/style\>/gms
const toHex = (s: string) => Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join('')
const fromHex = (h: string) => new TextDecoder().decode(new Uint8Array((h.match(/../g) ?? []).map(x => parseInt(x, 16))))

function encodeStyle(txt: string) {
  return txt.replaceAll(styleRegex, (_f, c1) => '<risu-style>' + toHex(c1) + '</risu-style>')
}

/** CSS scope prefix. RisuAI uses `.chattext`; the host wraps rendered messages in that class. */
export const SCOPE_CLASS = 'chattext'

function decodeStyleRule(rule: any): any {
  if (rule.type === 'rule' && rule.selectors) {
    for (let i = 0; i < rule.selectors.length; i++) {
      let slt: string = rule.selectors[i]
      if (!slt) continue
      const parser = cssSelectorParser(root => {
        root.walkClasses(classes => {
          if (classes.type === 'class' && !classes.value.startsWith('x-risu-')) classes.value = 'x-risu-' + classes.value
        })
      })
      slt = parser.processSync(slt)
      rule.selectors[i] = '.' + SCOPE_CLASS + ' ' + slt
    }
  }
  if (['media', 'supports', 'document', 'host', 'container'].includes(rule.type)) {
    for (let i = 0; i < rule.rules.length; i++) rule.rules[i] = decodeStyleRule(rule.rules[i])
  }
  if (rule.type === 'import' && rule.import.startsWith('data:')) rule.import = 'data:,'
  return rule
}

export function scopeCss(text: string): string | null {
  try {
    const ast = css.parse(risuChatParser(text))
    const rules = ast?.stylesheet?.rules
    if (rules) for (let i = 0; i < rules.length; i++) rules[i] = decodeStyleRule(rules[i])
    return css.stringify(ast, { indent: '', compress: true })
  } catch (e) {
    console.warn('[risu css]', e)
    return null
  }
}

let purify: ReturnType<typeof createDOMPurify> | null = null
function getPurify(win: Window) {
  if (purify) return purify
  purify = createDOMPurify(win as any)
  purify.addHook('uponSanitizeElement', (node: any, data: any) => {
    if (data.tagName === 'iframe') {
      const src = node.getAttribute('src') || ''
      if (!src.startsWith('https://www.youtube.com/embed/')) node.parentNode?.removeChild(node)
    }
  })
  purify.addHook('uponSanitizeAttribute', (node: any, data: any) => {
    if (data.attrName === 'class' && data.attrValue) {
      data.attrValue = data.attrValue.split(' ').map((v: string) => (v.startsWith('hljs') || v.startsWith('x-risu-') || !v ? v : 'x-risu-' + v)).join(' ')
    } else if (data.attrName === 'href') {
      if (data.attrValue.startsWith('http://') || data.attrValue.startsWith('https://')) node.setAttribute('target', '_blank')
      else data.attrValue = ''
    }
  })
  return purify
}

const purifyConfig = {
  ADD_TAGS: ['iframe', 'style', 'risu-style', 'x-em'],
  ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'risu-ctrl', 'risu-btn', 'risu-trigger', 'risu-mark', 'risu-id'],
}

export function trimMarkdown(win: Window, data: string) {
  if (!data) return ''
  const p = getPurify(win)
  const root = p.sanitize(data, { ...purifyConfig, RETURN_DOM: true }) as unknown as HTMLElement
  if (!root) return ''
  for (const el of Array.from(root.querySelectorAll('risu-style'))) {
    const decoded = scopeCss(fromHex(el.textContent ?? ''))
    if (decoded === null) { el.replaceWith(root.ownerDocument.createTextNode('')); continue }
    const style = root.ownerDocument.createElement('style')
    style.textContent = decoded.replaceAll(/<\/(?=style)/gi, '<\\/')
    el.replaceWith(style)
  }
  return root.innerHTML
}

/** RisuAI ParseMarkdown for chat messages and background HTML. */
export async function parseMarkdown(host: DisplayHost, win: Window, data: string, mode: 'normal' | 'back' = 'normal', chatID = -1, cbsConditions: CbsConditions = {}) {
  data = parseAdditionalAssets(host, data, mode, chatID)
  const firstParsed = data
  data = (await processScriptFull(host, data, 'editdisplay', chatID, cbsConditions)).data
  if (firstParsed !== data) data = parseAdditionalAssets(host, data, mode, chatID)
  data = encodeStyle(data)
  if (mode === 'normal') data = renderMarkdown(data)
  return trimMarkdown(win, data)
}
