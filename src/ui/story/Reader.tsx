// 읽기 화면: 화면 전체를 덮는 비주얼 노벨. 배경은 장소 그림, 아래에 등장인물과 대사 상자.
// 장면마다 ensureBeat로 본문을 받고(없으면 그 자리에서 쓴다), 다음 장면은 뒤에서 미리 써 둔다.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { clearChapter, setStoryProgress, useAssetUrl, useBeats, useCast, useLocations, STORY_CLEAR_REWARD } from '../../game/store';
import { ensureBeat, finishChapter, prefetchBeat } from '../../gen/story';
import { paintLocation } from '../../game/backgrounds';
import type { Beat, Chapter, Character, Id, Location, Save, Segment, World } from '../../types';
import { Portrait } from '../characters/Portrait';
import { Icon } from '../Icon';
import { navigate, paths } from '../router';
import { autoDelayMs, isFreshStart, loadAutoSpeed, nextAutoSpeed, saveAutoSpeed, setFreshStart, speedLabel, type AutoSpeed } from './runner';

type Phase = 'loading' | 'error' | 'reading' | 'complete';

/** 등장인물은 몇 명까지만 세운다 */
const MAX_CAST = 3;
/** 한 글자 찍는 시간 (자동이면 속도로 나눈다) */
const MS_PER_CHAR = 38;
/** 이미 쓰인 장면이면 로딩 화면을 번쩍 보이지 않게 */
const LOADING_DELAY_MS = 250;

const fmt = (n: number) => n.toLocaleString('ko-KR');
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 이 탭에서 이미 그리기를 부탁한 장소 */
const paintRequested = new Set<Id>();

function displayText(seg: Segment): string {
  return seg.kind === 'thought' ? `(${seg.text})` : seg.text;
}

function speakerOf(seg: Segment, byId: Map<Id, Character>): string | undefined {
  if (seg.kind === 'narration') return undefined;
  return seg.speakerName || (seg.speakerId ? byId.get(seg.speakerId)?.name : undefined) || '???';
}

const EMPTY_SEGMENTS: Segment[] = [{ kind: 'narration', text: '……' }];

function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 로비 타자기와 같지만 속도를 바꿀 수 있다 (자동 넘기기 배속) */
function useTypewriter(text: string, msPerChar: number): { shown: string; typing: boolean; finish: () => void } {
  const chars = Array.from(text); // 한글·이모지가 반쪽으로 잘리지 않게 글자 단위로
  const [n, setN] = useState(() => (reducedMotion() ? chars.length : 0));

  useEffect(() => {
    setN(reducedMotion() ? Array.from(text).length : 0);
  }, [text]);

  useEffect(() => {
    if (n >= chars.length) return;
    const t = window.setTimeout(() => setN((x) => x + 1), msPerChar);
    return () => window.clearTimeout(t);
  }, [n, chars.length, msPerChar]);

  return { shown: chars.slice(0, n).join(''), typing: n < chars.length, finish: () => setN(chars.length) };
}

