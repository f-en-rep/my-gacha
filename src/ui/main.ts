import { BRIDGE_CODE, BRIDGE_VERSION } from 'bridge-code'
import { loadCard, addModule, type RisuChar } from '../load'
import { buildSillyTavern } from '../convert/st'
import { buildMarinara } from '../convert/marinara'
import { parseDefaultVariables } from '../convert/cbs-text'
import { isPng, writePngTexts } from '../formats'
import type { Report } from '../convert/report'

const app = document.getElementById('app')!
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: (Node | string | null | false)[]) => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) (el as any)[k] = v
    else if (k === 'text') el.textContent = v
    else el.setAttribute(k, String(v))
  }
  for (const kid of kids) if (kid !== null && kid !== false) el.append(kid)
  return el
}
const mb = (n: number) => (n / 1048576).toFixed(1) + 'MB'

let char: RisuChar | null = null
let target: 'st' | 'marinara' = 'st'
const toggleChoice: Record<string, string> = {}
const bakeChoice: Record<string, string> = {}

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

function pickFiles(accept: string, multiple: boolean, cb: (files: File[]) => void) {
  const input = h('input', { type: 'file', accept }) as HTMLInputElement
  input.multiple = multiple
  input.onchange = () => cb([...(input.files ?? [])])
  input.click()
}

function dropZone(label: string, sub: string, accept: string, multiple: boolean, cb: (files: File[]) => void) {
  const z = h('div', { class: 'drop' }, label, h('small', { text: sub }))
  z.onclick = () => pickFiles(accept, multiple, cb)
  z.ondragover = e => { e.preventDefault(); z.classList.add('over') }
  z.ondragleave = () => z.classList.remove('over')
  z.ondrop = e => { e.preventDefault(); z.classList.remove('over'); cb([...(e.dataTransfer?.files ?? [])]) }
  return z
}

async function onCardFiles(files: File[]) {
  const cardFile = files.find(f => !f.name.toLowerCase().endsWith('.risum'))
  const modules = files.filter(f => f.name.toLowerCase().endsWith('.risum'))
  if (!cardFile && !char) { status('카드 파일(.png/.charx/.json)을 먼저 넣어 주세요.', true); return }
  try {
    if (cardFile) {
      status(`"${cardFile.name}" 읽는 중…`)
      char = await loadCard(cardFile.name, new Uint8Array(await cardFile.arrayBuffer()))
      for (const k of Object.keys(toggleChoice)) delete toggleChoice[k]
      for (const k of Object.keys(bakeChoice)) delete bakeChoice[k]
    }
    for (const m of modules) {
      status(`"${m.name}" 모듈 읽는 중…`)
      addModule(char!, m.name, new Uint8Array(await m.arrayBuffer()), { scripts: true })
    }
    render()
  } catch (e: any) {
    console.error(e)
    status('읽기 실패: ' + (e?.message ?? e), true)
  }
}

let statusEl: HTMLElement
function status(text: string, error = false) {
  if (!statusEl) return
  statusEl.textContent = text
  statusEl.className = error ? 'err' : 'muted'
}

function summary(c: RisuChar) {
  const lua = c.triggers.filter(t => t.effect?.some((e: any) => e.type === 'triggerlua')).length
  const assetBytes = c.assets.reduce((a, b) => a + b.size, 0)
  const toggles = c.toggles.split('\n').filter(l => l.includes('=') && !/=(group|groupEnd|divider|caption)/.test(l)).length
  const chips = [
    c.sourceKind === 'risu' ? 'RisuAI 카드' : 'SillyTavern 계열 카드',
    `로어북 ${c.lore.length}`,
    `정규식 ${c.regex.length}`,
    `트리거 ${c.triggers.length}${lua ? ` (Lua ${lua})` : ''}`,
    `에셋 ${c.assets.length} · ${mb(assetBytes)}`,
    `토글 ${toggles}`,
    `기본 변수 ${Object.keys(parseDefaultVariables(c.defaultVariables)).length}`,
    `인사말 ${1 + c.alternateGreetings.length}`,
  ]
  return h('div', { class: 'panel' },
    h('h2', { text: c.name }),
    h('div', { class: 'chips' }, ...chips.map(t => h('span', { class: 'chip', text: t }))),
    c.modules.length ? h('p', { class: 'muted', text: '추가 모듈: ' + c.modules.join(' / ') }) : null,
    c.notes.length ? h('details', {}, h('summary', { text: `읽으면서 남긴 메모 ${c.notes.length}개` }), h('ul', {}, ...c.notes.map(n => h('li', { text: n })))) : null,
    h('div', { class: 'row', style: 'margin-top:10px' },
      dropZone('리스 모듈(.risum) 추가', '이미지 팩 같은 모듈을 함께 넣을 수 있습니다', '.risum', true, onCardFiles)),
  )
}

