// CardBridge runtime: runs inside a JS-Slash-Runner (Tavern Helper) character script in SillyTavern.
// Reproduces RisuAI behaviour for one converted card: CBS, regex scripts (Risu order),
// Lua triggers, toggles, background HTML and asset names.

import { risuChatParser } from '../risu/parser'
import { setEnv } from '../risu/env'
import { parseMarkdown, processScriptFull, SCOPE_CLASS, type DisplayHost, type AssetEntry } from '../risu/display'
import { runScripted, type LuaHost, type RisuChat } from './lua'

declare const RISU_DATA: any
declare const SillyTavern: any
declare const eventOn: any
declare const getButtonEvent: any
declare const toastr: any

const OPEN = '⦃⦃'
const CLOSE = '⦄⦄'
const unprotect = (t: string) => (t ? String(t).replaceAll(OPEN, '{{').replaceAll(CLOSE, '}}') : t)
const protect = (t: string) => (t ? String(t).replaceAll('{{', OPEN).replaceAll('}}', CLOSE) : t)

const D = RISU_DATA
const P: any = window.parent
const pdoc: Document = P.document
const ctx = () => (typeof SillyTavern !== 'undefined' ? SillyTavern : P.SillyTavern).getContext()
const LOG = '[CardBridge]'

// ---------- variables ----------
function defaults(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of String(D.defaultVariables ?? '').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1)
  }
  return out
}
const DEFAULTS = defaults()

function localVars(): Record<string, any> {
  const c = ctx()
  c.chatMetadata.variables ??= {}
  return c.chatMetadata.variables
}
function getVar(key: string): string {
  const v = localVars()[key]
  if (v === undefined || v === null) return DEFAULTS[key] ?? 'null'
  return typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)
}
function setVar(key: string, value: string): boolean {
  const vars = localVars()
  if (vars[key] === value) return false
  vars[key] = value
  ctx().saveMetadataDebounced?.()
  return true
}
function globalVars(): Record<string, any> {
  const c = ctx()
  c.extensionSettings.variables ??= { global: {} }
  c.extensionSettings.variables.global ??= {}
  return c.extensionSettings.variables.global
}
function getGlobalVar(key: string): string {
  const v = globalVars()[key]
  return v === undefined || v === null || v === '' ? 'null' : String(v)
}
function setGlobalVar(key: string, value: string) {
  globalVars()[key] = value
  ctx().saveSettingsDebounced?.()
}

// ---------- chat mapping (RisuAI keeps the greeting outside chat.message) ----------
function stChat(): any[] { return ctx().chat ?? [] }
function greetingOffset(): number {
  const c = stChat()
  return c.length && !c[0].is_user && !c[0].is_system ? 1 : 0
}
const risuIndex = (stId: number) => stId - greetingOffset()

function risuChat(): RisuChat {
  const off = greetingOffset()
  return {
    message: stChat().slice(off).map((m: any) => ({ role: m.is_user ? 'user' : 'char', data: unprotect(m.mes ?? ''), time: Date.parse(m.send_date) || 0 })),
    note: ctx().chatMetadata?.note_prompt ?? '',
  }
}

/** Writes a RisuAI chat back into SillyTavern's chat. Returns true when the structure changed. */
async function applyRisuChat(chat: RisuChat): Promise<void> {
  const c = ctx()
  const st = c.chat
  const off = greetingOffset()
  const before = st.slice(off)
  let structural = before.length !== chat.message.length
  const next = chat.message.map((m, i) => {
    const old = before[i]
    if (old && (old.is_user ? 'user' : 'char') === m.role) {
      if (unprotect(old.mes) !== m.data) old.mes = protect(m.data)
      return old
    }
    structural = true
    return {
      name: m.role === 'user' ? c.name1 : c.name2,
      is_user: m.role === 'user',
      is_system: false,
      send_date: new Date().toISOString(),
      mes: protect(m.data),
      extra: {},
    }
  })
  st.splice(off, st.length - off, ...next)
  await c.saveChat()
  if (structural) await c.reloadCurrentChat()
}

// ---------- assets ----------
const ASSETS: AssetEntry[] = (D.assets ?? []).filter((a: any) => a.type !== 'emotion').map((a: any) => ({ name: a.name, ext: a.ext, url: a.url }))
const EMOTIONS: AssetEntry[] = (D.assets ?? []).filter((a: any) => a.type === 'emotion').map((a: any) => ({ name: a.name, ext: a.ext, url: a.url }))

