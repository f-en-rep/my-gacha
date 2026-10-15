import fs from 'node:fs'
import { loadCard } from '../src/load'
import { buildSillyTavern } from '../src/convert/st'
const char = await loadCard('fixture.charx', new Uint8Array(fs.readFileSync(process.argv[2])))
const st = await buildSillyTavern(char, { bridgeCode: fs.readFileSync('dist/bridge.js', 'utf8'), bridgeVersion: 'test' })
fs.writeFileSync(process.argv[3], Buffer.from(await st.blob.arrayBuffer()))
console.log('written', st.fileName, st.blob.size)
