// Builds a synthetic RisuAI .charx shaped like the user's card 3 (no real card content).
import { ZipWriter } from '../src/formats'
import fs from 'node:fs'
import zlib from 'node:zlib'

const map = fs.readFileSync('C:/r/risu/src/ts/rpack/rpack_map.bin')
const enc = (b: Uint8Array) => b.map(x => map[x])

const lua = `
local function setAllVar(id, k, v) setChatVar(id, k, tostring(v)) end
function onStart(id)
  local g = getChatVar(id, "gender")
  if g == nil or g == "" or g == "null" then setAllVar(id, "gender", "f") end
end
function female(id) setAllVar(id, "gender", "f"); reloadDisplay(id) end
function male(id) setAllVar(id, "gender", "m"); reloadDisplay(id) end
function onOutput(id)
  local last = getCharacterLastMessage(id)
  local d = string.match(last, "%[💖|([+-]?%d+)%]")
  if d then
    local cur = tonumber(getChatVar(id, "affection")) or 0
    setChatVar(id, "affection", tostring(cur + tonumber(d)))
  end
end
listenEdit("editDisplay", function(id, data, meta)
  return data .. "\\n<small class='lua-mark'>lua-display-ok</small>"
end)
`

const card = {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: '테스트봇', description: '{{#when::{{getvar::gender}}::is::f}}그녀는{{:else}}그는{{/when}} {{user}}의 친구다. 호감도 {{getvar::affection}}.',
    personality: '', scenario: '', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', tags: [], creator: 't', character_version: '1',
    first_mes: 'HELLO\n\n@@first@@\n\n{{#when::{{getvar::gender}}::is::f}}그녀{{:else}}그{{/when}}가 웃는다. <img src="{{raw::Smile}}">\n{{#when::{{getglobalvar::toggle_lang}}::is::1}}English mode{{:else}}한국어 모드{{/when}}',
    alternate_greetings: ['두번째 인사 {{user}}'],
    character_book: { scan_depth: 3, token_budget: 1000, recursive_scanning: false, extensions: {}, entries: [] },
    assets: [
      { type: 'icon', uri: 'embeded://assets/icon/images/main.png', name: 'main', ext: 'png' },
      { type: 'x-risu-asset', uri: 'embeded://assets/other/image/smile.png', name: 'Smile', ext: 'png' },
      { type: 'x-risu-asset', uri: 'embeded://assets/other/fonts/f.ttf', name: 'MyFont', ext: 'ttf' },
    ],
    extensions: { risuai: {
      defaultVariables: 'gender=f\naffection=0',
      toggles: 'lang=언어=select=한국어,English\nnsfw=수위 표시',
      backgroundHTML: '<style>.fm-btn{color:red} .box{padding:2px}</style><div class="box">BG {{getvar::affection}}</div>',
      lowLevelAccess: true,
    }, depth_prompt: { depth: 4, prompt: '' } },
  },
}
const module = {
  type: 'risuModule',
  module: {
    name: 'm', id: 'x',
    lorebook: [
      { key: '학교, school', secondkey: '', comment: '학교', content: '@@depth 0\n@@role system\n학교 설정 {{getvar::gender}}', mode: 'normal', insertorder: 100, alwaysActive: false, selective: false },
      { key: '', secondkey: '', comment: '항상', content: '@@probability 50\n@@is_greeting 1\n항상 켜짐', mode: 'constant', insertorder: 90, alwaysActive: true, selective: false },
      { key: 'g', secondkey: '', comment: '폴더', content: '', mode: 'folder', insertorder: 0, alwaysActive: false, selective: false },
    ],
    regex: [
      { comment: 'selector', in: '@@first@@', out: '<div class="fm-btn"><button risu-trigger="female">여성</button><button risu-trigger="male">남성</button> 현재: {{getvar::gender}}</div>', type: 'editdisplay', flag: 'g', ableFlag: false },
      { comment: 'hide-first', in: '@@first@@', out: '', type: 'editprocess' },
      { comment: 'aff card', in: '\\[💖\\|([+-]?\\d+)\\]', out: '<span class="aff">호감 $1 ({{getvar::affection}})</span>', type: 'editdisplay' },
      { comment: 'out-trim', in: 'TRIMME', out: '', type: 'editoutput' },
    ],
    trigger: [{ comment: '', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: lua }] }],
  },
}
const len = Buffer.alloc(4)
const main = Buffer.from(enc(Buffer.from(JSON.stringify(module))))
len.writeUInt32LE(main.length)
const risum = Buffer.concat([Buffer.from([111, 0]), len, main, Buffer.from([0])])

// tiny valid PNG (1x1)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const z = new ZipWriter()
z.addText('card.json', JSON.stringify(card))
z.add('module.risum', risum)
z.add('assets/icon/images/main.png', png)
z.add('assets/other/image/smile.png', png)
z.add('assets/other/fonts/f.ttf', new Uint8Array([0, 1, 0, 0]))
const blob = z.finish()
blob.arrayBuffer().then(b => { fs.writeFileSync(process.argv[2], Buffer.from(b)); console.log('fixture', b.byteLength) })
void zlib
