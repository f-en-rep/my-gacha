import { useState, type ReactNode } from 'react';
import { Icon } from '../Icon';
import { useSetupSteps } from '../setup';
import { paths } from '../router';
import { db } from '../../db';
import { DAILY_PULL_CURRENCY, rulesFor, today, useActiveGame, useCast, useWorlds } from '../../game/store';
import { now } from '../../core/id';
import { Portrait, Silhouette } from '../characters/Portrait';
import type { Character, Id, Save } from '../../types';
import './lobby-extra.css';

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

  const [quote, setQuote] = useState<{ id?: Id; i: number }>({ i: 0 });
  const quotes = featured?.quotes.filter((q) => q.trim()) ?? [];
  const quoteIndex = quote.id === featured?.id ? quote.i % Math.max(1, quotes.length) : 0;
  const speaking = !next && !!ready && !!featured;
  const nextQuote = () => setQuote({ id: featured?.id, i: quoteIndex + 1 });

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
    dialogBody = <p className="dialog-quote">{quotes.length ? quotes[quoteIndex] : '……'}</p>;
  }

  return (
    <div className="lobby" aria-hidden={panelOpen || undefined}>
      <div className="lobby-floor" aria-hidden="true" />

      <header className="lobby-hud">
        <span className="brand-mark" aria-hidden="true" />
        <div className="hud-world">
          <span className="kicker">WORLD</span>
          <strong>
            <span className="hud-world-name">{ready?.name ?? '월드 없음'}</span>
            {ready && save?.freeMode && <span className="hud-free">자유 모드</span>}
          </strong>
        </div>
        <div className="hud-currency">
          <span className="currency currency-pull">
            <i aria-hidden="true" />
            {ready?.currency.pull || '뽑기 재화'} <b>{wallet ? fmt(wallet.pull) : '—'}</b>
          </span>
          <span className="currency">
            <i aria-hidden="true" />
            {ready?.currency.shop || '상점 재화'} <b>{wallet ? fmt(wallet.shop) : '—'}</b>
          </span>
          {canClaim && (
            <button type="button" className="hud-daily" disabled={claiming} onClick={() => void claim()}>
              오늘의 보상 받기 <b>+{fmt(DAILY_PULL_CURRENCY)}</b>
            </button>
          )}
        </div>
        <a className="icon-btn hud-settings" href={'#' + paths.settings} aria-label="설정">
          <Icon name="gear" size={20} />
        </a>
      </header>

      <div className="lobby-stage">
        <div className="stage-frame">
          <div className="stage-motif" aria-hidden="true" />
          <div className={'stage-art' + (featured?.portraitId ? ' has-portrait' : '')}>
            {featured ? (
              <Portrait assetId={featured.portraitId} alt={featured.name} className="stage-portrait" silhouetteClass="lobby-figure" />
            ) : (
              <Silhouette className="lobby-figure" />
            )}
            <span className="stage-caption">{featured ? featured.name : '대표 캐릭터 자리'}</span>
          </div>
        </div>
      </div>

      <div
        className={'lobby-dialog' + (speaking && quotes.length > 1 ? ' is-cycling' : '')}
        role="status"
        onClick={speaking && quotes.length > 1 ? nextQuote : undefined}
      >
        <span className="dialog-name">{dialogName}</span>
        {dialogBody}
        {speaking && quotes.length > 1 ? (
          <button
            type="button"
            className="dialog-cursor dialog-next"
            aria-label="다음 대사"
            onClick={(e) => {
              e.stopPropagation();
              nextQuote();
            }}
          >
            ▼
          </button>
        ) : (
          <span className="dialog-cursor" aria-hidden="true">
            ▼
          </span>
        )}
      </div>

      <nav className="lobby-menu" aria-label="주 메뉴">
        <a className="menu-pull" href={'#' + paths.pull}>
          <span>
            <span className="kicker">HEADHUNT</span>
            <strong>뽑기</strong>
          </span>
          <span className="mono">
            PITY {pity}/{rules.pityThreshold} →
          </span>
        </a>
        <a href={'#' + paths.characters}>
          <strong>캐릭터</strong>
          <span className="kicker">OPERATORS</span>
        </a>
        <span className="menu-locked" aria-disabled="true">
          <strong>스토리</strong>
          <span className="kicker">PHASE 3</span>
        </span>
        <a href={'#' + paths.world}>
          <strong>월드</strong>
          <span className="kicker">WORLD</span>
        </a>
      </nav>
    </div>
  );
}
