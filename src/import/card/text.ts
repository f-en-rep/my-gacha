// 카드 글 다듬기: {{char}} 바꾸기, HTML·CSS 걷어 내기. 글만 남긴다 (화면에서 HTML로 그리지 않는다).

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML·CSS를 가볍게 걷어 낸다. 블록 태그는 줄바꿈으로 */
export function stripMarkup(s: string): string {
  let t = s.replace(/\r\n?/g, '\n');
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<(style|script|head|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, '');
  t = t.replace(/<(style|script)\b[\s\S]*$/gi, ''); // 닫히지 않은 블록
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/?(p|div|li|ul|ol|h[1-6]|tr|table|section|article|details|summary|blockquote|pre|hr)\b[^>]*>/gi, '\n');
  t = t.replace(/<\/?[a-z][\w:-]*(?:\s[^<>]*)?\/?>/gi, '');
  // 마크다운 그림·리스 그림 매크로
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/\{\{(?:img|image|emotion|asset|raw|inlay|inlayed)::[^}]*\}\}/gi, '');
  t = decodeEntities(t);
  return t
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** {{char}}, <char>, <bot> → 이름. <user> → {{user}} (나중에 플레이어 이름으로) */
export function fillChar(s: string, name: string): string {
  return s
    .replace(/\{\{\s*(char|bot)\s*\}\}/gi, name)
    .replace(/<(char|bot)>/gi, name)
    .replace(/\{\{\s*user\s*\}\}|<user>/gi, '{{user}}');
}

/** 카드 글 하나 정리 */
export function cleanCardText(v: unknown, name: string): string {
  if (typeof v !== 'string') return '';
  return stripMarkup(fillChar(v, name));
}

/** {{user}}를 플레이어 이름(또는 "당신")으로 */
export function fillUser(s: string, you: string): string {
  return s.replace(/\{\{user\}\}/g, you);
}

/** 대사 예시에서 이 캐릭터가 한 줄들 ("이름: ...") */
export function exampleLines(mesExample: string, name: string): string[] {
  const head = new RegExp(`^\\s*(?:\\*\\*)?${escapeRe(name)}(?:\\*\\*)?\\s*[:：]\\s*`);
  return mesExample
    .split('\n')
    .filter((l) => head.test(l))
    .map((l) => l.replace(head, '').trim())
    .filter(Boolean);
}
