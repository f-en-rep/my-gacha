// 상점 패널: 왼쪽은 잔액과 상품 종류, 오른쪽은 고른 종류의 상품.
// 폰에서는 종류를 고르면 오른쪽 페이지만 보인다 (주소 없이 컴포넌트 상태로, 오른쪽 페이지 안의 뒤로 버튼).
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../db';
import { now } from '../../core/id';
import { RARITIES_DESC } from '../../core/gacha';
import { SHOP_ERROR_TEXT, SHOP_PRICES, maxBundles, type ShopResult } from '../../core/shop';
import { paintPortrait } from '../../game/portraits';
import { putSave, rulesFor, useActiveGame, useCast } from '../../game/store';
import type { Character, Id, Save, World } from '../../types';
import { EmptyState } from '../common';
import { Icon } from '../Icon';
import { useSettings } from '../hooks';
import { PageHint, Panel } from '../panel/Panel';
import { paths } from '../router';
import { BundleOffer, PotentialOffer, RecruitOffer, type ShopCategory } from './offers';
import './shop.css';

const CATEGORIES: { key: ShopCategory; code: string; title: string; desc: string }[] = [
  { key: 'bundle', code: 'EXCHANGE', title: '뽑기 재화 교환', desc: '상점 재화를 뽑기 재화로 바꿉니다.' },
  { key: 'potential', code: 'BREAK', title: '한계 돌파', desc: '보유한 캐릭터를 한 단계 돌파시킵니다.' },
  { key: 'recruit', code: 'RECRUIT', title: '캐릭터 영입', desc: '아직 없는 캐릭터를 돌파 0으로 데려옵니다.' },
];

const fmt = (n: number) => n.toLocaleString('ko-KR');

/** 지금 저장된 세이브를 트랜잭션 안에서 다시 읽고 계산한다 (두 번 눌러도 두 번 빠지지 않게) */
async function commitShop(saveId: Id, apply: (s: Save) => ShopResult): Promise<ShopResult> {
  return db.transaction('rw', db.saves, async () => {
    const cur = await db.saves.get(saveId);
    if (!cur) throw new Error('세이브를 찾을 수 없습니다.');
    const r = apply(cur);
    if (r.ok) await putSave(r.save);
    return r;
  });
}

function NoWorld({ draft }: { draft: boolean }) {
  return (
    <EmptyState title={draft ? '월드가 아직 준비되지 않았습니다' : '플레이 중인 월드가 없습니다'} badge="NO WORLD">
      <p>{draft ? '월드 생성을 마치면 상점이 열립니다.' : '월드를 만들거나 가져오면 상점이 열립니다.'}</p>
      <p style={{ marginTop: 12 }}>
        <a className="btn btn-primary" href={'#' + paths.world}>
          월드로 가기
        </a>
      </p>
    </EmptyState>
  );
}

export function ShopPanel() {
  const { loading, world, save } = useActiveGame();
  const ready = !!world && world.status === 'ready' && !!save;
  const cast = useCast(ready ? world.id : undefined);
  const [category, setCategory] = useState<ShopCategory>();

  useEffect(() => {
    for (const el of document.querySelectorAll<HTMLElement>('.panel, .book, .page-right')) el.scrollTop = 0;
  }, [category]);

  const common = { name: 'shop' as const, code: 'SHOP', title: '상점' };
  if (loading) return <Panel {...common} left={null} right={null} />;
  if (!ready) {
    return (
      <Panel
        {...common}
        focus="left"
        left={<NoWorld draft={!!world && world.status !== 'ready'} />}
        right={<PageHint>월드가 준비되면 여기에서 상점 재화를 쓸 수 있습니다.</PageHint>}
      />
    );
  }

  return (
    <Panel
      {...common}
      focus={category ? 'right' : 'left'}
      left={<ShopLeft world={world} save={save} cast={cast ?? []} category={category} onCategory={setCategory} />}
      right={
        category && cast ? (
          <ShopRight key={category} world={world} save={save} cast={cast} category={category} onBack={() => setCategory(undefined)} />
        ) : (
          <PageHint>왼쪽에서 상품 종류를 고르세요.</PageHint>
        )
      }
    />
  );
}

