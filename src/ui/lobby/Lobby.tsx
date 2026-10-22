import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';
import { useSetupSteps } from '../setup';
import { paths } from '../router';
import { db } from '../../db';
import { DAILY_PULL_CURRENCY, rulesFor, today, useActiveGame, useCast, useWorlds } from '../../game/store';
import { now } from '../../core/id';
import { Portrait } from '../characters/Portrait';
import { CARD_BACK_COMMON } from '../cards';
import type { Character, Id, Save } from '../../types';
import { useTypewriter } from './typewriter';
import { useUnreadNotices } from '../../game/notices';
import './lobby-extra.css';
import '../notices/notices.css';

/** 매일 보상 받기. 같은 날 두 번 받지 않게 저장된 세이브를 다시 읽고 고친다 */
async function claimDaily(saveId: Id): Promise<void> {
  await db.transaction('rw', db.saves, async () => {
    const s = await db.saves.get(saveId);
    const day = today();
    if (!s || s.lastDailyClaim === day) return;
    await db.saves.put({
      ...s,
      wallet: { ...s.wallet, pull: s.wallet.pull + DAILY_PULL_CURRENCY },
      lastDailyClaim: day,
      updatedAt: now(),
    });
  });
}

/** 로비에 세울 캐릭터: 지정한 캐릭터 → 보유 중 가장 높은 희귀도 → 없음 */
function pickFeatured(cast: Character[] | undefined, save: Save | undefined): Character | undefined {
  if (!cast || !save) return undefined;
  const chosen = save.featuredCharacterId ? cast.find((c) => c.id === save.featuredCharacterId && save.owned[c.id]) : undefined;
  // cast는 희귀도 높은 순으로 정렬되어 있다
  return chosen ?? cast.find((c) => save.owned[c.id]);
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export function Lobby({ panelOpen }: { panelOpen: boolean }) {
  const steps = useSetupSteps();
  const required = steps.filter((s) => !s.optional);
  const next = required.find((s) => !s.done);
  const done = required.filter((s) => s.done).length;

  const { world, save } = useActiveGame();
  const ready = world?.status === 'ready' ? world : undefined;
  const cast = useCast(ready?.id);
  const worlds = useWorlds();
  const generating = world?.status === 'generating' ? world : worlds?.find((w) => w.status === 'generating');
  const featured = pickFeatured(cast, save);
  const unread = useUnreadNotices();

  const [quote, setQuote] = useState<{ id?: Id; i: number }>({ i: 0 });
  const quotes = featured?.quotes.filter((q) => q.trim()) ?? [];
  const quoteIndex = quote.id === featured?.id ? quote.i % Math.max(1, quotes.length) : 0;
  const speaking = !next && !!ready && !!featured;
  const line = speaking ? (quotes.length ? quotes[quoteIndex]! : '……') : '';
  // 패널이 열려 있는 동안은 찍지 않다가, 로비로 돌아오면 그때 찍는다
  const typed = useTypewriter(panelOpen ? '' : line);
  // 찍는 중이면 먼저 끝까지 보여 주고, 다 보였으면 다음 대사
  const nextQuote = () => (typed.typing ? typed.finish() : setQuote({ id: featured?.id, i: quoteIndex + 1 }));

  const [claiming, setClaiming] = useState(false);
  const canClaim = !!ready && !!save && save.lastDailyClaim !== today();
  const claim = async () => {
    if (!save) return;
    setClaiming(true);
    try {
      await claimDaily(save.id);
    } finally {
      setClaiming(false);
    }
  };

  const rules = rulesFor(ready);
  const pity = save?.pity[rules.standardPityKey]?.sinceSix ?? 0;
  const wallet = ready ? save?.wallet : undefined;

  let dialogName: string;
  let dialogBody: ReactNode;
  let dialogTalk: ReactNode = null;
  if (next) {
    dialogName = '안내';
    dialogBody = (
      <p>
        시작 전에 ({done}/{required.length}) — {next.label}부터 해 주세요. <a href={'#' + next.href}>바로 가기</a>
      </p>
    );
  } else if (!ready) {
    dialogName = '안내';
    dialogBody = generating ? (
      <p>
        「{generating.name}」 월드를 만드는 중입니다
        {generating.genProgress ? ` — ${generating.genProgress.stage} (${generating.genProgress.done}/${generating.genProgress.total})` : ''}.{' '}
        <a href={'#' + paths.world}>진행 보기</a>
      </p>
    ) : (
      <p>
        월드 패널에서 첫 월드를 만들어 보세요. <a href={'#' + paths.world}>월드 패널 열기</a>
      </p>
    );
  } else if (!featured) {
    dialogName = '안내';
    dialogBody = (
      <p>
        「{ready.name}」에 오신 것을 환영합니다. 뽑기에서 첫 동료를 만나 보세요. <a href={'#' + paths.pull}>뽑기로 가기</a>
      </p>
    );
  } else {
    dialogName = featured.name;
    dialogBody = (
      <p className="dialog-quote" aria-label={line}>
        {/* 다 찍힌 대사를 안 보이게 깔아 자리를 먼저 잡는다: 찍는 동안 상자 높이가 변하지 않게 */}
        <span className="quote-ghost" aria-hidden="true">
          「{line}」
        </span>
        <span className="quote-typed" aria-hidden="true">
          「{typed.shown}
          {typed.typing ? <span className="type-caret" /> : '」'}
        </span>
      </p>
    );
    dialogTalk = (
      <a className="ch-lobby-talk" href={'#' + paths.chat(featured.id)} onClick={(e) => e.stopPropagation()}>
        대화하기
      </a>
    );
  }

  const pityPct = Math.min(100, (pity / rules.pityThreshold) * 100);

  return (
    <div className="lobby" aria-hidden={panelOpen || undefined}>
      <Sky />

      <header className="lobby-hud">
        <a className="hud-world" href={'#' + paths.world}>
          <span className="hud-star" aria-hidden="true">
            <Icon name="star" size={18} />
          </span>
          <span className="hud-world-text">
            <span className="kicker">WORLD</span>
            <strong>
              <span className="hud-world-name">{ready?.name ?? '월드 없음'}</span>
              {ready && save?.freeMode && <span className="hud-free">자유 모드</span>}
            </strong>
          </span>
        </a>
        <div className="hud-currency">
          <span className="currency currency-pull">
            <i aria-hidden="true" />
            {ready?.currency.pull || '뽑기 재화'} <b>{wallet ? fmt(wallet.pull) : '—'}</b>
          </span>
          <a className="currency ch-shop-chip" href={'#' + paths.shop} aria-label={`${ready?.currency.shop || '상점 재화'} ${wallet ? fmt(wallet.shop) : '—'}, 상점 열기`}>
            <i aria-hidden="true" />
            {ready?.currency.shop || '상점 재화'} <b>{wallet ? fmt(wallet.shop) : '—'}</b>
          </a>
          {canClaim && (
            <button type="button" className="hud-daily" disabled={claiming} onClick={() => void claim()}>
              오늘의 보상 <b>+{fmt(DAILY_PULL_CURRENCY)}</b>
            </button>
          )}
        </div>
        {/* 폰: 아래 독은 다섯 칸이라 기록은 여기 (넓은 화면은 오른쪽 메뉴에) */}
        <a className="icon-btn hud-icon hud-archive" href={'#' + paths.archive} aria-label="기록">
          <Icon name="notebook" size={20} />
        </a>
        <a className="icon-btn hud-icon hud-bell" href={'#' + paths.notices} aria-label={unread ? `알림, 안 읽은 것 ${unread}개` : '알림'}>
          <Icon name="bell" size={20} />
          {unread > 0 && (
            <span className="hud-badge" aria-hidden="true">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </a>
        <a className="icon-btn hud-settings" href={'#' + paths.settings} aria-label="설정">
          <Icon name="gear" size={20} />
        </a>
      </header>

      <div className="lobby-stage">
        <Orbits />
        <figure className="stage-arch">
          <div className="arch-window">
            {featured ? (
              <Portrait assetId={featured.portraitId} alt={featured.name} className="stage-portrait" silhouetteClass="lobby-figure" rarity={featured.rarity} />
            ) : (
              <img className="stage-portrait" src={CARD_BACK_COMMON} alt="" draggable={false} />
            )}
          </div>
          <figcaption className="stage-plate">
            {featured && (
              <span className="plate-stars" aria-label={`${featured.rarity}성`}>
                {'★'.repeat(featured.rarity)}
              </span>
            )}
            <strong>{featured ? featured.name : '대표 캐릭터 자리'}</strong>
          </figcaption>
        </figure>
      </div>

      <div
        className={'lobby-dialog' + (speaking && (quotes.length > 1 || typed.typing) ? ' is-cycling' : '')}
        role="status"
        onClick={speaking && (quotes.length > 1 || typed.typing) ? nextQuote : undefined}
      >
        <span className="dialog-name">{dialogName}</span>
        {dialogBody}
        {dialogTalk}
        {speaking && (quotes.length > 1 || typed.typing) ? (
          <button
            type="button"
            className="dialog-cursor dialog-next"
            aria-label={typed.typing ? '대사 바로 보기' : '다음 대사'}
            onClick={(e) => {
              e.stopPropagation();
              nextQuote();
            }}
          >
            <Icon name="star" size={12} />
          </button>
        ) : (
          <span className="dialog-cursor" aria-hidden="true">
            <Icon name="star" size={12} />
          </span>
        )}
      </div>

      <nav className="lobby-menu" aria-label="주 메뉴">
        <a className="menu-pull" href={'#' + paths.pull}>
          <span className="menu-pull-icon" aria-hidden="true">
            <Icon name="star" size={26} />
          </span>
          <span className="menu-pull-text">
            <span className="kicker">HEADHUNT</span>
            <strong>뽑기</strong>
          </span>
          <span className="menu-pity">
            <span className="mono">
              PITY {pity}/{rules.pityThreshold}
            </span>
            <span className="pity-track" aria-hidden="true">
              <span style={{ width: pityPct + '%' }} />
            </span>
          </span>
        </a>
        <MenuItem href={paths.characters} icon="cards" label="캐릭터" kicker="OPERATORS" />
        <MenuItem href={paths.story} icon="book" label="스토리" kicker="STORY" />
        <MenuItem href={paths.archive} icon="notebook" label="기록" kicker="ARCHIVE" className="menu-archive" />
        <MenuItem href={paths.chat()} icon="chat" label="대화" kicker="TALK" />
        <MenuItem href={paths.shop} icon="bag" label="상점" kicker="SHOP" />
        <MenuItem href={paths.world} icon="globe" label="월드" kicker="WORLD" className="menu-world" />
      </nav>
    </div>
  );
}

function MenuItem({ href, icon, label, kicker, className }: { href: string; icon: IconName; label: string; kicker: string; className?: string }) {
  return (
    <a className={'menu-item' + (className ? ' ' + className : '')} href={'#' + href}>
      <span className="menu-node" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <strong>{label}</strong>
      <span className="kicker">{kicker}</span>
    </a>
  );
}

/** 로비 뒤 하늘: 궤도 고리와 반짝이는 별 (장식) */
function Sky() {
  const sparkles: [number, number, number][] = [
    [8, 14, 9], [22, 6, 5], [86, 10, 7], [93, 30, 5], [5, 46, 6], [14, 72, 5], [90, 62, 8], [78, 84, 5], [34, 90, 4], [62, 4, 4],
  ];
  return (
    <div className="lobby-sky" aria-hidden="true">
      {sparkles.map(([x, y, r], i) => (
        <svg key={i} className="sky-spark" style={{ left: x + '%', top: y + '%', width: r * 2, height: r * 2, animationDelay: i * 0.7 + 's' }} viewBox="-10 -10 20 20">
          <path d="M0-10C.8-2 2-.8 10 0 2 .8.8 2 0 10-.8 2-2 .8-10 0-2-.8-.8-2 0-10z" />
        </svg>
      ))}
    </div>
  );
}

/** 대표 캐릭터 뒤 궤도 고리 (장식) */
function Orbits() {
  return (
    <svg className="sky-orbits" viewBox="-500 -500 1000 1000" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <circle r="300" />
      <circle r="420" className="dash" />
      <ellipse rx="490" ry="150" transform="rotate(-18)" />
      <ellipse rx="470" ry="120" transform="rotate(24)" className="dash" />
    </svg>
  );
}