function charAvatarUrl(): string {
  const c = ctx()
  const ch = c.characters?.[c.characterId]
  return ch?.avatar ? `/characters/${encodeURIComponent(ch.avatar)}` : ''
}
function userAvatarUrl(): string {
  const img = pdoc.querySelector('#user_avatar_block .avatar.selected img, .mes[is_user="true"] .avatar img') as HTMLImageElement | null
  return img?.getAttribute('src') ?? ''
}

// ---------- fake RisuAI database for CBS functions ----------
let localLore: any[] = []
function fakeDb() {
  const c = ctx()
  const ch = c.characters?.[c.characterId] ?? {}
  const chat = risuChat()
  const firstMsgIndex = (() => {
    const g = stChat()[0]
    if (!g || g.is_user) return -1
    const sw = g.swipe_id ?? 0
    return sw === 0 ? -1 : sw - 1
  })()
  return {
    characters: [{
      type: 'character',
      name: c.name2 ?? D.name,
      chaId: ch.avatar ?? D.name,
      desc: unprotect(ch.description ?? ''),
      personality: unprotect(ch.personality ?? ''),
      scenario: unprotect(ch.scenario ?? ''),
      exampleMessage: unprotect(ch.mes_example ?? ''),
      firstMessage: D.firstMessage,
      alternateGreetings: D.alternateGreetings ?? [],
      globalLore: D.lore ?? [],
      additionalAssets: ASSETS.map(a => [a.name, a.url, a.ext]),
      emotionImages: EMOTIONS.map(a => [a.name, a.url]),
      defaultVariables: D.defaultVariables ?? '',
      chats: [{ message: chat.message, fmIndex: firstMsgIndex, note: chat.note, localLore, scriptstate: {} }],
      chatPage: 0,
    }],
    aiModel: c.onlineStatus ?? '',
    subModel: '',
    maxContext: c.maxContext ?? 8192,
    globalNote: '',
    jailbreakToggle: false,
    language: c.getCurrentLocale?.() ?? 'en',
    templateDefaultVariables: '',
  }
}

setEnv({
  getChatVar: getVar,
  setChatVar: (k, v) => { setVar(k, v) },
  getGlobalChatVar: getGlobalVar,
  getUserName: () => ctx().name1 ?? 'User',
  getPersonaPrompt: () => ctx().powerUserSettings?.persona_description ?? '',
  getDatabase: fakeDb,
  selectedCharID: () => 0,
  findCharacterbyId: () => fakeDb().characters[0],
})

// ---------- Lua host ----------
const luaTriggers = () => (D.triggers ?? []).filter((t: any) => t?.effect?.[0]?.type === 'triggerlua')

async function popupInput(msg: string): Promise<string> {
  const c = ctx()
  const r = await c.callGenericPopup(msg, c.POPUP_TYPE.INPUT, '')
  return typeof r === 'string' ? r : ''
}

const luaHost: LuaHost = {
  getVar,
  setVar,
  getGlobalVar,
  alertError: m => toastr?.error ? toastr.error(m) : P.toastr?.error(m),
  alertNormal: m => toastr?.info ? toastr.info(m) : P.toastr?.info(m),
  alertInput: popupInput,
  alertSelect: async options => {
    const c = ctx()
    return new Promise(resolve => {
      const box = pdoc.createElement('div')
      box.style.cssText = 'display:flex;flex-direction:column;gap:6px'
      let popup: any
      options.forEach((o, i) => {
        const b = pdoc.createElement('button')
        b.className = 'menu_button'
        b.textContent = o
        b.onclick = () => { resolve(String(i)); popup?.completeCancelled?.() }
        box.appendChild(b)
      })
      popup = new c.Popup(box, c.POPUP_TYPE.DISPLAY, '', {})
      popup.show().then(() => resolve(''))
    })
  },
  alertConfirm: async msg => {
    const c = ctx()
    return (await c.callGenericPopup(msg, c.POPUP_TYPE.CONFIRM)) === c.POPUP_RESULT.AFFIRMATIVE
  },
  tokenize: async t => { try { return await ctx().getTokenCountAsync(t) } catch { return Math.ceil(t.length / 3) } },
  reloadDisplay: () => scheduleRenderAll(),
  reloadChat: index => { void renderMessage(index + greetingOffset()) },
  llm: async messages => {
    try {
      const result = await ctx().generateRaw({ prompt: messages, trimNames: false })
      return { success: true, result: String(result ?? '') }
    } catch (e: any) {
      return { success: false, result: String(e?.message ?? e) }
    }
  },
  charName: () => ctx().name2 ?? D.name,
  setCharName: () => console.warn(LOG, 'setName is not supported'),
  description: () => unprotect(ctx().characters?.[ctx().characterId]?.description ?? ''),
  setDescription: () => console.warn(LOG, 'setDescription is not supported'),
  firstMessage: () => D.firstMessage ?? '',
  setFirstMessage: d => { D.firstMessage = d; scheduleRenderAll() },
  personaName: () => ctx().name1 ?? 'User',
  personaDescription: () => ctx().powerUserSettings?.persona_description ?? '',
  backgroundEmbedding: () => D.backgroundHTML ?? '',
  setBackgroundEmbedding: d => { D.backgroundHTML = d; void renderBackground() },
  lorebooks: () => D.lore ?? [],
  localLore: () => localLore,
  setLocalLore: l => { localLore = l },
  charAvatarTag: () => { const u = charAvatarUrl(); return u ? `<img src="${u}">` : '' },
  personaAvatarTag: () => { const u = userAvatarUrl(); return u ? `<img src="${u}">` : '' },
}

