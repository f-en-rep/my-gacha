// 대화 패널 오른쪽 페이지: 고른 캐릭터와의 대화방 (머리말, 대화 흐름, 입력창)
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref, type RefObject } from 'react';
import { db } from '../../db';
import { now } from '../../core/id';
import { BOND_REWARDS, bondLevel, bondTitle, claimableLevels } from '../../core/bond';
import { claimBondReward } from '../../game/bonds';
import { useChatLines } from '../../game/store';
import { paths } from '../router';
import { Portrait } from '../characters/Portrait';
import type { Character, ChatLine, Save, World } from '../../types';
import { chatErrorText, clearChatError, startRegenerate, startRetry, startSend, useChatRun } from './runner';

const fmt = (n: number) => n.toLocaleString('ko-KR');
const DESKTOP = '(min-width: 1000px)';

export function ChatRoom({ character: c, save, world, hasText }: { character: Character; save: Save; world: World; hasText: boolean }) {
  const lines = useChatLines(save.id, c.id);
  const run = useChatRun(save.id, c.id);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const roomRef = useKeyboardInset();

  // 넓은 화면에서는 캐릭터를 고르면 바로 입력창으로
  useEffect(() => {
    if (hasText && window.matchMedia(DESKTOP).matches) inputRef.current?.focus({ preventScroll: true });
  }, [c.id, hasText]);

  const last = lines?.[lines.length - 1];
  const unanswered = !!last && last.role === 'user' && !run.replying;

  return (
    <div className="ch-room" ref={roomRef}>
      <RoomHead character={c} save={save} world={world} />
      <Thread character={c} lines={lines} replying={run.replying}>
        {unanswered && hasText && (
          <div className="ch-error" role="alert">
            <p>{run.error ?? '아직 답을 받지 못한 말이 있어요.'}</p>
            <button type="button" className="btn btn-small btn-primary" onClick={() => void startRetry(save.id, c.id)}>
              다시 시도
            </button>
          </div>
        )}
        {!unanswered && run.error && (
          <div className="ch-error" role="alert">
            <p>{run.error}</p>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => clearChatError(save.id, c.id)}>
              닫기
            </button>
          </div>
        )}
        {last?.role === 'char' && !run.replying && hasText && (
          <div className="ch-line-actions">
            <button type="button" className="ch-link-btn" onClick={() => void startRegenerate(save.id, c.id)} aria-label={`${c.name}의 마지막 답 다시 쓰기`}>
              ↻ 다시 쓰기
            </button>
          </div>
        )}
      </Thread>
      {hasText ? (
        <Composer ref={inputRef} name={c.name} disabled={run.replying} onSend={(t) => void startSend(save.id, c.id, t)} />
      ) : (
        <div className="ch-noconn" role="note">
          <p>
            <strong>글 연결이 필요합니다.</strong> 대화하려면 설정에서 글 연결을 지정해 주세요. 지난 대화는 그대로 읽을 수 있어요.
          </p>
          <a className="btn btn-small btn-primary" href={'#' + paths.settings}>
            설정 열기
          </a>
        </div>
      )}
    </div>
  );
}

/** 폰 화면 키보드가 패널 아래를 가리는 만큼 --ch-kb로 알려 준다 (입력창을 키보드 위로) */
function useKeyboardInset() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      ref.current?.style.setProperty('--ch-kb', covered > 60 ? covered + 'px' : '0px');
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return ref;
}

/* ── 머리말: 초상화, 이름, 호감도, 보상, 내 이름 ─────── */

