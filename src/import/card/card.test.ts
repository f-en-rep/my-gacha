import { describe, expect, it } from 'vitest';
import { strToU8, zipSync, zlibSync } from 'fflate';
import { CardError, exampleLines, parseCardBytes, parseCardJson, readPngSize, readPngText, stripMarkup } from './index';

// ── 테스트용 PNG 만들기 ──

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  const body = new Uint8Array([...typeBytes, ...data]);
  return new Uint8Array([...u32(data.length), ...body, ...u32(crc32(body))]);
}

function latin1(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function tEXt(key: string, text: string): Uint8Array {
  return chunk('tEXt', new Uint8Array([...latin1(key), 0, ...latin1(text)]));
}

function iTXt(key: string, text: string, compress = false): Uint8Array {
  const body = compress ? zlibSync(strToU8(text)) : strToU8(text);
  return chunk('iTXt', new Uint8Array([...latin1(key), 0, compress ? 1 : 0, 0, 0, 0, ...body]));
}

function png(...extra: Uint8Array[]): Uint8Array {
  const ihdr = chunk('IHDR', new Uint8Array([...u32(400), ...u32(600), 8, 6, 0, 0, 0]));
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, ...extra, chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function b64(obj: unknown): string {
  const bytes = strToU8(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const V2 = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: '세라',
    description: '<div style="color:red">{{char}}는 은발의 검사다.</div><style>.x{color:red}</style>',
    personality: '차분하고 {{user}}에게 다정하다.',
    scenario: '{{user}}와 {{char}}는 여관에서 만났다.',
    first_mes: '*세라가 고개를 든다.* "어서 와, {{user}}."',
    mes_example: '<START>\n{{user}}: 안녕\n{{char}}: "반가워."\n{{char}}: 검은 내 친구야.',
    creator_notes: '노트',
    system_prompt: '',
    alternate_greetings: ['"또 왔구나."'],
    tags: ['fantasy', 'swordswoman'],
    creator: 'tester',
  },
};

const V3 = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    ...V2.data,
    name: 'Seraphina Long',
    nickname: 'Sera',
    description: '<char> loves <user>. &lt;3 &amp; more',
    assets: [{ type: 'icon', uri: 'embeded://assets/icon/images/main.png', name: 'main', ext: 'png' }],
  },
};

describe('PNG 조각 읽기', () => {
  it('tEXt와 iTXt(압축 포함)를 읽고 IHDR 크기를 준다', () => {
    const bytes = png(tEXt('chara', 'abc'), iTXt('ccv3', '한글 글', true), iTXt('note', 'plain'));
    expect(readPngText(bytes)).toEqual({ chara: 'abc', ccv3: '한글 글', note: 'plain' });
    expect(readPngSize(bytes)).toEqual({ width: 400, height: 600 });
  });

  it('PNG가 아니면 던진다', () => {
    expect(() => readPngText(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe('카드 읽기', () => {
  it('PNG V2 (tEXt chara): 그림과 글을 정리해서 준다', () => {
    const bytes = png(tEXt('chara', b64(V2)));
    const c = parseCardBytes('sera.png', bytes);
    expect(c.spec).toBe('chara_card_v2');
    expect(c.name).toBe('세라');
    expect(c.description).toBe('세라는 은발의 검사다.');
    expect(c.personality).toBe('차분하고 {{user}}에게 다정하다.');
    expect(c.firstMes).toContain('어서 와, {{user}}.');
    expect(c.alternateGreetings).toEqual(['"또 왔구나."']);
    expect(c.tags).toEqual(['fantasy', 'swordswoman']);
    expect(c.creator).toBe('tester');
    expect(c.image?.type).toBe('image/png');
    expect(c.image?.size).toBe(bytes.length);
  });

  it('PNG에 ccv3와 chara가 다 있으면 ccv3 (iTXt)', () => {
    const bytes = png(tEXt('chara', b64(V2)), iTXt('ccv3', b64(V3)));
    const c = parseCardBytes('x.png', bytes);
    expect(c.spec).toBe('chara_card_v3');
    expect(c.name).toBe('Seraphina Long');
    // nickname으로 {{char}}를 바꾼다, 엔티티도 푼다
    expect(c.description).toBe('Sera loves {{user}}. <3 & more');
  });

  it('카드 정보가 없는 PNG는 한국어 오류', () => {
    expect(() => parseCardBytes('x.png', png())).toThrow(CardError);
  });

  it('JSON V3', () => {
    const c = parseCardBytes('sera.json', strToU8(JSON.stringify(V3)));
    expect(c.spec).toBe('chara_card_v3');
    expect(c.image).toBeUndefined();
    expect(c.scenario).toBe('{{user}}와 Sera는 여관에서 만났다.');
  });

  it('JSON V1 (평평한 모양)', () => {
    const c = parseCardJson({ name: 'Bob', description: '{{char}} is tall.', personality: 'kind', scenario: '', first_mes: 'Hi!', mes_example: '' });
    expect(c.spec).toBe('chara_card_v1');
    expect(c.description).toBe('Bob is tall.');
    expect(c.alternateGreetings).toEqual([]);
  });

  it('charx: card.json과 대표 아이콘', () => {
    const icon = png();
    const zip = zipSync({ 'card.json': strToU8(JSON.stringify(V3)), 'assets/icon/images/main.png': icon, 'module.risum': new Uint8Array([1]) });
    const c = parseCardBytes('sera.charx', zip);
    expect(c.name).toBe('Seraphina Long');
    expect(c.image?.type).toBe('image/png');
    expect(c.image?.size).toBe(icon.length);
  });

  it('이상한 파일은 거절', () => {
    expect(() => parseCardBytes('a.txt', strToU8('hello'))).toThrow(CardError);
    expect(() => parseCardBytes('a.json', strToU8('{"foo":1}'))).toThrow(CardError);
  });
});

describe('글 다듬기', () => {
  it('HTML·CSS·주석·그림을 걷어 낸다', () => {
    const s = stripMarkup('<!-- x --><h1>제목</h1><p>첫 줄<br>둘째 줄</p><script>alert(1)</script>![a](b.png)<img src=x onerror=alert(1)>끝');
    expect(s).toBe('제목\n\n첫 줄\n둘째 줄\n끝');
  });

  it('대사 예시에서 캐릭터 줄만', () => {
    expect(exampleLines('{{user}}: 안녕\n세라: "반가워."\n세라: 좋아', '세라')).toEqual(['"반가워."', '좋아']);
  });
});