function targetPicker() {
  const opt = (value: 'st' | 'marinara', title: string, desc: string) => {
    const box = h('label', { class: 'target' + (target === value ? ' sel' : '') },
      (() => { const r = h('input', { type: 'radio', name: 'target' }) as HTMLInputElement; r.checked = target === value; r.onchange = () => { target = value; render() }; return r })(),
      h('b', { text: title }), h('p', { text: desc }))
    return box
  }
  return h('div', { class: 'panel' },
    h('h2', { text: '어디로 옮길까요?' }),
    h('div', { class: 'targets' },
      opt('st', 'SillyTavern', '리스 실행기를 카드에 넣어 조건문·정규식·Lua·토글·이미지를 리스와 같은 방식으로 실행합니다. JS-Slash-Runner 필요.'),
      opt('marinara', 'Marinara Engine', '스크립트 없이 Marinara 문법으로 옮깁니다. 바꿀 수 없는 부분은 아래에서 고른 값으로 미리 계산합니다.'),
    ),
    target === 'marinara' && char ? marinaraOptions(char) : null,
  )
}

function marinaraOptions(c: RisuChar) {
  const wrap = h('div', {})
  const toggles = c.toggles.split('\n').map(l => l.split('=')).filter(([k, v, t]) => k && v && !['group', 'groupEnd', 'divider', 'caption'].includes(t))
  if (toggles.length) {
    const grid = h('div', { class: 'opts' })
    for (const [key, label, type, options] of toggles) {
      const varKey = 'toggle_' + key
      let input: HTMLElement
      if (type === 'select') {
        const sel = h('select', {}, h('option', { value: 'null', text: '(설정 안 함)' }), ...(options ?? '').split(',').map((o, i) => h('option', { value: String(i), text: o }))) as HTMLSelectElement
        sel.value = toggleChoice[varKey] ?? 'null'
        sel.onchange = () => { toggleChoice[varKey] = sel.value }
        input = sel
      } else if (type === 'text' || type === 'textarea') {
        const inp = h('input', { type: 'text' }) as HTMLInputElement
        inp.value = toggleChoice[varKey] ?? ''
        inp.oninput = () => { toggleChoice[varKey] = inp.value }
        input = inp
      } else {
        const sel = h('select', {}, h('option', { value: '0', text: '끔' }), h('option', { value: '1', text: '켬' })) as HTMLSelectElement
        sel.value = toggleChoice[varKey] ?? '0'
        sel.onchange = () => { toggleChoice[varKey] = sel.value }
        input = sel
      }
      grid.append(h('label', { text: label }), input)
    }
    wrap.append(h('h2', { text: '토글 값', style: 'margin-top:16px' }), h('p', { class: 'muted', text: 'Marinara에는 토글이 없어서 여기서 고른 값으로 고정됩니다.' }), grid)
  }
  const defs = parseDefaultVariables(c.defaultVariables)
  if (Object.keys(defs).length) {
    const grid = h('div', { class: 'opts' })
    for (const [k, v] of Object.entries(defs)) {
      const inp = h('input', { type: 'text', placeholder: v }) as HTMLInputElement
      inp.value = bakeChoice[k] ?? ''
      inp.oninput = () => { if (inp.value) bakeChoice[k] = inp.value; else delete bakeChoice[k] }
      grid.append(h('label', { text: k }), inp)
    }
    wrap.append(
      h('h2', { text: '미리 계산할 때 쓸 변수 값', style: 'margin-top:16px' }),
      h('p', { class: 'muted', text: '대부분의 조건문은 Marinara에서도 그대로 동작합니다. Marinara로 옮길 수 없는 조건문만 이 값으로 미리 계산됩니다. 비워 두면 카드의 기본값을 씁니다. (예: gender에 m을 넣으면 남성 기준)' }),
      grid)
  }
  return wrap
}

function reportView(report: Report) {
  const label = { ok: '완전', approx: '근사', manual: '수동 필요', info: '참고' } as const
  const order = { manual: 0, approx: 1, ok: 2, info: 3 } as const
  const items = [...report.items].sort((a, b) => order[a.level] - order[b.level])
  return h('div', {},
    h('div', { class: 'chips' },
      ...(['ok', 'approx', 'manual', 'info'] as const).map(l => h('span', { class: 'chip', text: `${label[l]} ${report.count(l)}` }))),
    h('div', { style: 'margin-top:8px' },
      ...items.map(i => h('div', { class: 'report-item' }, h('span', { class: 'lv ' + i.level, text: label[i.level] }), h('span', { class: 'area muted', text: i.area }), h('span', { text: i.text })))),
  )
}