/** RisuAI runTrigger for Lua triggers: every Lua trigger runs for every mode. */
async function runLuaTriggers(mode: string, data?: any): Promise<{ stopSending: boolean }> {
  let stopSending = false
  const triggers = luaTriggers()
  if (!triggers.length) return { stopSending }
  let chat = risuChat()
  const before = JSON.stringify(chat.message)
  for (const t of triggers) {
    const r = await runScripted(luaHost, t.effect[0].code, { chat, mode, data, lowLevelAccess: !!D.lowLevelAccess })
    chat = r.chat
    if (r.stopSending) stopSending = true
  }
  if (JSON.stringify(chat.message) !== before) await applyRisuChat(chat)
  return { stopSending }
}

async function luaEdit(mode: string, data: any, meta: any) {
  const map: Record<string, string> = { editinput: 'editInput', editoutput: 'editOutput', editdisplay: 'editDisplay', editprocess: '' }
  const m = map[mode] ?? mode
  if (!m) return data
  let d = data
  for (const t of luaTriggers()) {
    try {
      const r = await runScripted(luaHost, t.effect[0].code, { chat: risuChat(), mode: m, data: d, meta, lowLevelAccess: false })
      d = r.res ?? d
    } catch (e) { console.error(LOG, e) }
  }
  return d
}

// ---------- display ----------
const host: DisplayHost = {
  scripts: () => D.regex ?? [],
  luaEdit: (mode, data, meta) => luaEdit(mode, data, meta),
  assets: () => ASSETS,
  emotions: () => EMOTIONS,
  charAvatarUrl,
  userAvatarUrl,
  chaId: () => ctx().characters?.[ctx().characterId]?.avatar ?? D.name,
  message: index => risuChat().message[index] ?? null,
  setMessage: (index, data) => {
    const m = stChat()[index + greetingOffset()]
    if (m) { m.mes = data; void ctx().saveChat() }
  },
  firstMessage: () => D.firstMessage ?? '',
}

async function renderMessage(stId: number) {
  const m = stChat()[stId]
  if (!m || m.is_system) return
  const el = pdoc.querySelector(`#chat .mes[mesid="${stId}"] .mes_text`) as HTMLElement | null
  if (!el) return
  const isGreeting = stId === 0 && !m.is_user
  const raw = unprotect(m.mes ?? '')
  try {
    const html = await parseMarkdown(host, window, raw, 'normal', isGreeting ? -1 : risuIndex(stId), {
      firstmsg: isGreeting,
      chatRole: m.is_user ? 'user' : 'char',
    })
    el.innerHTML = `<div class="${SCOPE_CLASS} cardbridge-msg">${html}</div>`
  } catch (e) {
    console.error(LOG, 'render failed', stId, e)
  }
}

let renderQueued = false
function scheduleRenderAll() {
  if (renderQueued) return
  renderQueued = true
  setTimeout(async () => {
    renderQueued = false
    await renderBackground()
    const n = stChat().length
    for (let i = 0; i < n; i++) await renderMessage(i)
  }, 30)
}

async function renderBackground() {
  const chatEl = pdoc.querySelector('#chat')
  if (!chatEl) return
  let bg = pdoc.querySelector('#cardbridge-bg') as HTMLElement | null
  const src = String(D.backgroundHTML ?? '')
  if (!src.trim()) { bg?.remove(); return }
  if (!bg) {
    bg = pdoc.createElement('div')
    bg.id = 'cardbridge-bg'
    chatEl.prepend(bg)
  } else if (bg.parentElement !== chatEl) chatEl.prepend(bg)
  try {
    bg.className = SCOPE_CLASS
    bg.innerHTML = await parseMarkdown(host, window, src, 'back', -1, {})
  } catch (e) { console.error(LOG, 'background failed', e) }
}

