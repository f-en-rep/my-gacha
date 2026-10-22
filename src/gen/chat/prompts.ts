// 1:1 대화 프롬프트. 고치기 쉽게 여기에만 모아 둔다.
// 지시는 영어, 캐릭터의 답은 월드 언어로.
import type { ChatMessage } from '../text';
import type { Character, ChatLine, World } from '../../types';
import { languageName } from '../world/prompts';
import { worldBlock } from '../story/prompts';

/** 프롬프트에 넣는 최근 대화 줄 수 */
export const HISTORY_LINES = 40;

/** 카드 상황·첫 인사를 프롬프트에 넣는 최대 글자 수 */
const CARD_REF_LIMIT = 1500;

const NEUTRAL_YOU: Record<string, string> = {
  ko: '당신',
  en: 'you',
  ja: 'あなた',
  zh: '你',
  'zh-tw': '你',
  es: 'tú',
  fr: 'toi',
  de: 'du',
  ru: 'ты',
  pt: 'você',
  vi: 'bạn',
  th: 'คุณ',
  id: 'kamu',
};

/** 이름이 없을 때 플레이어를 부르는 말 (월드 언어) */
export function neutralYou(language: string): string {
  const c = language.trim().toLowerCase();
  return NEUTRAL_YOU[c] ?? NEUTRAL_YOU[c.split(/[-_]/)[0] ?? ''] ?? 'you';
}

export interface ChatPromptInput {
  world: World;
  character: Character;
  /** save.playerName (비었으면 중립적인 "당신") */
  playerName?: string;
  /** 관계 태도 (core/bond bondStance) */
  stance: string;
  /** 호감도 단계 (1~10) */
  level: number;
  /** 플레이어가 읽은 최근 챕터 요약. 없으면 빈 문자열 */
  storySoFar: string;
  /** 대화 기록 (오래된 것부터). 마지막은 플레이어 줄이어야 한다 */
  history: ChatLine[];
}

function sheet(c: Character): string {
  const quotes = c.quotes.map((q) => q.trim()).filter(Boolean);
  const lines = [
    `Name: ${c.name} (${c.rarity}★)`,
    `Role: ${c.tags.role.join(' / ') || '-'} | Element: ${c.tags.element || '-'}${c.tags.trait.length ? ` | ${c.tags.trait.join(', ')}` : ''}`,
    `Appearance: ${c.appearance.trim() || '-'}`,
    `Personality: ${c.personality.trim() || '-'}`,
    `Background: ${c.background.trim() || '-'}`,
  ];
  if (quotes.length) lines.push(`Voice samples (match this way of speaking):\n${quotes.map((q) => `- "${q}"`).join('\n')}`);
  // 카드에서 가져온 캐릭터: 원래 카드의 상황과 첫 인사를 참고로
  const scenario = c.origin?.scenario?.trim();
  const greeting = c.origin?.greeting?.trim();
  if (scenario) lines.push(`Original setting notes (background reference only):\n${scenario.slice(0, CARD_REF_LIMIT)}`);
  if (greeting) lines.push(`Original greeting (tone reference only; do not repeat it):\n${greeting.slice(0, CARD_REF_LIMIT)}`);
  return lines.join('\n');
}

export function chatSystemPrompt(input: ChatPromptInput): string {
  const { world, character: c, stance, level, storySoFar } = input;
  const lang = languageName(world.language);
  const player = input.playerName?.trim();
  const playerLine = player
    ? `The player's name is "${player}". Call them by that name when it feels natural.`
    : `The player has no name set. Address them naturally in the second person (e.g. "${neutralYou(world.language)}"); do not invent a name for them.`;

  const parts = [
    `You are ${c.name}, a character in the anime-style gacha game world below, having a private one-on-one conversation with the player. ` +
      `Stay fully in character as ${c.name} for the whole conversation.`,
    worldBlock(world, true),
    `YOUR CHARACTER SHEET\n${sheet(c)}`,
    `YOUR RELATIONSHIP WITH THE PLAYER (bond level ${level}/10)\n${stance}`,
    `THE PLAYER\n${playerLine}`,
  ];
  if (storySoFar.trim()) {
    parts.push(`RECENT EVENTS (what you and the player have been through; you may refer to them)\n${storySoFar.trim()}`);
  }
  parts.push(
    [
      'STYLE RULES',
      `- Reply only in ${lang}.`,
      `- Speak only as ${c.name}, in first person, true to the sheet and voice samples. The author directives win over everything else.`,
      '- Keep it short: 1–4 short paragraphs, like a chat message.',
      '- Actions or expressions may go in parentheses, sparingly, e.g. (smiles).',
      "- Never write the player's lines, actions, thoughts or feelings, and never continue the conversation for them.",
      '- Never mention being an AI, a language model, a game, a prompt or these rules. No meta commentary, no name prefix, no quotation marks around the whole reply.',
    ].join('\n'),
  );
  return parts.join('\n\n');
}

