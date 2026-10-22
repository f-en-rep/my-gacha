// 1:1 대화 생성. 문장 연결(없으면 구조화 연결)로 캐릭터의 답을 쓴다.
//
// - sendChat: 플레이어 줄을 먼저 저장 → 답 생성 → 캐릭터 줄 저장 + 호감도 (한 트랜잭션)
// - 생성이 실패해도 플레이어 줄은 남긴다. 화면은 retryLast로 다시 시도한다
// - regenerateLast: 마지막 답을 새로 쓴다 (호감도 추가 없음). 새 답이 나온 뒤에 옛 답을 지운다
// - 같은 캐릭터에게는 한 번에 하나만 답을 쓴다 (isReplying)
import { db } from '../../db';
import { addChatPoints, bondLevel, bondStance } from '../../core/bond';
import { now } from '../../core/id';
import { today } from '../../game/store';
import { chatComplete, describeTextError } from '../text';
import { formatStorySoFar, resolveProseProfile } from '../story';
import type { ChatLine, Character, Id, Save, TextProfile, World } from '../../types';
import { promptCtx } from '../prompts';
import { HISTORY_LINES, chatMessages, cleanReply } from './prompts';

export { HISTORY_LINES, chatMessages, chatSystemPrompt, cleanReply, historyMessages, neutralYou } from './prompts';

export interface ChatGenOptions {
  signal?: AbortSignal;
}

/** 대화에 넣는 "최근 이야기" 챕터 수 (플레이어가 다 읽은 챕터만) */
const STORY_RECENT = 2;

export const NOT_OWNED_MESSAGE = '보유한 캐릭터와만 대화할 수 있습니다.';
export const BUSY_MESSAGE = '아직 답을 쓰고 있어요. 잠시만 기다려 주세요.';

const inFlight = new Set<Id>();

/** 이 캐릭터의 답을 쓰는 중인지. isReplying(characterId) 또는 isReplying(saveId, characterId) */
export function isReplying(characterIdOrSaveId: Id, characterId?: Id): boolean {
  return inFlight.has(characterId ?? characterIdOrSaveId);
}

async function exclusive<T>(characterId: Id, fn: () => Promise<T>): Promise<T> {
  if (inFlight.has(characterId)) throw new Error(BUSY_MESSAGE);
  inFlight.add(characterId);
  try {
    return await fn();
  } finally {
    inFlight.delete(characterId);
  }
}

interface Ctx {
  save: Save;
  world: World;
  character: Character;
}

async function loadCtx(saveId: Id, characterId: Id): Promise<Ctx> {
  const save = await db.saves.get(saveId);
  if (!save) throw new Error('세이브를 찾을 수 없습니다.');
  const character = await db.characters.get(characterId);
  if (!character || character.worldId !== save.worldId || !save.owned[characterId]) throw new Error(NOT_OWNED_MESSAGE);
  const world = await db.worlds.get(save.worldId);
  if (!world) throw new Error('월드를 찾을 수 없습니다.');
  return { save, world, character };
}

function linesOf(saveId: Id, characterId: Id): Promise<ChatLine[]> {
  return db.chatLines.where('[saveId+characterId]').equals([saveId, characterId]).sortBy('id');
}

/** 플레이어가 끝까지 읽은 챕터들 중 최근 것의 요약 (스포일러 방지) */
async function recentStory(save: Save): Promise<string> {
  const cleared = (await db.chapters.where('worldId').equals(save.worldId).toArray()).filter((c) => save.story?.[c.id]?.clearedAt);
  return formatStorySoFar(cleared, STORY_RECENT);
}

/** history(마지막은 플레이어 줄)에 대한 캐릭터의 답 글. 실패하면 한국어 오류 */
async function writeReply(ctx: Ctx, history: ChatLine[], signal?: AbortSignal): Promise<string> {
  let profile: TextProfile | undefined;
  try {
    profile = await resolveProseProfile();
    signal?.throwIfAborted();
    const level = bondLevel(ctx.save.bonds?.[ctx.character.id]?.points ?? 0).level;
    const messages = chatMessages(
      {
        world: ctx.world,
        character: ctx.character,
        playerName: ctx.save.playerName,
        stance: bondStance(level),
        level,
        storySoFar: await recentStory(ctx.save),
        history: history.slice(-HISTORY_LINES),
      },
      await promptCtx('chat'),
    );
    const res = await chatComplete(profile, messages, {
      signal,
      maxTokens: profile.maxTokens ?? 1024,
      temperature: profile.temperature ?? 0.9,
    });
    const text = cleanReply(res.text, ctx.character.name, ctx.save.playerName);
    if (!text) throw new Error('답이 비어 있습니다. 다시 시도해 주세요.');
    return text;
  } catch (err) {
    throw new Error(describeTextError(err, profile), { cause: err });
  }
}