function RoomHead({ character: c, save, world }: { character: Character; save: Save; world: World }) {
  const bond = save.bonds?.[c.id];
  const points = bond?.points ?? 0;
  const info = bondLevel(points);
  const max = info.ceil <= info.floor;
  const pct = max ? 100 : Math.round(((points - info.floor) / (info.ceil - info.floor)) * 100);
  const claimable = claimableLevels(bond);
  const sum = claimable.reduce((a, l) => a + (BOND_REWARDS[l] ?? 0), 0);
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string }>();
  const [nameOpen, setNameOpen] = useState(false);

  const claim = async () => {
    setClaiming(true);
    setNotice(undefined);
    try {
      const got = await claimBondReward(save.id, c.id);
      setNotice(
        got > 0
          ? { ok: true, text: `${claimable.join('·')}단계 보상으로 ${world.currency.pull} +${fmt(got)}을 받았어요.` }
          : { ok: false, text: '받을 보상이 없어요. 이미 받았을 수 있어요.' },
      );
    } catch (e) {
      setNotice({ ok: false, text: '보상을 받지 못했어요. ' + chatErrorText(e) });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <header className="ch-head">
      <div className="ch-head-main">
        <span className={'ch-head-art r' + c.rarity}>
          <Portrait assetId={c.portraitId} alt="" rarity={c.rarity} className="ch-avatar-img" silhouetteClass="ch-silhouette" />
        </span>
        <div className="ch-head-text">
          <span className="kicker">BOND · LV.{String(info.level).padStart(2, '0')}</span>
          <h2>
            <a href={'#' + paths.character(c.id)}>{c.name}</a>
          </h2>
          <p className="ch-head-title">{bondTitle(info.level)}</p>
        </div>
        <button
          type="button"
          className="icon-btn ch-name-btn"
          aria-label="내 이름 설정"
          aria-expanded={nameOpen}
          aria-pressed={nameOpen}
          onClick={() => setNameOpen((v) => !v)}
        >
          <span aria-hidden="true">名</span>
        </button>
      </div>
      <div className="ch-gauge-row">
        <div
          className="ch-gauge"
          role="meter"
          aria-label="호감도"
          aria-valuemin={info.floor}
          aria-valuemax={max ? info.floor : info.ceil}
          aria-valuenow={points}
          aria-valuetext={max ? `최고 단계, ${points}점` : `${points}점, 다음 단계까지 ${info.toNext}점`}
        >
          <span style={{ width: pct + '%' }} />
        </div>
        <span className="ch-gauge-num mono">{max ? `MAX · ${points}` : `${points - info.floor}/${info.ceil - info.floor}`}</span>
        {claimable.length > 0 && (
          <button type="button" className="btn btn-small btn-accent ch-claim" disabled={claiming} onClick={() => void claim()}>
            보상 받기 <b className="mono">+{fmt(sum)}</b>
          </button>
        )}
      </div>
      {notice && (
        <p className={'ch-notice' + (notice.ok ? '' : ' is-fail')} role="status">
          {notice.text}
        </p>
      )}
      {nameOpen && <NameRow save={save} onDone={() => setNameOpen(false)} />}
    </header>
  );
}