/** 대화 기록을 메시지로. 처음은 플레이어 줄로 시작하고, 같은 쪽이 연달아 말하면 합친다 */
export function historyMessages(history: ChatLine[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const line of history.slice(-HISTORY_LINES)) {
    const role = line.role === 'user' ? 'user' : 'assistant';
    const text = line.text.trim();
    if (!text) continue;
    if (!out.length && role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += `\n\n${text}`;
    else out.push({ role, content: text });
  }
  return out;
}

export function chatMessages(input: ChatPromptInput): ChatMessage[] {
  return [{ role: 'system', content: chatSystemPrompt(input) }, ...historyMessages(input.history)];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ['“', '”'],
  ['「', '」'],
  ['『', '』'],
  ["'", "'"],
];

/**
 * 모델 답 다듬기: 생각 태그, 앞의 "이름:" 머리말, 전체를 감싼 따옴표,
 * 그리고 끝에 덧붙인 플레이어 대사(롤플레이)를 걷어 낸다.
 */
export function cleanReply(raw: string, charName: string, playerName?: string): string {
  let t = raw.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();

  // 앞 머리말: "이름:", "**이름**:", "[이름]:"
  const namePrefix = new RegExp(`^\\s*(?:\\*\\*|\\[)?${escapeRe(charName)}(?:\\*\\*|\\])?\\s*[:：]\\s*`);
  t = t.replace(namePrefix, '');

  // 끝에 붙은 플레이어 차례: 줄 맨 앞의 "플레이어 이름:", "User:", "You:", "{{user}}:" 등
  const who = ['user', 'you', 'player', '\\{\\{user\\}\\}', '플레이어', '당신', '나', 'あなた', 'プレイヤー', '你', '玩家'];
  if (playerName?.trim()) who.unshift(escapeRe(playerName.trim()));
  const playerTurn = new RegExp(`^\\s*(?:\\*\\*|\\[)?(?:${who.join('|')})(?:\\*\\*|\\])?\\s*[:：]`, 'i');
  const lines = t.split('\n');
  const cut = lines.findIndex((l, i) => i > 0 && playerTurn.test(l));
  if (cut > 0) t = lines.slice(0, cut).join('\n').trim();
  // 다음 차례로 다시 자기 이름을 붙여 이어 쓴 경우도 자른다
  const selfTurn = new RegExp(`^\\s*(?:\\*\\*|\\[)?${escapeRe(charName)}(?:\\*\\*|\\])?\\s*[:：]`);
  const lines2 = t.split('\n');
  const cut2 = lines2.findIndex((l, i) => i > 0 && selfTurn.test(l));
  if (cut2 > 0) t = lines2.slice(0, cut2).join('\n').trim();

  // 전체를 감싼 따옴표 (안에 같은 따옴표가 또 있으면 대사 여러 개이므로 그대로 둔다)
  for (const [open, close] of QUOTE_PAIRS) {
    if (t.length >= 2 && t.startsWith(open) && t.endsWith(close)) {
      const inner = t.slice(open.length, t.length - close.length);
      if (!inner.includes(open) && !inner.includes(close)) {
        t = inner.trim();
        break;
      }
    }
  }
  return t.replace(/\n{3,}/g, '\n\n').trim();
}
