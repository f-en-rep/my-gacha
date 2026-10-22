import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { clearChapter, newSave, setStoryProgress, STORY_CLEAR_REWARD } from '../../game/store';

let saveId = '';

beforeEach(async () => {
  await db.saves.clear();
  const s = newSave('w1');
  s.wallet.pull = 0;
  saveId = s.id;
  await db.saves.put(s);
});

describe('처음부터 다시 읽기', () => {
  it('다 읽음과 보상은 그대로: 다시 끝까지 읽어도 보상은 한 번', async () => {
    await setStoryProgress(saveId, 'ch1', 5, 3);
    expect(await clearChapter(saveId, 'ch1')).toBe(true);
    const clearedAt = (await db.saves.get(saveId))!.story!.ch1!.clearedAt;
    expect(clearedAt).toBeTruthy();

    // "처음부터": 위치만 0으로
    await setStoryProgress(saveId, 'ch1', 0, 0);
    let s = (await db.saves.get(saveId))!;
    expect(s.story!.ch1).toEqual({ beat: 0, segment: 0, clearedAt });

    expect(await clearChapter(saveId, 'ch1')).toBe(false);
    s = (await db.saves.get(saveId))!;
    expect(s.wallet.pull).toBe(STORY_CLEAR_REWARD);
    expect(s.story!.ch1!.clearedAt).toBe(clearedAt);
  });
});
