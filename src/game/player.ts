// 내 프로필 (세이브마다): 이름, 짧은 소개, 외형, 그림용 태그. 대화와 스토리 프롬프트에 짧게 들어간다.
import { z } from 'zod';
import { db } from '../db';
import { now } from '../core/id';
import type { Id, PlayerProfile, Save } from '../types';

export const PLAYER_LIMITS = { name: 24, profile: 600, appearance: 600, imageTags: 400 } as const;

const opt = (max: number, what: string) => z.string().trim().max(max, `${what}은(는) ${max}자까지예요.`);

export const playerInputSchema = z.object({
  name: opt(PLAYER_LIMITS.name, '이름'),
  profile: opt(PLAYER_LIMITS.profile, '소개'),
  appearance: opt(PLAYER_LIMITS.appearance, '외형'),
  imageTags: opt(PLAYER_LIMITS.imageTags, '그림 태그'),
});
export type PlayerInput = z.input<typeof playerInputSchema>;

/** 빈 칸은 빼고, 다 비었으면 undefined */
export function cleanPlayer(p: PlayerProfile | undefined): PlayerProfile | undefined {
  if (!p) return undefined;
  const out: PlayerProfile = {};
  if (p.profile?.trim()) out.profile = p.profile.trim();
  if (p.appearance?.trim()) out.appearance = p.appearance.trim();
  if (p.imageTags?.trim()) out.imageTags = p.imageTags.trim();
  return Object.keys(out).length ? out : undefined;
}

/** 저장 (다른 화면이 그사이 세이브를 고쳤을 수 있어 다시 읽고 이 칸들만 바꾼다). 틀리면 zod 오류 */
export async function savePlayer(saveId: Id, input: PlayerInput): Promise<void> {
  const v = playerInputSchema.parse(input);
  await db.transaction('rw', db.saves, async () => {
    const s = await db.saves.get(saveId);
    if (!s) throw new Error('세이브를 찾을 수 없습니다.');
    const player = cleanPlayer({ profile: v.profile, appearance: v.appearance, imageTags: v.imageTags });
    const { player: _old, ...rest } = s;
    await db.saves.put({ ...rest, playerName: v.name || undefined, ...(player && { player }), updatedAt: now() });
  });
}

/**
 * 프롬프트에 넣는 플레이어 한 덩이 (영어 머리말, 글은 그대로). 이름·소개·외형이 다 비었으면 빈 글.
 * 그림 태그는 넣지 않는다 (글 프롬프트에는 필요 없다).
 */
export function formatPlayer(save: Pick<Save, 'playerName' | 'player'> | undefined, opts: { name?: boolean } = {}): string {
  if (!save) return '';
  const lines: string[] = [];
  const name = save.playerName?.trim();
  if (name && opts.name !== false) lines.push(`Name: ${name}`);
  const profile = save.player?.profile?.trim();
  const looks = save.player?.appearance?.trim();
  if (profile) lines.push(`Profile: ${profile}`);
  if (looks) lines.push(`Appearance: ${looks}`);
  return lines.join('\n');
}
