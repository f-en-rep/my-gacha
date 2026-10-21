import { useId, useMemo, useState } from 'react';
import { canExchangeSpark, EMPTY_PROGRESS, pityKey, sixStarRate, type GachaRules } from '../../core/gacha';
import type { Banner, Character, Id, Save, World } from '../../types';
import { paths } from '../router';
import { BannerArt, bannerDates, bannerState, KIND_CODE, KIND_LABEL, pct, Portrait, STATE_LABEL, Stars } from './art';

function Featured({ ids, byId, rarity }: { ids: Id[]; byId: Map<Id, Character>; rarity: 5 | 6 }) {
  const list = ids.map((id) => byId.get(id)).filter((c): c is Character => !!c);
  if (list.length === 0) return null;
  return (
    <div className="pl-featured-row" data-rarity={rarity}>
      <span className="pl-featured-label mono">PICKUP {rarity}★</span>
      <ul className="pl-featured">
        {list.map((c) => (
          <li key={c.id}>
            <a className="pl-featured-item" href={'#' + paths.character(c.id)}>
              <Portrait character={c} className="pl-featured-portrait" />
              <span className="pl-featured-name">{c.name}</span>
              <Stars rarity={c.rarity} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 오른쪽 페이지: 고른 배너의 정보, 천장, 교환, 지갑, 뽑기 버튼 */
export function BannerDetail({
  world,
  save,
  banner,
  cast,
  rules,
  busy,
  message,
  onPull,
  onSpark,
}: {
  world: World;
  save: Save;
  banner: Banner;
  cast: Character[];
  rules: GachaRules;
  busy: boolean;
  message?: string;
  onPull: (count: 1 | 10) => void;
  onSpark: (characterId: Id) => void;
}) {
  const byId = useMemo(() => new Map<Id, Character>(cast.map((c) => [c.id, c])), [cast]);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<Id | undefined>(undefined);
  const pickName = useId();

  const state = bannerState(banner);
  const open = state === 'open';
  const key = pityKey(banner, rules);
  const sinceSix = save.pity[key]?.sinceSix ?? 0;
  const nextSix = sixStarRate(sinceSix, rules);
  const boosted = sinceSix >= rules.pityThreshold;
  const progress = save.banners[banner.id] ?? EMPTY_PROGRESS;
  const guarantee = rules.firstGuarantee;
  const free = save.freeMode;
  const cost1 = free ? 0 : rules.pullCost;
  const cost10 = free ? 0 : rules.pullCost * 10;
  const can1 = save.wallet.pull >= cost1;
  const can10 = save.wallet.pull >= cost10;
  const sparkReady = canExchangeSpark(save, banner, rules);
  const sparkChoices = banner.featured6.map((id) => byId.get(id)).filter((c): c is Character => !!c);
  const dates = bannerDates(banner);
  const pullName = world.currency.pull || '뽑기 재화';
  const shopName = world.currency.shop || '상점 재화';
  const r = rules.baseRates;
  const fc = rules.featuredChance[banner.kind];

  const confirmSpark = () => {
    const id = pick ?? sparkChoices[0]?.id;
    if (!id) return;
    onSpark(id);
    setPicking(false);
  };

  return (
    <div className="pl-detail">
      <header className="pl-detail-head">
        <BannerArt banner={banner} className="pl-detail-art" />
        <div className="pl-detail-title">
          <span className="kicker">
            {KIND_CODE[banner.kind]} · {KIND_LABEL[banner.kind]} 배너
            {banner.kind === 'limited' && ` · ${STATE_LABEL[state]}`}
          </span>
          <h2>{banner.name}</h2>
          {dates && <p className="mono muted">{dates}</p>}
        </div>
      </header>

      {(banner.featured6.length > 0 || banner.featured5.length > 0) && (
        <div className="pl-featured-wrap">
          <Featured ids={banner.featured6} byId={byId} rarity={6} />
          <Featured ids={banner.featured5} byId={byId} rarity={5} />
        </div>
      )}

      <p className="pl-rates small">
        <span>
          6★ {pct(r[6])} · 5★ {pct(r[5])} · 4★ {pct(r[4])} · 3★ {pct(r[3])}
        </span>
        <span className="muted">
          픽업 확률 6★ {pct(fc[6])} · 5★ {pct(fc[5])}
        </span>
      </p>

      <div className="pl-gauges">
        <div className="pl-gauge" data-boosted={boosted || undefined}>
          <div className="pl-gauge-head">
            <span className="mono">PITY{banner.kind === 'standard' ? ' · 상시 공유' : ' · 이 배너'}</span>
            <span className="mono">
              {sinceSix} / {rules.pityThreshold}
            </span>
          </div>
          <div
            className="meter"
            role="meter"
            aria-label="6★ 천장"
            aria-valuemin={0}
            aria-valuemax={rules.pityThreshold}
            aria-valuenow={Math.min(sinceSix, rules.pityThreshold)}
          >
            <span style={{ width: `${Math.min(100, (sinceSix / rules.pityThreshold) * 100)}%` }} />
          </div>
          <p className="small muted">
            다음 6★ 확률 <strong className="pl-rate-now">{pct(nextSix)}</strong>
            {boosted ? ` · ${rules.pityThreshold}회 넘김, 회당 +${pct(rules.pityStep)}` : ` · ${rules.pityThreshold}회 뒤부터 회당 +${pct(rules.pityStep)}`}
          </p>
        </div>

        <div className="pl-gauge">
          <div className="pl-gauge-head">
            <span className="mono">FIRST {guarantee.pulls}</span>
            <span className="mono">{progress.firstTenSatisfied ? 'DONE' : `${Math.min(progress.pulls, guarantee.pulls)} / ${guarantee.pulls}`}</span>
          </div>
          <p className="small muted">
            {progress.firstTenSatisfied
              ? `첫 ${guarantee.pulls}회 보장 받음`
              : `이 배너 첫 ${guarantee.pulls}회 안에 ${guarantee.minRarity}★ 이상 1회 보장 · ${Math.max(0, guarantee.pulls - progress.pulls)}회 남음`}
          </p>
        </div>

        {banner.kind === 'limited' && (
          <div className="pl-gauge">
            <div className="pl-gauge-head">
              <span className="mono">SPARK</span>
              <span className="mono">
                {progress.sparkPoints} / {rules.sparkCost}
              </span>
            </div>
            <div
              className="meter"
              role="meter"
              aria-label="교환 포인트"
              aria-valuemin={0}
              aria-valuemax={rules.sparkCost}
              aria-valuenow={Math.min(progress.sparkPoints, rules.sparkCost)}
            >
              <span style={{ width: `${Math.min(100, (progress.sparkPoints / rules.sparkCost) * 100)}%` }} />
            </div>
            <p className="small muted">한 번 뽑을 때마다 {rules.sparkPerPull}포인트. {rules.sparkCost}포인트로 픽업 6★ 하나와 교환합니다.</p>
            {sparkChoices.length > 0 && !picking && (
              <button type="button" className="btn btn-ghost pl-spark-btn" disabled={!sparkReady || busy} onClick={() => setPicking(true)}>
                {rules.sparkCost}포인트 교환
              </button>
            )}
            {picking && (
              <fieldset className="pl-spark-pick">
                <legend className="small">교환할 캐릭터</legend>
                {sparkChoices.map((c, i) => (
                  <label key={c.id} className="pl-spark-option">
                    <input type="radio" name={pickName} value={c.id} checked={(pick ?? sparkChoices[0]?.id) === c.id} onChange={() => setPick(c.id)} autoFocus={i === 0} />
                    <Portrait character={c} className="pl-spark-portrait" />
                    <span>
                      <strong>{c.name}</strong>
                      {save.owned[c.id] && <small className="muted"> 잠재 {save.owned[c.id]?.potential}</small>}
                    </span>
                  </label>
                ))}
                <div className="pl-spark-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setPicking(false)}>
                    취소
                  </button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={confirmSpark}>
                    교환
                  </button>
                </div>
              </fieldset>
            )}
          </div>
        )}
      </div>

      <div className="pl-buy">
        <div className="pl-wallet">
          <span className="currency currency-pull">
            <i aria-hidden="true" />
            {pullName} <b>{save.wallet.pull.toLocaleString('ko-KR')}</b>
          </span>
          <span className="currency">
            <i aria-hidden="true" />
            {shopName} <b>{save.wallet.shop.toLocaleString('ko-KR')}</b>
          </span>
          {free && <span className="pl-free">자유 모드</span>}
        </div>

        <div className="pull-actions pl-actions">
          <button type="button" className="btn" disabled={busy || !open || !can1} onClick={() => onPull(1)}>
            <span className="pl-btn-label">1회</span>
            <span className="pl-btn-cost mono">
              {pullName} {cost1.toLocaleString('ko-KR')}
            </span>
          </button>
          <button type="button" className="btn btn-accent" disabled={busy || !open || !can10} onClick={() => onPull(10)}>
            <span className="pl-btn-label">10회</span>
            <span className="pl-btn-cost mono">
              {pullName} {cost10.toLocaleString('ko-KR')}
            </span>
          </button>
        </div>

        <div aria-live="polite" className="pl-messages">
          {!open && <p className="pl-note">{state === 'upcoming' ? '아직 열리지 않은 배너입니다.' : '기간이 끝난 배너입니다.'}</p>}
          {open && !can10 && (
            <p className="pl-note">
              {pullName}이(가) 부족합니다{can1 ? ' (10회)' : ''}. 로비에서 매일 보상을 받거나, <a href={'#' + paths.world}>월드 설정</a>에서 자유 모드를 켜 보세요.
            </p>
          )}
          {message && <p className="pl-note pl-note-error">{message}</p>}
        </div>
      </div>
    </div>
  );
}
