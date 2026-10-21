// 호감도 단계 보상 받기. 계산은 core/bond, 여기서는 세이브에 반영만 한다.
import { db } from '../db';
import { BOND_REWARDS, claimableLevels } from '../core/bond';
import { now } from '../core/id';
import type { Id } from '../types';

/**
 * 호감도 단계 보상을 받는다. 받을 수 있을 때만 뽑기 재화를 더하고 받은 단계로 기록한다.
 * level을 빼면 지금 받을 수 있는 단계를 모두 받는다. 준 양을 돌려준다 (못 받으면 0).
 */
export async function claimBondReward(saveId: Id, characterId: Id, level?: number): Promise<number> {
  return db.transaction('rw', db.saves, async () => {
    const s = await db.saves.get(saveId);
    if (!s) return 0;
    const bond = s.bonds?.[characterId];
    if (!bond) return 0;
    const open = claimableLevels(bond);
    const levels = level === undefined ? open : open.includes(level) ? [level] : [];
    const amount = levels.reduce((sum, l) => sum + (BOND_REWARDS[l] ?? 0), 0);
    if (amount <= 0) return 0;
    await db.saves.put({
      ...s,
      wallet: { ...s.wallet, pull: s.wallet.pull + amount },
      bonds: { ...s.bonds, [characterId]: { ...bond, claimed: [...bond.claimed, ...levels].sort((a, b) => a - b) } },
      updatedAt: now(),
    });
    return amount;
  });
}
