import fs from 'node:fs'
import { loadCard } from '../src/load'
import { buildSillyTavern } from '../src/convert/st'
import { buildMarinara } from '../src/convert/marinara'

const bytes = new Uint8Array(fs.readFileSync(process.argv[2]))
const char = await loadCard('fixture.charx', bytes)
console.log('loaded', char.name, 'lore', char.lore.length, 'regex', char.regex.length, 'triggers', char.triggers.length, 'assets', char.assets.map(a => a.name + '.' + a.ext))
const st = await buildSillyTavern(char, { bridgeCode: '/*bridge*/', bridgeVersion: 'test' })
const d = st.card.data
console.log('--- ST description:', d.description)
console.log('--- ST lore:', JSON.stringify(d.character_book.entries.map((e: any) => ({ k: e.keys, c: e.content, const: e.constant, pos: e.extensions.position, depth: e.extensions.depth, prob: e.extensions.probability }))))
console.log('--- ST assets:', JSON.stringify(d.assets))
console.log('--- runtime assets:', JSON.stringify(st.runtime.assets.map((a: any) => [a.name, a.url.slice(0, 50)])))
console.log('--- ST report:'); for (const i of st.report.items) console.log(' ', i.level, i.area, i.text)
fs.writeFileSync(process.argv[3], Buffer.from(await st.blob.arrayBuffer()))
fs.writeFileSync(process.argv[4], JSON.stringify(st.runtime))
const mr = await buildMarinara(char, { toggles: { toggle_lang: '1' }, bake: {}, inlineLimit: 1e7 })
const md = mr.card.data
console.log('=== Marinara description:', md.description)
console.log('=== Marinara first_mes:', md.first_mes.replace(/data:[^"]+/, 'data:…'))
console.log('=== Marinara regex:', JSON.stringify(md.extensions.regex_scripts.map((r: any) => [r.scriptName, r.findRegex, r.replaceString.slice(0, 120), r.placement, r.markdownOnly, r.promptOnly])))
console.log('=== Marinara report:'); for (const i of mr.report.items) console.log(' ', i.level, i.area, i.text)