// ---------- RisuAI runCurrentChatFunction: execute setvar & co. stored in messages ----------
async function runVarPass() {
  const st = stChat()
  const off = greetingOffset()
  let changed = false
  for (let i = off; i < st.length; i++) {
    const m = st[i]
    const src = unprotect(m.mes ?? '')
    if (!src.includes('{{') && !/<(user|char|bot)>/i.test(src)) continue
    const next = risuChatParser(src, { runVar: true, chatID: i - off })
    if (protect(next) !== m.mes) { m.mes = protect(next); changed = true }
  }
  if (changed) await ctx().saveChat()
}

// ---------- prompt ----------
async function processPromptMessages(messages: { role: string; content: any }[], dryRun: boolean) {
  let historyIndex = 0
  for (const msg of messages) {
    if (typeof msg.content !== 'string') continue
    const isHistory = msg.role === 'user' || msg.role === 'assistant'
    let text = risuChatParser(unprotect(msg.content), { role: msg.role === 'assistant' ? 'char' : msg.role })
    if (isHistory) {
      text = (await processScriptFull({ ...host, luaEdit: undefined }, text, 'editprocess', historyIndex, { chatRole: msg.role === 'assistant' ? 'char' : 'user' })).data
      historyIndex++
    }
    msg.content = text
  }
  if (!dryRun && luaTriggers().length) {
    const req = messages.map(m => ({ role: m.role, content: m.content }))
    const edited = await luaEdit('editRequest', req, {})
    if (Array.isArray(edited) && edited.length === messages.length) edited.forEach((e: any, i: number) => { if (typeof e?.content === 'string') messages[i].content = e.content })
  }
}

// ---------- toggles ----------
interface Toggle { key: string; value: string; type?: string; options?: string[] }
function parseToggles(src: string): Toggle[] {
  const out: Toggle[] = []
  for (const line of String(src ?? '').split('\n')) {
    const [key, value, type, option] = line.split('=')
    if (type === 'group' || type === 'groupEnd' || type === 'divider') out.push({ key, value, type })
    else if (type === 'caption' && value) out.push({ key, value, type })
    else if (key && value) out.push({ key, value, type: type === 'select' || type === 'text' || type === 'textarea' ? type : undefined, options: option?.split(',') ?? [] })
  }
  return out
}

async function openTogglePanel() {
  const c = ctx()
  const toggles = parseToggles(D.toggles)
  const box = pdoc.createElement('div')
  box.style.cssText = 'display:flex;flex-direction:column;gap:8px;text-align:left;max-width:560px'
  if (!toggles.length) box.textContent = '이 카드에는 토글 설정이 없습니다.'
  for (const t of toggles) {
    const varKey = 'toggle_' + t.key
    if (t.type === 'group') { const h = pdoc.createElement('h4'); h.textContent = t.value; h.style.margin = '10px 0 2px'; box.appendChild(h); continue }
    if (t.type === 'groupEnd') continue
    if (t.type === 'divider') { box.appendChild(pdoc.createElement('hr')); continue }
    if (t.type === 'caption') { const s = pdoc.createElement('small'); s.textContent = t.value; s.style.opacity = '0.75'; box.appendChild(s); continue }
    const row = pdoc.createElement('label')
    row.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between'
    const name = pdoc.createElement('span')
    name.textContent = t.value
    row.appendChild(name)
    const cur = getGlobalVar(varKey)
    if (t.type === 'select') {
      const sel = pdoc.createElement('select')
      sel.className = 'text_pole'
      sel.style.maxWidth = '60%'
      t.options!.forEach((o, i) => { const op = pdoc.createElement('option'); op.value = String(i); op.textContent = o; sel.appendChild(op) })
      sel.value = cur === 'null' ? '0' : cur
      sel.onchange = () => { setGlobalVar(varKey, sel.value); scheduleRenderAll() }
      row.appendChild(sel)
    } else if (t.type === 'text' || t.type === 'textarea') {
      const inp = pdoc.createElement(t.type === 'textarea' ? 'textarea' : 'input') as HTMLInputElement
      inp.className = 'text_pole'
      inp.value = cur === 'null' ? '' : cur
      inp.onchange = () => { setGlobalVar(varKey, inp.value); scheduleRenderAll() }
      row.appendChild(inp)
    } else {
      const cb = pdoc.createElement('input')
      cb.type = 'checkbox'
      cb.checked = cur === '1'
      cb.onchange = () => { setGlobalVar(varKey, cb.checked ? '1' : '0'); scheduleRenderAll() }
      row.appendChild(cb)
    }
    box.appendChild(row)
  }
  await c.callGenericPopup(box, c.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true })
}

