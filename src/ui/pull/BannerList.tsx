import type { Banner, Id } from '../../types';
import { BannerArt, bannerDates, bannerState, KIND_CODE, KIND_LABEL, STATE_LABEL } from './art';

/** 왼쪽 페이지: 배너 고르기 (상시 먼저, 한정은 기간 표시) */
export function BannerList({ banners, selectedId, onSelect }: { banners: Banner[]; selectedId: Id | undefined; onSelect: (id: Id) => void }) {
  return (
    <section className="pl-section" aria-labelledby="pl-banners-h">
      <div className="page-section-head">
        <h2 id="pl-banners-h">배너</h2>
        <span className="mono muted">{banners.length}</span>
      </div>
      <ul className="pl-banner-list">
        {banners.map((b) => {
          const state = bannerState(b);
          const dates = bannerDates(b);
          const selected = b.id === selectedId;
          return (
            <li key={b.id}>
              <button
                type="button"
                className="pl-banner-card"
                aria-pressed={selected}
                data-kind={b.kind}
                data-state={state}
                onClick={() => onSelect(b.id)}
              >
                <BannerArt banner={b} />
                <span className="pl-banner-meta">
                  <span className="pl-banner-name">{b.name}</span>
                  <span className="pl-banner-sub">
                    <span className="mono">{KIND_CODE[b.kind]}</span>
                    <span className="sr-only">{KIND_LABEL[b.kind]} 배너</span>
                    {b.kind === 'limited' && <span className="pl-state">{STATE_LABEL[state]}</span>}
                  </span>
                  {dates && <span className="pl-banner-dates mono">{dates}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