export function Reader({ chapter, world, save }: { chapter: Chapter; world: World; save: Save }) {
  const total = chapter.nodes.length;
  const cast = useCast(world.id);
  const locations = useLocations(world.id);
  const storedBeats = useBeats(chapter.id);
  const byId = useMemo(() => new Map<Id, Character>((cast ?? []).map((c) => [c.id, c])), [cast]);

  // 시작 위치: "처음부터"면 0, 아니면 저장된 곳
  const [pos, setPos] = useState(() => {
    const p = save.story?.[chapter.id];
    if (isFreshStart(chapter.id) || !p) return { beat: 0, segment: 0 };
    const beat = Math.max(0, Math.min(p.beat, total - 1));
    return { beat, segment: Math.max(0, p.beat === beat ? p.segment : 0) };
  });
  const [phase, setPhase] = useState<Phase>('loading');
  const [beats, setBeats] = useState<Record<number, Beat>>({});
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [showLoading, setShowLoading] = useState(false);
  const [loadStart, setLoadStart] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [titleCard, setTitleCard] = useState<number | undefined>();
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState<AutoSpeed>(() => loadAutoSpeed());
  const [logOpen, setLogOpen] = useState(false);
  /** 장면 끝: "이어보기 / 취소"를 묻는 중 */
  const [sceneEnd, setSceneEnd] = useState(false);
  const [reward, setReward] = useState<boolean | undefined>();

  const rootRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const choiceRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  const node = chapter.nodes[pos.beat];
  const beat = beats[pos.beat];
  const segments = beat ? (beat.segments.length ? beat.segments : EMPTY_SEGMENTS) : undefined;
  const seg = phase === 'reading' && segments ? segments[Math.min(pos.segment, segments.length - 1)] : undefined;
  const text = seg ? displayText(seg) : '';
  const typed = useTypewriter(text, auto ? MS_PER_CHAR / speed : MS_PER_CHAR);
  const speaker = seg ? speakerOf(seg, byId) : undefined;

  // ── 장면 본문 받기 ──
  useEffect(() => {
    if (phase !== 'loading') return;
    let alive = true;
    const i = pos.beat;
    setLoadStart(Date.now());
    setElapsed(0);
    setShowLoading(false);
    const delay = window.setTimeout(() => alive && setShowLoading(true), LOADING_DELAY_MS);
    ensureBeat(chapter.id, i, { priority: 'foreground' })
      .then((b) => {
        if (!alive) return;
        setBeats((m) => ({ ...m, [i]: b }));
        setPhase('reading');
        setTitleCard(i);
        void setStoryProgress(save.id, chapter.id, i, posRef.current.segment);
        if (i + 1 < total) prefetchBeat(chapter.id, i + 1);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        console.error('장면 쓰기 실패', e);
        setError(e instanceof Error ? e.message : String(e));
        setPhase('error');
      });
    return () => {
      alive = false;
      window.clearTimeout(delay);
    };
    // attempt: 다시 시도
  }, [phase, pos.beat, attempt, chapter.id, save.id, total]);

  // 로딩 중 경과 초
  useEffect(() => {
    if (phase !== 'loading') return;
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - loadStart) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [phase, loadStart]);

  // 장면 제목 카드는 잠깐만
  useEffect(() => {
    if (titleCard === undefined) return;
    const t = window.setTimeout(() => setTitleCard(undefined), 2600);
    return () => window.clearTimeout(t);
  }, [titleCard]);

  // ── 배경 ──
  const location: Location | undefined = node ? locations?.find((l) => l.id === node.locationId) : undefined;
  const bgUrl = useAssetUrl(location?.artId);
  useEffect(() => {
    if (!location || location.artId || paintRequested.has(location.id)) return;
    paintRequested.add(location.id);
    paintLocation(location.id, { priority: 'foreground' }).catch((e: unknown) => console.warn('배경 그리기 실패', location.id, e));
  }, [location]);

  // ── 등장인물: 이 장면의 캐스트 몇 명 + 말하는 사람 ──
  const standing = useMemo(() => {
    if (!node) return [];
    const ids = node.castIds.filter((id) => byId.has(id));
    let list = ids.slice(0, MAX_CAST);
    const sid = seg?.speakerId;
    if (sid && byId.has(sid) && !list.includes(sid)) list = [...list.slice(0, MAX_CAST - 1), sid];
    return list.map((id) => byId.get(id)!);
  }, [node, byId, seg?.speakerId]);

  // ── 넘기기 ──
  const complete = useCallback(async () => {
    setPhase('complete');
    setAuto(false);
    setLogOpen(false);
    try {
      const got = await clearChapter(save.id, chapter.id);
      setReward(got);
    } catch (e) {
      console.error('챕터 완료 저장 실패', e);
      setReward(false);
    }
    if (chapter.status !== 'complete') {
      finishChapter(chapter.id).catch((e: unknown) => console.warn('챕터 마무리(요약) 실패', e));
    }
  }, [save.id, chapter.id, chapter.status]);

  const advance = useCallback(() => {
    if (phase !== 'reading' || !segments || sceneEnd) return;
    if (typed.typing) {
      typed.finish();
      return;
    }
    if (pos.segment + 1 < segments.length) {
      setPos({ beat: pos.beat, segment: pos.segment + 1 });
    } else if (pos.beat + 1 < total) {
      // 장면 끝: 바로 넘기지 않고 묻는다. 그동안 다음 장면을 미리 받아 둔다
      setSceneEnd(true);
      prefetchBeat(chapter.id, pos.beat + 1);
    } else {
      void complete();
    }
  }, [phase, segments, sceneEnd, typed, pos, total, complete, chapter.id]);

  const continueScene = useCallback(() => {
    setSceneEnd(false);
    setPos((p) => ({ beat: p.beat + 1, segment: 0 }));
    setPhase('loading');
    rootRef.current?.focus();
  }, []);

  const skipScene = () => {
    if (phase !== 'reading' || !segments || sceneEnd) return;
    if (pos.segment < segments.length - 1) setPos({ beat: pos.beat, segment: segments.length - 1 });
    else typed.finish();
    // 버튼에 포커스가 남으면 다음 Enter가 또 Skip을 누른다: 읽기 화면으로 돌려 둔다
    rootRef.current?.focus();
  };

  const cycleSpeed = () => {
    const v = nextAutoSpeed(speed);
    setSpeed(v);
    saveAutoSpeed(v);
  };

  // 자동 넘기기 (장면 끝의 선택에서는 멈춘다)
  useEffect(() => {
    if (!auto || phase !== 'reading' || logOpen || sceneEnd || typed.typing) return;
    const t = window.setTimeout(advance, autoDelayMs(Array.from(text).length, speed));
    return () => window.clearTimeout(t);
  }, [auto, phase, logOpen, sceneEnd, typed.typing, advance, text, speed]);

  const close = useCallback(() => {
    const p = posRef.current;
    // 장면 끝에서 닫으면 다음 장면부터 이어 읽는다
    if (phase !== 'complete') {
      if (sceneEnd) void setStoryProgress(save.id, chapter.id, p.beat + 1, 0);
      else void setStoryProgress(save.id, chapter.id, p.beat, p.segment);
    }
    setFreshStart(undefined);
    navigate(paths.chapter(chapter.id));
  }, [phase, sceneEnd, save.id, chapter.id]);

  // ── 포커스 ──
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    if (logOpen) {
      const el = logRef.current?.querySelector('.st-log-list');
      el?.scrollTo(0, el.scrollHeight);
      logRef.current?.querySelector<HTMLElement>('.st-log-close')?.focus();
    }
  }, [logOpen]);

  useEffect(() => {
    if (sceneEnd && !logOpen) choiceRef.current?.querySelector<HTMLElement>('.st-choice-go')?.focus();
  }, [sceneEnd, logOpen]);

  const closeLog = () => {
    setLogOpen(false);
    rootRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (logOpen) closeLog();
      else close(); // 장면 끝의 선택에서는 "취소"
      return;
    }
    if (e.key === 'Tab') {
      const scope = logOpen ? logRef.current : sceneEnd ? choiceRef.current : rootRef.current;
      if (!scope) return;
      const focusables = Array.from(scope.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')).filter((el) => el.offsetParent !== null);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const inside = scope.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && !logOpen) {
      const t = e.target as HTMLElement;
      // 장면 끝의 선택은 keydown에서 바로 처리한다 (Space를 뗄 때 엉뚱한 버튼이 눌리지 않게)
      if (sceneEnd && t.closest('.st-choice-cancel')) {
        e.preventDefault();
        if (!e.repeat) close();
        return;
      }
      if (t.closest('button, a') && !(sceneEnd && t.closest('.st-choice-go'))) return; // 버튼은 버튼대로
      e.preventDefault();
      if (e.repeat) return;
      if (sceneEnd) continueScene();
      else advance();
    }
  };

  const onStageClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    advance();
  };

  // ── 지금까지의 기록 (이 챕터) ──
  const log = useMemo(() => {
    const all: { scene: number; title: string; segs: Segment[] }[] = [];
    const stored = new Map((storedBeats ?? []).map((b) => [b.index, b]));
    const upto = phase === 'complete' ? total - 1 : pos.beat;
    for (let i = 0; i <= upto; i++) {
      const b = beats[i] ?? stored.get(i);
      if (!b) continue;
      const lastSeg = i === pos.beat && phase !== 'complete' ? (phase === 'reading' ? pos.segment : -1) : b.segments.length - 1;
      const segs = b.segments.slice(0, lastSeg + 1);
      if (segs.length) all.push({ scene: i, title: chapter.nodes[i]?.title ?? '', segs });
    }
    return all;
  }, [storedBeats, beats, pos, phase, total, chapter.nodes]);

  const liveLine = seg ? (speaker ? `${speaker}: ${text}` : text) : '';
  const sceneLabel = `SCENE ${pos.beat + 1}/${total}`;

  return (
    <div
      ref={rootRef}
      className="st-reader"
      role="dialog"
      aria-modal="true"
      aria-labelledby="st-reader-title"
      tabIndex={-1}
      data-phase={phase}
      onKeyDown={onKeyDown}
    >
      <div className={'st-bg' + (bgUrl ? ' has-art' : '')} aria-hidden="true">
        {bgUrl ? (
          <img key={bgUrl} src={bgUrl} alt="" draggable={false} />
        ) : (
          <div className="st-bg-blank" />
        )}
      </div>

      <header className="st-top">
        <div className="st-top-title">
          <span className="kicker">
            CH.{pad2(chapter.index)} · {phase === 'complete' ? 'END' : sceneLabel}
          </span>
          <h2 id="st-reader-title">{chapter.title}</h2>
        </div>
        <div className="st-controls">
          <button type="button" className="st-ctl" onClick={() => setLogOpen(true)} disabled={phase === 'complete'}>
            로그
          </button>
          <div className="st-ctl-pair">
            <button type="button" className="st-ctl" aria-pressed={auto} onClick={() => setAuto((a) => !a)} disabled={phase === 'complete'}>
              자동
            </button>
            <button
              type="button"
              className="st-ctl st-ctl-speed mono"
              onClick={cycleSpeed}
              disabled={phase === 'complete'}
              aria-label={`자동 속도 ${speed}배`}
              title="자동 넘기기 속도"
            >
              {speedLabel(speed)}
            </button>
          </div>
          <button type="button" className="st-ctl" onClick={skipScene} disabled={phase !== 'reading' || sceneEnd} aria-label="장면 끝으로 건너뛰기">
            Skip
          </button>
          <button type="button" className="st-ctl st-ctl-close" onClick={close} aria-label="닫기">
            <span className="st-ctl-text">닫기</span>
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>

      <div className="st-stage" onClick={onStageClick}>
        {phase === 'reading' && (
          <div className="st-cast" data-count={standing.length} aria-hidden="true">
            {standing.map((c) => {
              const state = !seg || seg.kind === 'narration' ? 'idle' : seg.speakerId === c.id ? 'speaking' : 'dim';
              return (
                <div key={c.id} className="st-figure" data-state={state}>
                  <Portrait assetId={c.portraitId} alt={c.name} className="st-figure-img" silhouetteClass="st-figure-sil" rarity={c.rarity} />
                </div>
              );
            })}
          </div>
        )}

        {(phase === 'reading' || phase === 'loading') && node && (
          <div className="st-place" aria-hidden="true">
            {location && (
              <span className="st-loc">
                <i />
                {location.name}
              </span>
            )}
            {phase === 'reading' && titleCard === pos.beat && (
              <div className="st-title-card">
                <span className="mono">{sceneLabel}</span>
                <strong>{node.title}</strong>
              </div>
            )}
          </div>
        )}

        {phase === 'reading' && seg && (
          <div className={'st-box st-kind-' + seg.kind}>
            {speaker && <span className="st-name">{speaker}</span>}
            <p className="st-text" aria-hidden="true">
              {typed.shown}
              {typed.typing && <span className="type-caret" />}
            </p>
            <span className="st-next" aria-hidden="true">
              {typed.typing ? '' : '▼'}
            </span>
            <span className="st-count mono" aria-hidden="true">
              {pos.segment + 1}/{segments?.length ?? 0}
            </span>
          </div>
        )}

        {phase === 'reading' && sceneEnd && (
          <div className="st-choice-layer" onClick={(e) => e.stopPropagation()}>
            <div ref={choiceRef} className="st-choice" role="alertdialog" aria-modal="true" aria-labelledby="st-choice-title" aria-describedby="st-choice-desc">
              <span className="kicker mono">
                SCENE {pos.beat + 1}/{total} · END
              </span>
              <p id="st-choice-title" className="st-choice-title">
                장면이 끝났습니다
              </p>
              <p id="st-choice-desc" className="small muted">
                다음: {pos.beat + 2}/{total} 장면
              </p>
              <div className="st-choice-actions">
                <button type="button" className="btn btn-ghost st-choice-cancel" onClick={close}>
                  취소
                </button>
                <button type="button" className="btn btn-accent st-choice-go" onClick={continueScene}>
                  이어보기
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === 'loading' && showLoading && (
          <div className="st-card st-loading" role="status">
            <span className="kicker">
              {sceneLabel}
              {node && ` · ${location?.name ?? ''}`}
            </span>
            <p className="st-card-title">
              <span className="st-spinner" aria-hidden="true" />
              이야기를 쓰는 중…
            </p>
            <p className="small muted mono">{elapsed}초</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="st-card st-err" role="alert">
            <span className="kicker">{sceneLabel} · ERROR</span>
            <p className="st-card-title">장면을 쓰지 못했습니다</p>
            <p className="small muted">{error || '알 수 없는 오류'}</p>
            <div className="st-card-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setError(undefined);
                  setAttempt((n) => n + 1);
                  setPhase('loading');
                }}
              >
                다시 시도
              </button>
              <button type="button" className="btn btn-ghost" onClick={close}>
                닫기
              </button>
            </div>
          </div>
        )}

        {phase === 'complete' && (
          <div className="st-card st-done" role="status">
            <span className="kicker">CHAPTER {pad2(chapter.index)} · COMPLETE</span>
            <p className="st-card-title st-done-title">챕터 완료</p>
            <p className="st-done-name">{chapter.title}</p>
            {reward && (
              <p className="st-reward">
                <i aria-hidden="true" />+{fmt(STORY_CLEAR_REWARD)} {world.currency.pull}
              </p>
            )}
            {reward === false && <p className="small muted">이 챕터의 보상은 이미 받았습니다.</p>}
            <div className="st-card-actions">
              <button type="button" className="btn btn-primary" onClick={close} autoFocus>
                돌아가기
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {liveLine}
      </p>

      {logOpen && (
        <div className="st-log-layer" onClick={closeLog}>
          <div ref={logRef} className="st-log" role="dialog" aria-modal="true" aria-labelledby="st-log-title" onClick={(e) => e.stopPropagation()}>
            <header className="st-log-head">
              <div>
                <span className="kicker">BACKLOG</span>
                <h3 id="st-log-title">지금까지의 이야기</h3>
              </div>
              <button
                type="button"
                className="icon-btn st-log-close"
                aria-label="로그 닫기"
                onClick={closeLog}
              >
                <Icon name="close" size={18} />
              </button>
            </header>
            <div className="st-log-list">
              {log.length === 0 && <p className="small muted">아직 읽은 줄이 없습니다.</p>}
              {log.map((g) => (
                <section key={g.scene}>
                  <h4 className="mono">
                    SCENE {g.scene + 1}/{total} · {g.title}
                  </h4>
                  {g.segs.map((s, k) => {
                    const who = speakerOf(s, byId);
                    return (
                      <p key={k} className={'st-log-line st-kind-' + s.kind}>
                        {who && <b>{who}</b>}
                        <span>{displayText(s)}</span>
                      </p>
                    );
                  })}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
