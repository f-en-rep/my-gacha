// 캐릭터 초상화와 희귀도 표시. 캐릭터 패널과 로비가 같이 쓴다.
import { useAssetUrl } from '../../game/store';
import type { Id, Rarity } from '../../types';
import { CARD_LOCKED, cardFront } from '../cards';
import './characters.css';

/** 초상화가 없을 때의 빈 칸 (실루엣) */
export function Silhouette({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'silhouette'} viewBox="0 0 150 300" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <circle cx="75" cy="52" r="34" />
      <path d="M20 300 C20 180 35 112 75 104 C115 112 130 180 130 300 Z" />
    </svg>
  );
}

/**
 * 저장된 초상화. 미보유(locked)면 검은 카드, 초상화가 없으면 희귀도 카드, 희귀도도 모르면 실루엣.
 */
export function Portrait({
  assetId,
  alt,
  className,
  silhouetteClass,
  rarity,
  locked,
}: {
  assetId?: Id;
  alt: string;
  className?: string;
  silhouetteClass?: string;
  rarity?: Rarity;
  locked?: boolean;
}) {
  const url = useAssetUrl(locked ? undefined : assetId);
  const cls = className ?? 'portrait-img';
  if (url) return <img className={cls} src={url} alt={alt} draggable={false} />;
  if (locked) return <img className={cls + ' card-art'} src={CARD_LOCKED} alt="" draggable={false} />;
  if (rarity) return <img className={cls + ' card-art'} src={cardFront(rarity)} alt="" draggable={false} />;
  return <Silhouette className={silhouetteClass} />;
}

export function RarityBadge({ rarity, className }: { rarity: Rarity; className?: string }) {
  return (
    <span className={`rarity-badge r${rarity}${className ? ' ' + className : ''}`} aria-label={`${rarity}성`}>
      {rarity}★
    </span>
  );
}

export function Stars({ rarity }: { rarity: Rarity }) {
  return (
    <span className={`stars r${rarity}`} aria-label={`${rarity}성`}>
      {'★'.repeat(rarity)}
    </span>
  );
}

export function LockMark() {
  return (
    <svg className="lock-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  );
}
