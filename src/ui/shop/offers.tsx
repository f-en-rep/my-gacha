// 상점 오른쪽 페이지: 종류별 상품 (뽑기 재화 교환 / 공명 올리기 / 캐릭터 영입)
import { useState } from 'react';
import type { GachaRules } from '../../core/gacha';
import {
  SHOP_PRICES,
  buyPullBundles,
  bundleCost,
  maxBundles,
  potentialCost,
  raisePotential,
  recruitCharacter,
  recruitCost,
  type ShopResult,
} from '../../core/shop';
import type { Character, Rarity, Save, World } from '../../types';
import { Portrait, RarityBadge, Stars } from '../characters/Portrait';
import { paths } from '../router';
import { resonanceLabel } from '../terms';

export type ShopCategory = 'bundle' | 'potential' | 'recruit';

export interface OfferProps {
  world: World;
  save: Save;
  cast: Character[];
  rules: GachaRules;
  busy: boolean;
  /** 순수 함수를 트랜잭션 안에서 돌린다 */
  run: (apply: (s: Save) => ShopResult) => Promise<{ save?: Save; error?: string }>;
  now: () => string;
}

type Notice = { tone: 'ok' | 'error'; text: string } | undefined;

const fmt = (n: number) => n.toLocaleString('ko-KR');

function NoticeLine({ notice }: { notice: Notice }) {
  return (
    <div className="sh-notice-slot" aria-live="polite">
      {notice && <p className={`sh-notice sh-notice-${notice.tone}`}>{notice.text}</p>}
    </div>
  );
}

// ── 뽑기 재화 교환 ─────────────────────────────────

export function BundleOffer({ world, save, busy, run, now }: OfferProps) {
  const shopName = world.currency.shop || '상점 재화';
  const pullName = world.currency.pull || '뽑기 재화';
  const max = maxBundles(save);
  const [text, setText] = useState('1');
  const [notice, setNotice] = useState<Notice>();
  const parsed = Number.parseInt(text, 10);
  const count = Math.max(1, Math.min(Math.max(1, max), Number.isFinite(parsed) ? parsed : 1));
  const cost = bundleCost(save, count);
  const gain = SHOP_PRICES.bundle.pull * count;
  const can = max > 0 && save.wallet.shop >= cost;
  const short = bundleCost(save, 1) - save.wallet.shop;

  const set = (n: number) => setText(String(Math.max(1, Math.min(Math.max(1, max), n))));

  const buy = async () => {
    setNotice(undefined);
    const r = await run((s) => buyPullBundles(s, count, now()));
    if (r.save) {
      setNotice({ tone: 'ok', text: `${pullName} ${fmt(gain)}을(를) 받았습니다.` });
      setText('1');
    } else if (r.error) setNotice({ tone: 'error', text: r.error });
  };

  return (
    <div className="sh-bundle">
      <p className="small muted">
        {shopName} {SHOP_PRICES.bundle.cost}을(를) {pullName} {SHOP_PRICES.bundle.pull}(으)로 바꿉니다. 묶음 수를 정하세요.
      </p>

      <div className="sh-counter" role="group" aria-label="묶음 수">
        <button type="button" className="btn sh-step" onClick={() => set(count - 1)} disabled={busy || max === 0 || count <= 1} aria-label="하나 빼기">
          −
        </button>
        <label className="sh-count">
          <span className="sr-only">묶음 수</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, max)}
            value={text}
            disabled={busy || max === 0}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => set(count)}
          />
          <span className="mono">묶음</span>
        </label>
        <button type="button" className="btn sh-step" onClick={() => set(count + 1)} disabled={busy || count >= max} aria-label="하나 더하기">
          +
        </button>
        <button type="button" className="btn btn-ghost sh-max" onClick={() => set(max)} disabled={busy || max === 0 || count >= max}>
          최대
        </button>
      </div>

      <dl className="sh-sum">
        <div>
          <dt>내는 것</dt>
          <dd>
            {shopName} <b className="mono">{fmt(cost)}</b>
          </dd>
        </div>
        <div className="sh-sum-gain">
          <dt>받는 것</dt>
          <dd>
            {pullName} <b className="mono">+{fmt(gain)}</b>
          </dd>
        </div>
        <div>
          <dt>교환 후</dt>
          <dd className="mono">
            {shopName} {fmt(Math.max(0, save.wallet.shop - cost))} · {pullName} {fmt(save.wallet.pull + gain)}
          </dd>
        </div>
      </dl>

      {max === 0 && (
        <p className="sh-short-line">
          1묶음에 {shopName} {SHOP_PRICES.bundle.cost} 필요 · <b>{fmt(short)} 부족</b>
        </p>
      )}

      <button type="button" className="btn btn-accent sh-buy" disabled={busy || !can} onClick={() => void buy()}>
        {count}묶음 교환
        <span className="mono">
          {shopName} {fmt(cost)}
        </span>
      </button>
      <NoticeLine notice={notice} />
    </div>
  );
}