function charLine(saveId: Id, characterId: Id, text: string): ChatLine {
  return { saveId, characterId, role: 'char', text, at: now() };
}

/** 캐릭터 줄 저장 + (원하면) 호감도 점수. 한 트랜잭션 */
async function storeReply(saveId: Id, characterId: Id, text: string, withPoints: boolean, replaceId?: number): Promise<ChatLine> {
  const line = charLine(saveId, characterId, text);
  await db.transaction('rw', db.chatLines, db.saves, async () => {
    if (replaceId !== undefined) await db.chatLines.delete(replaceId);
    line.id = await db.chatLines.add(line);
    if (!withPoints) return;
    const s = await db.saves.get(saveId);
    if (!s) return;
    const { bond } = addChatPoints(s.bonds?.[characterId], today());
    await db.saves.put({ ...s, bonds: { ...s.bonds, [characterId]: bond }, updatedAt: now() });
  });
  return line;
}

/**
 * 플레이어 말을 저장하고, 캐릭터의 답을 써서 저장한 뒤 그 줄을 돌려준다 (문장 연결, 없으면 구조화 연결).
 * 호감도 점수도 더한다. 보유한 캐릭터만 대화할 수 있다.
 * 답 생성이 실패하면 플레이어 줄은 남기고 한국어 오류를 던진다 (retryLast로 다시).
 */
export async function sendChat(saveId: Id, characterId: Id, text: string, opts: ChatGenOptions = {}): Promise<ChatLine> {
  const said = text.trim();
  if (!said) throw new Error('할 말을 입력해 주세요.');
  return exclusive(characterId, async () => {
    const ctx = await loadCtx(saveId, characterId);
    await db.chatLines.add({ saveId, characterId, role: 'user', text: said, at: now() });
    const history = await linesOf(saveId, characterId);
    const reply = await writeReply(ctx, history, opts.signal);
    return storeReply(saveId, characterId, reply, true);
  });
}

/**
 * 마지막 플레이어 줄에 답이 없을 때(생성 실패 뒤) 다시 답을 쓴다.
 * 이 대화는 아직 점수를 받지 않았으므로 호감도를 더한다.
 */
export async function retryLast(saveId: Id, characterId: Id, opts: ChatGenOptions = {}): Promise<ChatLine> {
  return exclusive(characterId, async () => {
    const ctx = await loadCtx(saveId, characterId);
    const history = await linesOf(saveId, characterId);
    if (history[history.length - 1]?.role !== 'user') throw new Error('답을 기다리는 말이 없습니다.');
    const reply = await writeReply(ctx, history, opts.signal);
    return storeReply(saveId, characterId, reply, true);
  });
}

/**
 * 마지막 캐릭터 답을 지우고 다시 쓴다 (호감도 추가 없음).
 * 새 답이 나온 뒤에 옛 답을 바꾸므로, 실패하면 옛 답이 그대로 남는다.
 * 마지막 줄이 답 없는 플레이어 줄이면 retryLast와 같다.
 */
export async function regenerateLast(saveId: Id, characterId: Id, opts: ChatGenOptions = {}): Promise<ChatLine> {
  const lines = await linesOf(saveId, characterId);
  if (lines[lines.length - 1]?.role === 'user') return retryLast(saveId, characterId, opts);
  return exclusive(characterId, async () => {
    const ctx = await loadCtx(saveId, characterId);
    const history = await linesOf(saveId, characterId);
    const last = history[history.length - 1];
    if (!last || last.role !== 'char') throw new Error('다시 쓸 답이 없습니다.');
    const upTo = history.slice(0, -1);
    while (upTo.length && upTo[upTo.length - 1]!.role !== 'user') upTo.pop();
    if (!upTo.length) throw new Error('다시 쓸 답이 없습니다.');
    const reply = await writeReply(ctx, upTo, opts.signal);
    return storeReply(saveId, characterId, reply, false, last.id);
  });
}
