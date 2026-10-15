import { resolveMacros } from 'C:/r/mar/packages/shared/src/utils/macro-engine'
const tpl = '{{#if (var:gender == "" || var:gender == "f")}}그녀는{{else}}그는{{/if}} {{user}}의 친구다. 호감도 {{#if var:affection == ""}}0{{else}}{{getvar::affection}}{{/if}}.'
for (const vars of [{}, { gender: 'f' }, { gender: 'm', affection: '7' }]) {
  const ctx: any = { user: '유저', char: '테스트봇', characters: ['테스트봇'], variables: {}, localVariables: { ...vars } }
  console.log(JSON.stringify(vars), '=>', resolveMacros(tpl, ctx))
}