// ── 공용: 캐릭터 칸, 확인 상자 ─────────────────────

function Tile({
  character,
  line,
  cost,
  wallet,
  selected,
  disabled,
  onSelect,
}: {
  character: Character;
  line: string;
  cost: number;
  wallet: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const short = cost - wallet;
  return (
    <li>
      <button
        type="button"
        className="sh-tile"
        aria-pressed={selected}
        disabled={disabled || short > 0}
        onClick={onSelect}
        aria-label={`${character.name}, ${character.rarity}성, ${line}, 값 ${cost}${short > 0 ? `, ${short} 부족` : ''}`}
      >
        <span className="sh-tile-art">
          <Portrait assetId={character.portraitId} alt="" rarity={character.rarity} />
          <RarityBadge rarity={character.rarity} className="sh-tile-rarity" />
        </span>
        <span className="sh-tile-name">{character.name}</span>
        <span className="sh-tile-line mono">{line}</span>
        <span className="sh-tile-price">
          <b className="mono">{fmt(cost)}</b>
          {short > 0 && <span className="sh-short">{fmt(short)} 부족</span>}
        </span>
      </button>
    </li>
  );
}

function Confirm({
  character,
  title,
  line,
  cost,
  save,
  shopName,
  busy,
  buyLabel,
  onCancel,
  onBuy,
}: {
  character: Character;
  title: string;
  line: string;
  cost: number;
  save: Save;
  shopName: string;
  busy: boolean;
  buyLabel: string;
  onCancel: () => void;
  onBuy: () => void;
}) {
  return (
    <div className="sh-confirm" role="group" aria-label={title}>
      <span className="sh-confirm-art">
        <Portrait assetId={character.portraitId} alt="" rarity={character.rarity} />
      </span>
      <div className="sh-confirm-text">
        <span className="kicker">{title}</span>
        <strong>{character.name}</strong>
        <span className="small">{line}</span>
        <span className="mono sh-confirm-cost">
          {shopName} {fmt(cost)} · 남는 {fmt(save.wallet.shop - cost)}
        </span>
      </div>
      <div className="sh-confirm-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button type="button" className="btn btn-primary btn-small" onClick={onBuy} disabled={busy || save.wallet.shop < cost} autoFocus>
          {buyLabel}
        </button>
      </div>
    </div>
  );
}

// ── 공명 올리기 ────────────────────────────────────

export function PotentialOffer({ world, save, cast, rules, busy, run, now }: OfferProps) {
  const shopName = world.currency.shop || '상점 재화';
  const max = rules.maxPotential;
  const list = cast.filter((c) => {
    const o = save.owned[c.id];
    return o && o.potential < max;
  });
  const ownedCount = cast.filter((c) => save.owned[c.id]).length;
  const [selectedId, setSelectedId] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const selected = list.find((c) => c.id === selectedId);

  const buy = async (c: Character) => {
    setNotice(undefined);
    const r = await run((s) => raisePotential(s, c, now(), max));
    if (r.save) {
      const p = r.save.owned[c.id]?.potential ?? 0;
      setNotice({ tone: 'ok', text: `${c.name}의 공명이 올랐습니다. 이제 ${resonanceLabel(p)}입니다.${p >= max ? ' 최대입니다.' : ''}` });
      if (p >= max || r.save.wallet.shop < potentialCost(r.save, c.rarity)) setSelectedId(undefined);
    } else if (r.error) setNotice({ tone: 'error', text: r.error });
  };

  return (
    <div className="sh-chars">
      <p className="small muted">
        {resonanceLabel(max)} 미만인 보유 캐릭터 {list.length}명 · 한 번에 +1
      </p>
      <NoticeLine notice={notice} />
      {list.length === 0 ? (
        <p className="list-empty">
          {ownedCount === 0 ? '아직 보유한 캐릭터가 없습니다.' : `보유한 캐릭터가 모두 ${resonanceLabel(max)}입니다.`}{' '}
          {ownedCount === 0 && <a href={'#' + paths.pull}>뽑으러 가기</a>}
        </p>
      ) : (
        <ul className="sh-grid" aria-label="공명을 올릴 캐릭터">
          {list.map((c) => {
            const p = save.owned[c.id]!.potential;
            return (
              <Tile
                key={c.id}
                character={c}
                line={`${resonanceLabel(p)} → ${resonanceLabel(p + 1)}`}
                cost={potentialCost(save, c.rarity)}
                wallet={save.wallet.shop}
                selected={c.id === selectedId}
                disabled={busy}
                onSelect={() => setSelectedId(c.id)}
              />
            );
          })}
        </ul>
      )}
      {selected && (
        <Confirm
          character={selected}
          title="공명 올리기"
          line={`${resonanceLabel(save.owned[selected.id]!.potential)} → ${resonanceLabel(save.owned[selected.id]!.potential + 1)}`}
          cost={potentialCost(save, selected.rarity)}
          save={save}
          shopName={shopName}
          busy={busy}
          buyLabel="올리기"
          onCancel={() => setSelectedId(undefined)}
          onBuy={() => void buy(selected)}
        />
      )}
    </div>
  );
}

// ── 캐릭터 영입 ────────────────────────────────────

type RarityFilter = 'all' | Rarity;
const FILTERS: RarityFilter[] = ['all', 6, 5, 4, 3];

export function RecruitOffer({ world, save, cast, busy, run, now, onRecruited }: OfferProps & { onRecruited: (c: Character) => void }) {
  const shopName = world.currency.shop || '상점 재화';
  const missing = cast.filter((c) => !save.owned[c.id]);
  const [filter, setFilter] = useState<RarityFilter>('all');
  const [selectedId, setSelectedId] = useState<string>();
  const [done, setDone] = useState<Character>();
  const [notice, setNotice] = useState<Notice>();
  const list = missing.filter((c) => filter === 'all' || c.rarity === filter);
  const selected = list.find((c) => c.id === selectedId);

  const buy = async (c: Character) => {
    setNotice(undefined);
    const r = await run((s) => recruitCharacter(s, c, now()));
    if (r.save) {
      setSelectedId(undefined);
      setDone(c);
      onRecruited(c);
    } else if (r.error) setNotice({ tone: 'error', text: r.error });
  };

  return (
    <div className="sh-chars">
      {done && (
        <div className="sh-done" role="status">
          <span className="sh-done-art">
            <Portrait assetId={done.portraitId} alt="" rarity={done.rarity} />
          </span>
          <div className="sh-done-text">
            <span className="kicker">RECRUITED · 영입 완료</span>
            <strong>{done.name}</strong>
            <span>
              <Stars rarity={done.rarity} /> <span className="mono">{resonanceLabel(1)}</span>
            </span>
            <div className="sh-done-actions">
              <a className="btn btn-primary btn-small" href={'#' + paths.character(done.id)}>
                캐릭터 보기
              </a>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setDone(undefined)}>
                계속 영입
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="chips sh-filters" role="toolbar" aria-label="희귀도 필터">
        {FILTERS.map((f) => {
          const n = f === 'all' ? missing.length : missing.filter((c) => c.rarity === f).length;
          return (
            <button key={String(f)} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? '전체' : `${f}★`} <span className="mono sh-chip-n">{n}</span>
            </button>
          );
        })}
      </div>
      <NoticeLine notice={notice} />

      {list.length === 0 ? (
        <p className="list-empty">{missing.length === 0 ? '이 월드의 캐릭터를 모두 보유했습니다.' : '이 희귀도에는 미보유 캐릭터가 없습니다.'}</p>
      ) : (
        <ul className="sh-grid" aria-label="영입할 캐릭터">
          {list.map((c) => (
            <Tile
              key={c.id}
              character={c}
              line="미보유"
              cost={recruitCost(save, c.rarity)}
              wallet={save.wallet.shop}
              selected={c.id === selectedId}
              disabled={busy}
              onSelect={() => {
                setDone(undefined);
                setSelectedId(c.id);
              }}
            />
          ))}
        </ul>
      )}
      {selected && (
        <Confirm
          character={selected}
          title="캐릭터 영입"
          line={`${selected.rarity}★ · ${resonanceLabel(1)}으로 영입`}
          cost={recruitCost(save, selected.rarity)}
          save={save}
          shopName={shopName}
          busy={busy}
          buyLabel="영입"
          onCancel={() => setSelectedId(undefined)}
          onBuy={() => void buy(selected)}
        />
      )}
    </div>
  );
}
