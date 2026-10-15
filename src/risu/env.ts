// The Risu CBS core reads the outside world only through this environment.
// The SillyTavern bridge and the converter (for baking) each install their own.

export interface RisuMessage {
  role: 'user' | 'char'
  data: string
  saying?: string
  time?: number
  chatId?: string
}

export interface RisuEnv {
  getChatVar(key: string): string
  setChatVar(key: string, value: string): void
  getGlobalChatVar(key: string): string
  getUserName(): string
  getPersonaPrompt(): string
  /** Fake RisuAI database: { characters: [char], aiModel, ... } */
  getDatabase(): any
  selectedCharID(): number
  findCharacterbyId(id: string): any
  getModules(): any[]
  getModuleLorebooks(): any[]
  getModelInfo(id?: string): any
}

const fallback: RisuEnv = {
  getChatVar: () => '',
  setChatVar: () => {},
  getGlobalChatVar: () => '',
  getUserName: () => 'User',
  getPersonaPrompt: () => '',
  getDatabase: () => ({ characters: [], aiModel: '', subModel: '', maxContext: 8000 }),
  selectedCharID: () => 0,
  findCharacterbyId: () => ({ name: 'Unknown Character' }),
  getModules: () => [],
  getModuleLorebooks: () => [],
  getModelInfo: () => ({ id: '', name: '', shortName: '', internalID: '', format: 0, provider: 0, tokenizer: 0, flags: [] }),
}

let current: RisuEnv = fallback

export function env(): RisuEnv {
  return current
}

export function setEnv(next: Partial<RisuEnv>) {
  current = { ...fallback, ...next }
}
