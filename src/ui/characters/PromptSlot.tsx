// 캐릭터 그림 프롬프트 슬롯: 캐릭터 태그와 캐릭터 네거티브를 고치고, 실제로 보낼 프롬프트를 미리 본다.
import { useEffect, useState } from 'react';
import { db } from '../../db';
import { now } from '../../core/id';
import { buildPortraitPrompt, getImageProfile } from '../../game/portraits';
import { isNovelAIV4Model } from '../../gen/image';
import { useLiveQuery } from '../hooks';
import type { Character, ImageProfile, World } from '../../types';

export function PromptSlot({ character: c }: { character: Character }) {
  const world = useLiveQuery(() => db.worlds.get(c.worldId), [c.worldId]);
  const profile = useLiveQuery<ImageProfile | undefined>(() => getImageProfile(), []);
  const [tags, setTags] = useState(c.imageTags);
  const [neg, setNeg] = useState(c.imageNegative ?? '');
  const [saved, setSaved] = useState(false);

  // 다른 캐릭터로 바뀌면 입력값도 바꾼다
  useEffect(() => {
    setTags(c.imageTags);
    setNeg(c.imageNegative ?? '');
    setSaved(false);
  }, [c.id, c.imageTags, c.imageNegative]);

  const dirty = tags !== c.imageTags || neg !== (c.imageNegative ?? '');

  async function save() {
    await db.characters.update(c.id, { imageTags: tags.trim(), imageNegative: neg.trim() || undefined, updatedAt: now() });
    setSaved(true);
  }

  const preview = buildPortraitPrompt(world as World | undefined, { imageTags: tags, imageNegative: neg }, profile?.gen);
  const slots = profile?.provider === 'novelai' && isNovelAIV4Model(profile.model);

  return (
    <section className="cd-sec cd-prompt">
      <h3>그림 프롬프트 (캐릭터 슬롯)</h3>
      <label className="field">
        <span className="label">캐릭터 태그</span>
        <textarea rows={3} value={tags} onChange={(e) => (setTags(e.target.value), setSaved(false))} spellCheck={false} />
      </label>
      <label className="field">
        <span className="label">캐릭터 네거티브 (선택)</span>
        <textarea rows={2} value={neg} onChange={(e) => (setNeg(e.target.value), setSaved(false))} placeholder="이 캐릭터에게만 빼고 싶은 것" spellCheck={false} />
      </label>
      <div className="cd-prompt-actions">
        <button type="button" className="btn btn-small btn-primary" disabled={!dirty || !tags.trim()} onClick={() => void save()}>
          저장
        </button>
        <span className="small muted">{saved && !dirty ? '저장됨. 다음 그리기부터 적용됩니다.' : dirty ? '저장 안 됨' : ''}</span>
      </div>
      <details className="cd-prompt-preview">
        <summary>실제로 보내는 프롬프트 보기</summary>
        <dl>
          <dt>공통 프롬프트</dt>
          <dd>{preview.prompt || '—'}</dd>
          <dt>{slots ? '캐릭터 슬롯 1' : '이어 붙는 캐릭터 태그'}</dt>
          <dd>{preview.characters[0]?.prompt || '—'}</dd>
          <dt>네거티브</dt>
          <dd>{preview.negativePrompt}</dd>
          {preview.characters[0]?.negative && (
            <>
              <dt>{slots ? '캐릭터 슬롯 1 네거티브' : '이어 붙는 캐릭터 네거티브'}</dt>
              <dd>{preview.characters[0].negative}</dd>
            </>
          )}
        </dl>
        {!profile && <p className="small muted">그림 연결이 없어서 메인 프롬프트·생성 설정 없이 보여 줍니다.</p>}
      </details>
    </section>
  );
}