function ShopLeft({
  world,
  save,
  cast,
  category,
  onCategory,
}: {
  world: World;
  save: Save;
  cast: Character[];
  category?: ShopCategory;
  onCategory: (c: ShopCategory) => void;
}) {
  const rules = rulesFor(world);
  const shopName = world.currency.shop || '상점 재화';
  const pullName = world.currency.pull || '뽑기 재화';
  const raisable = cast.filter((c) => {
    const o = save.owned[c.id];
    return o && o.potential < rules.maxPotential;
  }).length;
  const missing = cast.filter((c) => !save.owned[c.id]).length;
  const perRarity = (p: Record<number, number>) => RARITIES_DESC.map((r) => `${r}★ ${p[r]}`).join(' · ');

  const meta: Record<ShopCategory, { price: string; count?: string }> = {
    bundle: {
      price: `${shopName} ${SHOP_PRICES.bundle.cost} → ${pullName} ${SHOP_PRICES.bundle.pull}`,
      count: `최대 ${fmt(maxBundles(save))}묶음`,
    },
    potential: { price: perRarity(SHOP_PRICES.potential), count: `대상 ${raisable}명` },
    recruit: { price: perRarity(SHOP_PRICES.recruit), count: `미보유 ${missing}명` },
  };

  return (
    <div className="sh-left">
      <section className="sh-balance" aria-label="상점 재화 잔액">
        <div className="sh-balance-head">
          <span className="kicker">BALANCE</span>
          {save.freeMode && <span className="sh-free">자유 모드 · 전부 0</span>}
        </div>
        <p className="sh-balance-amount">
          <span className="sh-balance-name">{shopName}</span>
          <b className="mono">{fmt(save.wallet.shop)}</b>
        </p>
        <p className="small muted">
          한계 돌파가 최대(돌파 {rules.maxPotential - 1})인 캐릭터가 중복으로 나오면 받습니다 · {perRarity(rules.dupeShop)}
        </p>
        <p className="sh-balance-sub">
          <span className="currency currency-pull">
            <i aria-hidden="true" />
            {pullName} <b>{fmt(save.wallet.pull)}</b>
          </span>
        </p>
      </section>

      <ul className="sh-offers" aria-label="상품 종류">
        {CATEGORIES.map((c) => (
          <li key={c.key}>
            <button type="button" className="sh-offer" aria-pressed={category === c.key} onClick={() => onCategory(c.key)}>
              <span className="sh-offer-text">
                <span className="kicker">{c.code}</span>
                <strong>{c.title}</strong>
                <small>{c.desc}</small>
                <span className="sh-offer-price mono">{meta[c.key].price}</span>
              </span>
              <span className="sh-offer-side">
                {meta[c.key].count && <span className="mono">{meta[c.key].count}</span>}
                <span className="sh-chevron" aria-hidden="true">
                  ›
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShopRight({
  world,
  save,
  cast,
  category,
  onBack,
}: {
  world: World;
  save: Save;
  cast: Character[];
  category: ShopCategory;
  onBack: () => void;
}) {
  const rules = useMemo(() => rulesFor(world), [world]);
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const info = CATEGORIES.find((c) => c.key === category)!;

  /** 순수 함수를 트랜잭션 안에서 돌린다. 성공하면 새 세이브, 실패면 오류 글 */
  const run = async (apply: (s: Save) => ShopResult): Promise<{ save?: Save; error?: string }> => {
    if (lock.current) return {};
    lock.current = true;
    setBusy(true);
    try {
      const r = await commitShop(save.id, apply);
      return r.ok ? { save: r.save } : { error: SHOP_ERROR_TEXT[r.error] };
    } catch (e) {
      console.error(e);
      return { error: '저장하지 못했습니다. 다시 시도해 주세요.' };
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const paintIfNeeded = (c: Character) => {
    if (c.portraitId || (c.rarity <= 4 && !settings.autoPaintLowRarity)) return;
    paintPortrait(c.id, { priority: 'background' }).catch((e: unknown) => console.warn('초상화 그리기 실패', c.id, e));
  };

  const props = { world, save, cast, rules, busy, run, now };

  return (
    <div className="sh-right">
      <header className="sh-right-head">
        <button type="button" className="icon-btn sh-back" onClick={onBack} aria-label="상품 종류로 돌아가기">
          <Icon name="back" size={18} />
        </button>
        <div>
          <span className="kicker">{info.code}</span>
          <h2>{info.title}</h2>
        </div>
        <span className="currency sh-right-wallet">
          <i aria-hidden="true" />
          {world.currency.shop || '상점 재화'} <b>{fmt(save.wallet.shop)}</b>
        </span>
      </header>
      {category === 'bundle' && <BundleOffer {...props} />}
      {category === 'potential' && <PotentialOffer {...props} />}
      {category === 'recruit' && <RecruitOffer {...props} onRecruited={paintIfNeeded} />}
    </div>
  );
}