// ---------- events ----------
const cleanups: Array<() => void> = []
function on(type: string, fn: (...args: any[]) => any) {
  if (typeof eventOn === 'function') { eventOn(type, fn); return }
  const es = ctx().eventSource
  es.on(type, fn)
  cleanups.push(() => es.removeListener(type, fn))
}
window.addEventListener('pagehide', () => cleanups.forEach(f => f()))

const ET = () => ctx().eventTypes

function bindButtons() {
  const chatEl = pdoc.querySelector('#chat') as HTMLElement | null
  if (!chatEl) return
  const handler = async (ev: Event) => {
    const target = ev.target as HTMLElement
    const origin = target?.closest?.('[risu-trigger], [risu-btn]') as HTMLElement | null
    if (!origin || !chatEl.contains(origin)) return
    ev.preventDefault()
    ev.stopPropagation()
    const trig = origin.getAttribute('risu-trigger')
    const btn = origin.getAttribute('risu-btn')
    try {
      if (trig) await runLuaTriggers(trig)
      else if (btn) await runLuaTriggers('onButtonClick', btn)
    } finally {
      scheduleRenderAll()
    }
  }
  chatEl.addEventListener('click', handler, true)
  cleanups.push(() => chatEl.removeEventListener('click', handler, true))
}

let queue: Promise<void> = Promise.resolve()
function guarded(fn: () => Promise<void>) {
  queue = queue.then(fn).catch(e => console.error(LOG, e))
  return queue
}

function init() {
  const et = ET()

  on(et.GENERATION_STARTED, async (type: string, _opts: any, dryRun: boolean) => {
    if (dryRun || type === 'quiet') return
    await runVarPass()
    const r = await runLuaTriggers('start')
    if (r.stopSending) ctx().stopGeneration?.()
  })

  on(et.CHAT_COMPLETION_PROMPT_READY, async (data: any) => {
    if (Array.isArray(data?.chat)) await processPromptMessages(data.chat, !!data.dryRun)
  })

  on(et.GENERATE_AFTER_COMBINE_PROMPTS, async (data: any) => {
    if (typeof data?.prompt !== 'string') return
    const box = [{ role: 'system', content: data.prompt }]
    await processPromptMessages(box, !!data.dryRun)
    data.prompt = box[0].content
  })

  on(et.MESSAGE_SENT, (id: number) => guarded(async () => {
    const m = stChat()[id]
    if (!m?.is_user) return
    m.mes = protect((await processScriptFull(host, unprotect(m.mes), 'editinput', risuIndex(id))).data)
    await ctx().saveChat()
    await runLuaTriggers('input')
    scheduleRenderAll()
  }))

  on(et.MESSAGE_RECEIVED, (id: number, type: string) => guarded(async () => {
    if (type === 'impersonate' || type === 'quiet') return
    const m = stChat()[id]
    if (!m || m.is_user || m.is_system) return
    m.mes = protect((await processScriptFull(host, unprotect(m.mes).trim(), 'editoutput', risuIndex(id))).data)
    if (Array.isArray(m.swipes) && typeof m.swipe_id === 'number') m.swipes[m.swipe_id] = m.mes
    await ctx().saveChat()
    await runVarPass()
    await runLuaTriggers('output')
    scheduleRenderAll()
  }))

  const rerender = (id: number) => { if (typeof id === 'number' || typeof id === 'string') void renderMessage(Number(id)) }
  on(et.CHARACTER_MESSAGE_RENDERED, rerender)
  on(et.USER_MESSAGE_RENDERED, rerender)
  on(et.MESSAGE_UPDATED, rerender)
  on(et.MESSAGE_EDITED, rerender)
  on(et.MESSAGE_SWIPED, rerender)
  on(et.MESSAGE_DELETED, () => scheduleRenderAll())
  on(et.MORE_MESSAGES_LOADED, () => scheduleRenderAll())
  on(et.CHAT_CHANGED, () => { bindButtons(); scheduleRenderAll() })

  if (typeof eventOn === 'function' && typeof getButtonEvent === 'function') {
    eventOn(getButtonEvent('리스 설정'), () => void openTogglePanel())
    eventOn(getButtonEvent('화면 새로고침'), () => scheduleRenderAll())
  }

  bindButtons()
  scheduleRenderAll()
  console.info(LOG, `runtime ${D.version} ready for`, D.name)
}

init()

// for debugging from the browser console
;(P as any).CardBridge = { data: D, renderAll: scheduleRenderAll, getVar, setVar, risuChatParser, protect, unprotect }
