import type { Banner, Id } from "../../types";
import { paths } from "../router";
import {
  BannerArt,
  bannerDates,
  bannerState,
  KIND_CODE,
  KIND_LABEL,
  STATE_LABEL,
} from "./art";

/** 왼쪽 페이지: 배너 고르기 (상시 먼저, 한정은 기간 표시) */
function PencilIcon() {
  return (
    <svg
      className="icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
    </svg>
  );
}

export function BannerList({
  banners,
  selectedId,
  onSelect,
  editable = false,
  creating = false,
}: {
  banners: Banner[];
  selectedId: Id | undefined;
  onSelect: (id: Id) => void;
  /** 배너마다 편집 링크, 목록 아래에 "새 배너 만들기" */
  editable?: boolean;
  /** 새 배너를 만드는 중 (버튼을 눌린 상태로) */
  creating?: boolean;
}) {
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
            <li
              key={b.id}
              className={
                editable
                  ? "pl-banner-item pl-banner-editable"
                  : "pl-banner-item"
              }
            >
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
                    {b.kind === "limited" && (
                      <span className="pl-state">{STATE_LABEL[state]}</span>
                    )}
                  </span>
                  {dates && (
                    <span className="pl-banner-dates mono">{dates}</span>
                  )}
                </span>
              </button>
              {editable && (
                <a
                  className="icon-btn pl-banner-edit"
                  href={"#" + paths.editBanner(b.id)}
                  aria-label={`${b.name} 배너 고치기`}
                  title="배너 고치기"
                >
                  <PencilIcon />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <a
          className="btn btn-ghost pl-new-banner"
          href={"#" + paths.newBanner}
          aria-current={creating ? "true" : undefined}
        >
          <span aria-hidden="true">+</span> 새 배너 만들기
        </a>
      )}
    </section>
  );
}
