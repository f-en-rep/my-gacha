// Lua runtime for RisuAI trigger scripts, following RisuAI src/ts/process/scriptings.ts (GPL-3.0).
// Same engine (wasmoon 1.16), same prelude, same per-mode engine cache and call conventions.

import { LuaFactory, type LuaEngine } from 'wasmoon'
import { LUA_PRELUDE } from './prelude'
import jsonLua from '../../vendor/risu/json.lua'
import wasmB64 from 'wasmoon/dist/glue.wasm'
import { risuChatParser } from '../risu/parser'

export interface RisuChatMessage { role: 'user' | 'char'; data: string; time?: number }
export interface RisuChat { message: RisuChatMessage[]; note?: string }

/** What the Lua API needs from the host (SillyTavern). */
export interface LuaHost {
  getVar(key: string): string
  setVar(key: string, value: string): boolean
  getGlobalVar(key: string): string
  alertError(msg: string): void
  alertNormal(msg: string): void
  alertInput(msg: string): Promise<string>
  alertSelect(options: string[]): Promise<string>
  alertConfirm(msg: string): Promise<boolean>
  tokenize(text: string): Promise<number>
  reloadDisplay(): void
  reloadChat(index: number): void
  llm(messages: { role: string; content: string }[]): Promise<{ success: boolean; result: string }>
  charName(): string
  setCharName(name: string): void
  description(): string
  setDescription(d: string): void
  firstMessage(): string
  setFirstMessage(d: string): void
  personaName(): string
  personaDescription(): string
  backgroundEmbedding(): string
  setBackgroundEmbedding(d: string): void
  lorebooks(): any[]
  localLore(): any[]
  setLocalLore(l: any[]): void
  charAvatarTag(): string
  personaAvatarTag(): string
}

class Mutex {
  private p: Promise<void> = Promise.resolve()
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.p.then(fn, fn)
    this.p = run.then(() => undefined, () => undefined)
    return run
  }
}

interface EngineState {
  engine?: LuaEngine
  code?: string
  mutex: Mutex
  chat?: RisuChat
}

let factory: LuaFactory | null = null
async function getFactory() {
  if (factory) return factory
  const bin = Uint8Array.from(atob(wasmB64 as unknown as string), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bin], { type: 'application/wasm' }))
  const f = new LuaFactory(url)
  await f.mountFile('json.lua', jsonLua as unknown as string)
  factory = f
  return f
}

const engines = new Map<string, EngineState>()
const safeIds = new Set<string>()
const editDisplayIds = new Set<string>()
const lowLevelIds = new Set<string>()
let lastRequestResetTime = 0
let lastRequestsCount = 0

export interface RunResult { stopSending: boolean; chat: RisuChat; res: any }