async function toPng(bytes: Uint8Array | null): Promise<Uint8Array> {
  if (bytes && isPng(bytes)) return bytes
  const canvas = document.createElement('canvas')
  if (bytes) {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]))
    canvas.width = bmp.width
    canvas.height = bmp.height
    canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  } else {
    canvas.width = canvas.height = 400
    const g = canvas.getContext('2d')!
    g.fillStyle = '#888'
    g.fillRect(0, 0, 400, 400)
  }
  const blob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

async function convert(out: HTMLElement, btn: HTMLButtonElement) {
  if (!char) return
  btn.disabled = true
  out.replaceChildren()
  const bar = h('div', { class: 'progress' }, h('div', {}))
  const msg = h('p', { class: 'muted', text: '변환 중…' })
  out.append(msg, bar)
  try {
    if (target === 'st') {
      const r = await buildSillyTavern(char, {
        bridgeCode: BRIDGE_CODE,
        bridgeVersion: BRIDGE_VERSION,
        onProgress: (d, t) => { (bar.firstChild as HTMLElement).style.width = `${t ? (d / t) * 100 : 100}%` },
      })
      ;(bar.firstChild as HTMLElement).style.width = '100%'
      const dl = h('button', { text: `${r.fileName} 받기 (${mb(r.blob.size)})` }) as HTMLButtonElement
      dl.onclick = () => download(r.blob, r.fileName)
      msg.replaceWith(h('div', {},
        h('div', { class: 'row' }, dl),
        h('ol', { class: 'steps' },
          h('li', { text: 'ST에서 캐릭터 가져오기(Import)로 이 .charx 파일을 고릅니다.' }),
          h('li', { text: '카드를 열면 JS-Slash-Runner가 "캐릭터 스크립트 허용"을 묻습니다 → 허용.' }),
          h('li', { text: '채팅창 아래 "리스 설정" 버튼으로 토글을 고를 수 있습니다.' }),
        )))
      out.append(reportView(r.report))
      download(r.blob, r.fileName)
    } else {
      const r = await buildMarinara(char, { toggles: { ...toggleChoice }, bake: { ...bakeChoice }, inlineLimit: 24 * 1024 * 1024 })
      const png = writePngTexts(await toPng(char.icon ? await char.icon.data() : null), { chara: r.cardB64 })
      const name = `${char.name.replace(/[\\/:*?"<>|]/g, '') || 'character'}.marinara.png`
      const blob = new Blob([png as BlobPart], { type: 'image/png' })
      ;(bar.firstChild as HTMLElement).style.width = '100%'
      const dl = h('button', { text: `${name} 받기 (${mb(blob.size)})` }) as HTMLButtonElement
      dl.onclick = () => download(blob, name)
      const json = h('button', { class: 'secondary', text: 'JSON으로 받기' }) as HTMLButtonElement
      json.onclick = () => download(new Blob([JSON.stringify(r.card, null, 2)], { type: 'application/json' }), name.replace(/\.png$/, '.json'))
      msg.replaceWith(h('div', {}, h('div', { class: 'row' }, dl, json), h('p', { class: 'muted', text: 'Marinara의 캐릭터 가져오기에서 이 PNG를 고르면 됩니다.' })))
      out.append(reportView(r.report))
      download(blob, name)
    }
  } catch (e: any) {
    console.error(e)
    msg.textContent = '변환 실패: ' + (e?.message ?? e)
    msg.className = 'err'
  } finally {
    btn.disabled = false
  }
}

function render() {
  app.replaceChildren()
  statusEl = h('p', { class: 'muted' })
  app.append(h('div', { class: 'panel' },
    dropZone(char ? '다른 카드로 바꾸기' : '카드 파일을 끌어다 놓거나 클릭해서 고르세요', '.png · .charx · .jpg(charx) · .json — 리스 모듈(.risum)도 함께 넣을 수 있습니다', '.png,.charx,.json,.jpg,.jpeg,.risum', true, onCardFiles),
    statusEl))
  if (!char) return
  app.append(summary(char), targetPicker())
  const out = h('div', {})
  const btn = h('button', { text: target === 'st' ? 'SillyTavern용으로 변환' : 'Marinara용으로 변환' }) as HTMLButtonElement
  btn.onclick = () => convert(out, btn)
  app.append(h('div', { class: 'panel' }, h('div', { class: 'row' }, btn), out))
}

render()
