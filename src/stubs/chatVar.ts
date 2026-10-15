import { env } from '../risu/env'
export const getChatVar = (k: string) => env().getChatVar(k)
export const setChatVar = (k: string, v: string) => env().setChatVar(k, v)
export const getGlobalChatVar = (k: string) => env().getGlobalChatVar(k)
