// 캐릭터 패널 오른쪽 페이지: 고른 캐릭터의 프로필
import { useState } from 'react';
import { isPainting, paintPortrait, usePaintAvailable } from '../../game/portraits';
import { putSave } from '../../game/store';
import { paths } from '../router';
import type { Character, CombatStats, Save } from '../../types';
import { Portrait, Stars } from './Portrait';
import { PromptSlot } from './PromptSlot';

const STAT_LABELS: { key: keyof CombatStats; label: string }[] = [
  { key: 'hp', label: '체력' },
  { key: 'atk', label: '공격' },
  { key: 'def', label: '방어' },
  { key: 'spd', label: '속도' },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function CharacterDetail({ character: c, save, no }: { character: Character; save?: Save; no: number }) {
  const owned = save?.owned[c.id];
  const canPaint = usePaintAvailable();
  // 그리는 중·오류는 캐릭터별로 기억한다 (다른 캐릭터를 보고 와도 그대로)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const busy = busyIds.has(c.id) || isPainting(c.id);
  const error = errors[c.id];
  const featured = save?.featuredCharacterId === c.id;

  async function paint(force: boolean) {
    if (force && !window.confirm(`${c.name}의 초상화를 다시 그릴까요? 지금 그림은 지워집니다.`)) return;
    const id = c.id;
    const setError = (msg?: string) => setErrors((m) => ({ ...m, [id]: msg }));
    setBusyIds((s) => new Set(s).add(id));
    setError(undefined);
    try {
      const r = await paintPortrait(id, { priority: 'foreground', force });
      if (r === undefined) setError('그림 연결이 지정되어 있지 않습니다. 설정 → 작업별 연결에서 그림 연결을 고르세요.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function feature() {
    if (!save || !owned) return;
    await putSave({ ...save, featuredCharacterId: c.id });
  }

  const tags = [c.tags.position, ...c.tags.role, c.tags.element, ...c.tags.trait].filter(Boolean);

  return (
    <article className="cd" aria-labelledby="cd-name">
      <span className="kicker">OPERATOR FILE · No.{String(no).padStart(3, '0')}</span>

      <div className="cd-art" data-owned={owned ? 'true' : 'false'} aria-busy={busy || undefined}>
        <Portrait assetId={c.portraitId} alt={`${c.name} 초상화`} className="cd-img" silhouetteClass="silhouette" rarity={c.rarity} locked={!owned && !c.portraitId} />
        {busy && (
          <span className="cd-busy" role="status">
            <span className="pill pill-run">그리는 중</span>
            <small>그림 요청은 하나씩, 간격을 두고 보냅니다.</small>
          </span>
        )}
        {!owned && <span className="cd-locked">미보유</span>}
      </div>

      <div className="cd-edit">
        <a className="btn btn-small btn-ghost" href={'#' + paths.editCharacter(c.id)}>
          편집
        </a>
      </div>

      {owned && canPaint && (
        <div className="cd-paint">
          {c.portraitId ? (
            <button type="button" className="btn btn-small btn-ghost" disabled={busy} onClick={() => void paint(true)}>
              다시 그리기
            </button>
          ) : (
            <button type="button" className="btn btn-small btn-accent" disabled={busy} onClick={() => void paint(false)}>
              그리기
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="cd-error" role="alert">
          {error}
        </p>
      )}

      <header className="cd-head">
        <h2 id="cd-name">{c.name}</h2>
        <Stars rarity={c.rarity} />
      </header>
      {c.origin?.kind === 'card' && (
        <p className="cd-origin">
          카드에서 가져옴 · {c.origin.fileName}
          {c.origin.creator && ` · 만든 이 ${c.origin.creator}`}
        </p>
      )}

      {tags.length > 0 && (
        <ul className="cd-tags" aria-label="태그">
          {tags.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}

      <dl className="cd-facts">
        <div>
          <dt>한계 돌파</dt>
          <dd>{owned ? `${owned.potential - 1} / 5` : '—'}</dd>
        </div>
        <div>
          <dt>획득</dt>
          <dd>{owned ? formatDate(owned.obtainedAt) : '아직 만나지 못함'}</dd>
        </div>
      </dl>

      {owned && (
        <div className="cd-actions ch-cd-actions">
          {featured ? (
            <p className="cd-featured">
              <span className="brand-mark" aria-hidden="true" />
              로비에 서 있는 캐릭터입니다
            </p>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void feature()}>
              로비에 세우기
            </button>
          )}
          <a className="btn btn-ghost" href={'#' + paths.chat(c.id)}>
            대화하기
          </a>
        </div>
      )}

      {c.quotes.length > 0 && (
        <section className="cd-sec">
          <h3>대사</h3>
          <ul className="cd-quotes">
            {c.quotes.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
      {c.appearance && (
        <section className="cd-sec">
          <h3>외형</h3>
          <p>{c.appearance}</p>
        </section>
      )}
      {c.personality && (
        <section className="cd-sec">
          <h3>성격</h3>
          <p>{c.personality}</p>
        </section>
      )}
      {c.background && (
        <section className="cd-sec">
          <h3>배경</h3>
          <p>{c.background}</p>
        </section>
      )}
      {c.stats && (
        <section className="cd-sec">
          <h3>능력치</h3>
          <table className="cd-stats">
            <tbody>
              <tr>
                {STAT_LABELS.map((s) => (
                  <th key={s.key} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
              <tr>
                {STAT_LABELS.map((s) => (
                  <td key={s.key}>{c.stats![s.key]}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>
      )}
      <PromptSlot character={c} />
    </article>
  );
}