export async function runScripted(host: LuaHost, code: string, arg: { chat: RisuChat; mode: string; data?: any; meta?: any; lowLevelAccess?: boolean }): Promise<RunResult> {
  const mode = arg.mode
  const data = arg.data ?? ''
  const meta = arg.meta ?? {}
  let stopSending = false
  const f = await getFactory()
  let state = engines.get(mode)
  if (!state) { state = { mutex: new Mutex() }; engines.set(mode, state) }
  const st = state

  return st.mutex.runExclusive(async () => {
    st.chat = arg.chat
    if (code !== st.code) {
      st.engine?.global.close()
      st.code = code
      st.engine = await f.createEngine({ injectObjects: true })
      const lua = st.engine
      const declare = (name: string, fn: Function) => lua.global.set(name, fn)
      const safe = (id: string) => safeIds.has(id)
      const low = (id: string) => lowLevelIds.has(id)

      declare('getChatVar', (_id: string, key: string) => host.getVar(key))
      declare('setChatVar', (id: string, key: string, value: string) => { if (!safe(id) && !editDisplayIds.has(id)) return; host.setVar(key, value) })
      declare('setChatVarChanged', (id: string, key: string, value: string) => { if (!safe(id) && !editDisplayIds.has(id)) return; if (host.setVar(key, value) === true) return true })
      declare('getGlobalVar', (_id: string, key: string) => host.getGlobalVar(key))
      declare('stopChat', (id: string) => { if (safe(id)) stopSending = true })
      declare('alertError', (id: string, v: string) => { if (safe(id)) host.alertError(v) })
      declare('alertNormal', (id: string, v: string) => { if (safe(id)) host.alertNormal(v) })
      declare('alertInput', (id: string, v: string) => (safe(id) ? host.alertInput(v) : undefined))
      declare('alertSelect', (id: string, v: string[]) => (safe(id) ? host.alertSelect(v) : undefined))
      declare('alertConfirm', (id: string, v: string) => (safe(id) ? host.alertConfirm(v).then(r => !!r) : undefined))
      declare('getChatMain', (_id: string, index: number) => {
        const c = st.chat!.message.at(index)
        return JSON.stringify(c ? { role: c.role, data: c.data, time: c.time ?? 0 } : null)
      })
      declare('getChatData', (_id: string, index: number) => st.chat!.message.at(index)?.data ?? '')
      declare('getChatRole', (_id: string, index: number) => st.chat!.message.at(index)?.role ?? '')
      declare('getRecentChatsMain', (_id: string, count: number) => {
        const chats = st.chat!.message
        const start = Math.max(0, chats.length - Math.max(0, Math.floor(count || 0)))
        return JSON.stringify(chats.slice(start).map(v => ({ role: v.role, data: v.data, time: v.time ?? 0 })))
      })
      declare('setChat', (id: string, index: number, value: string) => { if (!safe(id)) return; const m = st.chat!.message?.at(index); if (m) m.data = value ?? '' })
      declare('setChatRole', (id: string, index: number, value: string) => { if (!safe(id)) return; const m = st.chat!.message?.at(index); if (m) m.role = value === 'user' ? 'user' : 'char' })
      declare('cutChat', (id: string, start: number, end: number) => { if (safe(id)) st.chat!.message = st.chat!.message.slice(start, end) })
      declare('removeChat', (id: string, index: number) => { if (safe(id)) st.chat!.message.splice(index, 1) })
      declare('addChat', (id: string, role: string, value: string) => { if (safe(id)) st.chat!.message.push({ role: role === 'user' ? 'user' : 'char', data: value ?? '' }) })
      declare('insertChat', (id: string, index: number, role: string, value: string) => { if (safe(id)) st.chat!.message.splice(index, 0, { role: role === 'user' ? 'user' : 'char', data: value ?? '' }) })
      declare('getTokens', async (id: string, value: string) => (safe(id) ? await host.tokenize(value) : undefined))
      declare('getChatLength', () => st.chat!.message.length)
      declare('getFullChatMain', () => JSON.stringify(st.chat!.message.map(v => ({ role: v.role, data: v.data, time: v.time ?? 0 }))))
      declare('sleep', (id: string, time: number) => (safe(id) ? new Promise(r => setTimeout(() => r(true), time)) : undefined))
      declare('cbs', (value: string) => risuChatParser(value, {}))
      declare('setFullChatMain', (id: string, value: string) => {
        if (!safe(id)) return
        st.chat!.message = JSON.parse(value).map((v: any) => ({ role: v.role, data: v.data }))
      })
      declare('logMain', (value: string) => { try { console.log('[risu lua]', JSON.parse(value)) } catch { console.log('[risu lua]', value) } })
      declare('reloadDisplay', (id: string) => { if (safe(id)) host.reloadDisplay() })
      declare('reloadChat', (id: string, index: number) => { if (safe(id)) host.reloadChat(index) })
      declare('similarity', async (id: string, _source: string, value: string[]) => (low(id) ? value : undefined))
      declare('request', async (id: string, url: string) => {
        if (!low(id)) return
        if (lastRequestResetTime + 60000 < Date.now()) { lastRequestsCount = 0; lastRequestResetTime = Date.now() }
        if (lastRequestsCount > 5) return JSON.stringify({ status: 429, data: 'Too many requests. you can request 5 times per minute' })
        lastRequestsCount++
        try {
          if (url.length > 120) return JSON.stringify({ status: 413, data: 'URL to large. max is 120 characters' })
          if (!url.startsWith('https://')) return JSON.stringify({ status: 400, data: 'Only https requests are allowed' })
          const d = await fetch(url, { method: 'GET' })
          return JSON.stringify({ status: d.status, data: await d.text() })
        } catch {
          return JSON.stringify({ status: 400, data: 'internal error' })
        }
      })
      declare('generateImage', async () => 'Error: Image generation is not available in SillyTavern bridge')
      declare('getCharacterImageMain', async () => host.charAvatarTag())
      declare('getPersonaImageMain', async () => host.personaAvatarTag())
      declare('hash', async (_id: string, value: string) => {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
        return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
      })
      const normRole = (r: string) => (r === 'system' || r === 'sys' ? 'system' : r === 'user' ? 'user' : 'assistant')
      const llm = async (id: string, promptStr: string) => {
        if (!low(id)) return
        const prompt = JSON.parse(promptStr).map((d: any) => ({ role: normRole(d.role), content: d.content ?? '' }))
        const r = await host.llm(prompt)
        return JSON.stringify(r.success ? r : { success: false, result: 'Error: ' + r.result })
      }
      declare('LLMMain', llm)
      declare('axLLMMain', llm)
      declare('simpleLLM', async (id: string, prompt: string) => {
        if (!low(id)) return
        const r = await host.llm([{ role: 'user', content: prompt }])
        return r.success ? r : { success: false, result: 'Error: ' + r.result }
      })
      declare('getName', () => host.charName())
      declare('setName', (id: string, name: string) => { if (!safe(id)) return; if (typeof name !== 'string') throw 'Invalid data type'; host.setCharName(name) })
      declare('getDescription', (id: string) => (safe(id) ? host.description() : undefined))
      declare('setDescription', (id: string, desc: string) => { if (safe(id)) host.setDescription(desc) })
      declare('getCharacterFirstMessage', () => host.firstMessage())
      declare('setCharacterFirstMessage', (id: string, d: string) => { if (!safe(id)) return; if (typeof d !== 'string') return false; host.setFirstMessage(d); return true })
      declare('getPersonaName', () => host.personaName())
      declare('getPersonaDescription', () => risuChatParser(host.personaDescription(), {}))
      declare('getAuthorsNote', () => st.chat?.note ?? '')
      declare('getBackgroundEmbedding', (id: string) => (safe(id) ? host.backgroundEmbedding() : undefined))
      declare('setBackgroundEmbedding', (id: string, d: string) => { if (!safe(id)) return; if (typeof d !== 'string') return false; host.setBackgroundEmbedding(d); return true })
      declare('getLoreBooksMain', (_id: string, search: string) => {
        const found: any[] = []
        for (const source of [host.localLore(), host.lorebooks()]) {
          for (const b of source) if (b.comment === search) found.push({ ...b, content: risuChatParser(b.content, {}) })
        }
        return JSON.stringify(found)
      })
      declare('upsertLocalLoreBook', (id: string, name: string, content: string, options: any) => {
        if (!safe(id)) return
        const { alwaysActive = false, insertOrder = 100, key = '', regex = false, secondKey = '' } = options ?? {}
        const next = host.localLore().filter(b => b.comment !== name)
        next.push({ alwaysActive, comment: name, content, insertorder: insertOrder, mode: 'normal', key, secondkey: secondKey, selective: !!secondKey, useRegex: regex })
        host.setLocalLore(next)
      })
      declare('loadLoreBooksMain', async (id: string) => (low(id) ? JSON.stringify([]) : undefined))
      const lastOf = (role: 'char' | 'user') => {
        const msgs = st.chat?.message ?? []
        for (let p = msgs.length - 1; p >= 0; p--) if (msgs[p].role === role) return msgs[p].data
        return role === 'char' ? host.firstMessage() : ''
      }
      declare('getCharacterLastMessage', () => lastOf('char'))
      declare('getUserLastMessage', () => lastOf('user'))

      await lua.doString(LUA_PRELUDE + '\n' + code)
    }

    const accessKey = crypto.randomUUID()
    if (mode === 'editDisplay') editDisplayIds.add(accessKey)
    else {
      safeIds.add(accessKey)
      if (arg.lowLevelAccess) lowLevelIds.add(accessKey)
    }
    let res: any
    const lua = st.engine!
    try {
      switch (mode) {
        case 'input': { const fn = lua.global.get('onInput'); if (fn) res = await fn(accessKey); break }
        case 'output': { const fn = lua.global.get('onOutput'); if (fn) res = await fn(accessKey); break }
        case 'start': { const fn = lua.global.get('onStart'); if (fn) res = await fn(accessKey); break }
        case 'onButtonClick': { const fn = lua.global.get('onButtonClick'); if (fn) res = await fn(accessKey, data); break }
        case 'editRequest':
        case 'editDisplay':
        case 'editInput':
        case 'editOutput': {
          const fn = lua.global.get('callListenMain')
          if (fn) res = JSON.parse(await fn(mode, accessKey, JSON.stringify(data), JSON.stringify(meta)))
          break
        }
        default: { const fn = lua.global.get(mode); if (fn) res = await fn(accessKey); break }
      }
      if (res === false) stopSending = true
    } catch (error) {
      console.error('[risu lua]', mode, error)
    }
    safeIds.delete(accessKey)
    lowLevelIds.delete(accessKey)
    editDisplayIds.delete(accessKey)
    return { stopSending, chat: st.chat!, res }
  })
}

export function resetEngines() {
  for (const s of engines.values()) s.engine?.global.close()
  engines.clear()
}
