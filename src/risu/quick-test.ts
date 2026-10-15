import { risuChatParser } from './parser'
import { setEnv } from './env'
const vars: Record<string,string> = { gender: 'f' }
setEnv({ getChatVar: k => vars[k] ?? 'null', setChatVar: (k,v) => { vars[k] = v }, getUserName: () => '유저' })
const t = (s: string, o: any = {}) => console.log(JSON.stringify(s), '=>', JSON.stringify(risuChatParser(s, o)))
t('{{#when::{{getvar::gender}}::is::f}}그녀{{:else}}그{{/when}}는 {{user}}를 봤다')
vars.gender = 'm'
t('{{#when::{{getvar::gender}}::is::f}}그녀{{:else}}그{{/when}}는')
t('{{#if {{equal::{{getvar::gender}}::m}}}}남{{/if}}|{{? 1+2*3}}|{{button::누르기::female}}')
t('{{setvar::x::5}}{{getvar::x}}', { runVar: true })
t('{{#when::{{getvar::a}}::is::1::and::{{getvar::b}}::is::2}}둘다{{:else}}아님{{/when}}')