function NameRow({ save, onDone }: { save: Save; onDone: () => void }) {
  const [value, setValue] = useState(save.playerName ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      // 대화 중 호감도가 바뀌었을 수 있으니 저장된 세이브를 다시 읽고 이름만 고친다
      await db.transaction('rw', db.saves, async () => {
        const s = await db.saves.get(save.id);
        if (!s) return;
        const name = value.trim().slice(0, 24);
        await db.saves.put({ ...s, playerName: name || undefined, updatedAt: now() });
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="ch-name-row"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="ch-player-name">내 이름</label>
      <input
        id="ch-player-name"
        value={value}
        maxLength={24}
        placeholder="당신"
        autoComplete="off"
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      <button type="submit" className="btn btn-small btn-primary" disabled={busy}>
        저장
      </button>
      <small className="muted">캐릭터가 나를 부르는 이름이에요. 비우면 「당신」.</small>
    </form>
  );
}

/* ── 대화 흐름 ───────────────────────────────────── */

function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = new Date();
  const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  if (dayKey(iso) === dayKey(t.toISOString())) return '오늘';
  if (dayKey(iso) === dayKey(y.toISOString())) return '어제';
  return d.toLocaleDateString('ko-KR', { year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

/** 괄호 속 행동 묘사는 흐리게 기울여서 */
function renderCharText(text: string): ReactNode[] {
  const parts = text.split(/(\([^()\n]*\)|（[^（）\n]*）|\*[^*\n]+\*)/g);
  return parts.map((p, i) => {
    if (!p) return null;
    if (i % 2 === 1) {
      const inner = p.startsWith('*') ? p.slice(1, -1) : p;
      return (
        <span key={i} className="ch-act">
          {inner}
        </span>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

function Thread({
  character: c,
  lines,
  replying,
  children,
}: {
  character: Character;
  lines: ChatLine[] | undefined;
  replying: boolean;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const lastCharId = useRef<number | undefined | null>(null);

  const last = lines?.[lines.length - 1];
  const sig = `${lines?.length ?? -1}:${last?.id ?? ''}:${replying ? 1 : 0}:${children ? 1 : 0}`;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !lines) return;
    // 방금 내가 보낸 줄이면 무조건 아래로, 아니면 아래에 있을 때만 따라간다
    if (atBottom.current || last?.role === 'user') {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
      setUnseen(false);
    } else {
      setUnseen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // 새 캐릭터 답은 화면 읽기 프로그램에 알린다 (처음 불러온 기록은 빼고)
  useEffect(() => {
    if (!lines) return;
    const lc = [...lines].reverse().find((l) => l.role === 'char');
    if (lastCharId.current === null) {
      lastCharId.current = lc?.id;
      return;
    }
    if (lc && lc.id !== lastCharId.current) {
      lastCharId.current = lc.id;
      setAnnounce(`${c.name}: ${lc.text}`);
    }
  }, [lines, c.name]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current) setUnseen(false);
  };

  const toBottom = () => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUnseen(false);
  };

  const items: ReactNode[] = [];
  let prevDay = '';
  (lines ?? []).forEach((l, i) => {
    const day = dayKey(l.at);
    if (day !== prevDay) {
      prevDay = day;
      items.push(
        <li key={'d' + day + i} className="ch-day" role="separator">
          <span>{dayLabel(l.at)}</span>
        </li>,
      );
    }
    const prev = lines![i - 1];
    const next = lines![i + 1];
    const first = !prev || prev.role !== l.role || dayKey(prev.at) !== day;
    const lastOfGroup = !next || next.role !== l.role || dayKey(next.at) !== day;
    items.push(
      <li key={l.id ?? i} className={`ch-msg ch-${l.role}${first ? ' is-first' : ''}${lastOfGroup ? ' is-last' : ''}`}>
        {l.role === 'char' && (
          <span className={'ch-msg-avatar r' + c.rarity} aria-hidden="true">
            {first && <Portrait assetId={c.portraitId} alt="" rarity={c.rarity} className="ch-avatar-img" silhouetteClass="ch-silhouette" />}
          </span>
        )}
        <div className="ch-msg-body">
          {l.role === 'char' && first && <span className="ch-msg-name">{c.name}</span>}
          <div className="ch-bubble-row">
            <p className="ch-bubble">
              <span className="sr-only">{l.role === 'char' ? c.name : '나'}: </span>
              {l.role === 'char' ? renderCharText(l.text) : l.text}
            </p>
            {lastOfGroup && <time className="ch-time mono" dateTime={l.at}>{timeLabel(l.at)}</time>}
          </div>
        </div>
      </li>,
    );
  });

  return (
    <div className="ch-thread-wrap">
      <div className="ch-thread" ref={ref} onScroll={onScroll}>
        {lines && lines.length === 0 && !replying && (
          <div className="ch-intro">
            <span className="kicker">FIRST CONTACT</span>
            <p>
              {c.name}에게 첫 마디를 건네 보세요.
              <br />
              <span className="muted small">대화할수록 호감도가 쌓이고, 단계마다 보상을 받아요.</span>
            </p>
          </div>
        )}
        <ol className="ch-msgs" aria-label={`${c.name}와의 대화`}>
          {items}
          {replying && (
            <li className="ch-msg ch-char is-first is-last ch-typing-row">
              <span className={'ch-msg-avatar r' + c.rarity} aria-hidden="true">
                <Portrait assetId={c.portraitId} alt="" rarity={c.rarity} className="ch-avatar-img" silhouetteClass="ch-silhouette" />
              </span>
              <div className="ch-msg-body">
                <p className="ch-bubble ch-typing" role="status" aria-label={`${c.name}이(가) 답을 쓰는 중`}>
                  <i />
                  <i />
                  <i />
                </p>
              </div>
            </li>
          )}
        </ol>
        {children}
      </div>
      {unseen && (
        <button type="button" className="ch-new-btn" onClick={toBottom}>
          새 메시지 ↓
        </button>
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
    </div>
  );
}

/* ── 입력창 ──────────────────────────────────────── */

const MAX_LINES = 5;

function Composer({ ref, name, disabled, onSend }: { ref: Ref<HTMLTextAreaElement>; name: string; disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const local = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = (el: HTMLTextAreaElement | null) => {
    local.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as RefObject<HTMLTextAreaElement | null>).current = el;
  };

  // 줄 수만큼 자라고, 다섯 줄을 넘으면 안에서 스크롤
  useLayoutEffect(() => {
    const el = local.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || 22;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = lh * MAX_LINES + pad;
    el.style.height = Math.min(el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth), max) + 'px';
    el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
  }, [text]);

  const canSend = !disabled && text.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // 한글 입력 조합 중의 Enter는 글자 확정용이다
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    send();
  };

  return (
    <form
      className="ch-composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label htmlFor="ch-input" className="sr-only">
        {name}에게 보낼 말
      </label>
      <textarea
        id="ch-input"
        ref={setRefs}
        rows={1}
        value={text}
        placeholder={disabled ? `${name}이(가) 답을 쓰는 중…` : `${name}에게 말 걸기`}
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="ch-send" disabled={!canSend} aria-label="보내기">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" aria-hidden="true">
          <path d="M4 12h15M13 6l6 6-6 6" />
        </svg>
      </button>
    </form>
  );
}

