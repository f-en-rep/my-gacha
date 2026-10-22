// 뽑기 연출과 결과. 화면 전체를 덮는 오버레이.
// 순서: 뒤집힌 카드 + 최고 희귀도 색 번쩍 → 한 장씩 뒤집기 → 결과. 누르면 바로 전부 공개.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PullOutcome } from '../../core/gacha';
import type { Character, Id, Rarity } from '../../types';
import { Icon } from '../Icon';
import { navigate, paths } from '../router';
import { Portrait, Stars } from './art';
import { resonanceLabel } from '../terms';

type Phase = 'build' | 'flip' | 'done';

const BUILD_MS = 950;
const FLIP_MS = 210;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const RARITY_WORD: Record<Rarity, string> = { 6: '6성', 5: '5성', 4: '4성', 3: '3성' };

function summary(outcomes: PullOutcome[], names: Map<Id, string>): string {
  const counts = [6, 5, 4, 3]
    .map((r) => [r, outcomes.filter((o) => o.rarity === r).length] as const)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${RARITY_WORD[r as Rarity]} ${n}`)
    .join(', ');
  const top = outcomes
    .filter((o) => o.rarity >= 5)
    .map((o) => `${names.get(o.character.id) ?? o.character.name}(${o.rarity}성${o.isNew ? ', 새 캐릭터' : ''})`);
  const fresh = outcomes.filter((o) => o.isNew).length;
  return `${outcomes.length}회 결과: ${counts}.${top.length ? ' ' + top.join(', ') + '.' : ''}${fresh ? ` 새 캐릭터 ${fresh}명.` : ''}`;
}

export function Reveal({
  outcomes,
  cast,
  title,
  shopName,
  onClose,
}: {
  outcomes: PullOutcome[];
  /** 최신 캐스트 (초상화가 그려지면 카드가 바로 바뀌게) */
  cast: Character[] | undefined;
  title: string;
  shopName: string;
  onClose: () => void;
}) {
  const reduced = useMemo(prefersReducedMotion, []);
  const [phase, setPhase] = useState<Phase>(reduced ? 'done' : 'build');
  const [shown, setShown] = useState(reduced ? outcomes.length : 0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => new Map<Id, Character>((cast ?? []).map((c) => [c.id, c])), [cast]);
  const names = useMemo(() => new Map<Id, string>(outcomes.map((o) => [o.character.id, byId.get(o.character.id)?.name ?? o.character.name])), [outcomes, byId]);
  const top = outcomes.reduce<Rarity>((m, o) => (o.rarity > m ? o.rarity : m), 3);

  const skip = useCallback(() => {
    setShown(outcomes.length);
    setPhase('done');
  }, [outcomes.length]);

  // 연출 타이머
  useEffect(() => {
    if (phase === 'build') {
      const t = setTimeout(() => setPhase('flip'), BUILD_MS + (top === 6 ? 350 : 0));
      return () => clearTimeout(t);
    }
    if (phase === 'flip') {
      if (shown >= outcomes.length) {
        const t = setTimeout(() => setPhase('done'), 250);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 60 : FLIP_MS);
      return () => clearTimeout(t);
    }
  }, [phase, shown, outcomes.length, top]);

  // 열릴 때 닫기 버튼에 포커스, 닫힐 때 원래 자리로
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"])'));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const done = phase === 'done';
  const single = outcomes.length === 1;

  return (
    <div
      ref={dialogRef}
      className="pl-reveal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pl-reveal-title"
      data-phase={phase}
      data-top={top}
      onKeyDown={onKeyDown}
    >
      <span className="pl-flare" aria-hidden="true" />
      <header className="pl-reveal-head">
        <div className="pl-reveal-title">
          <span className="kicker">HEADHUNT · RESULT</span>
          <h2 id="pl-reveal-title">{title}</h2>
        </div>
        {!done && (
          <button type="button" className="btn btn-ghost pl-skip" onClick={skip}>
            건너뛰기
          </button>
        )}
        <button ref={closeRef} type="button" className="icon-btn pl-reveal-close" aria-label="결과 닫기" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </header>

      <div className="pl-reveal-stage" onClick={done ? undefined : skip}>
        <ol className="pl-results" data-count={single ? 1 : 10} aria-label="뽑기 결과">
          {outcomes.map((o, i) => {
            const c = byId.get(o.character.id) ?? o.character;
            const flipped = i < shown;
            const tag = o.isNew ? (
              <span className="pl-new">NEW</span>
            ) : o.shopGained > 0 ? (
              <span className="pl-tag">
                +{o.shopGained} {shopName}
              </span>
            ) : (
              <span className="pl-tag">{resonanceLabel(o.potential)}</span>
            );
            return (
              <li key={i} style={{ ['--i' as string]: i }}>
                <button
                  type="button"
                  className="pl-rcard"
                  data-rarity={o.rarity}
                  data-flipped={flipped || undefined}
                  tabIndex={done ? 0 : -1}
                  aria-hidden={!flipped || undefined}
                  aria-label={flipped ? `${c.name}, ${o.rarity}성${o.isNew ? ', 새 캐릭터' : ''}. 상세 보기` : undefined}
                  onClick={(e) => {
                    if (!done) return; // 무대 클릭(건너뛰기)으로 넘긴다
                    e.stopPropagation();
                    navigate(paths.character(c.id));
                  }}
                >
                  <span className="pl-rcard-inner">
                    <span className="pl-rcard-back">
                      <span className="pl-rcard-mark mono">HH</span>
                    </span>
                    <span className="pl-rcard-front">
                      <Portrait character={c} className="pl-rcard-portrait" />
                      <span className="pl-rcard-info">
                        <Stars rarity={o.rarity} />
                        <span className="pl-rcard-name">{c.name}</span>
                        {tag}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <footer className="pl-reveal-foot">
        <p className="small muted">{done ? '카드를 누르면 캐릭터 상세로 이동합니다.' : '화면을 누르면 바로 모두 공개합니다.'}</p>
        {done && (
          <button type="button" className="btn btn-primary pl-reveal-ok" onClick={onClose}>
            확인
          </button>
        )}
      </footer>
      <p className="sr-only" aria-live="polite">
        {done ? summary(outcomes, names) : ''}
      </p>
    </div>
  );
}
