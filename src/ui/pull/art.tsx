// 뽑기 화면에서 쓰는 작은 그림 조각: 초상화(없으면 실루엣), 별, 배너 그림, 배너 열림 상태.
import { useAssetUrl } from '../../game/store';
import type { Banner, Character, Rarity } from '../../types';
import { cardFront } from '../cards';

export function Silhouette({ className = '' }: { className?: string }) {
  return (
    <svg className={'pl-silhouette ' + className} viewBox="0 0 150 200" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <circle cx="75" cy="62" r="30" />
      <path d="M22 200 C22 132 38 102 75 96 C112 102 128 132 128 200 Z" />
    </svg>
  );
}

/** 캐릭터 초상화. portraitId가 채워지면 바로 그림으로 바뀐다 (useAssetUrl이 반응형) */
export function Portrait({ character, className = '' }: { character: Character | undefined; className?: string }) {
  const url = useAssetUrl(character?.portraitId);
  return (
    <div className={'pl-portrait ' + className}>
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" />
      ) : character ? (
        <img className="pl-card-art" src={cardFront(character.rarity)} alt="" loading="lazy" decoding="async" />
      ) : (
        <Silhouette />
      )}
    </div>
  );
}

export function Stars({ rarity, className = '' }: { rarity: Rarity; className?: string }) {
  return (
    <span className={'pl-stars ' + className} aria-label={`${rarity}성`}>
      {'★'.repeat(rarity)}
    </span>
  );
}

export function BannerArt({ banner, className = '' }: { banner: Banner; className?: string }) {
  const url = useAssetUrl(banner.artId);
  return (
    <div className={'pl-banner-art ' + className} aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <span className="pl-hatch" />}
    </div>
  );
}

export type BannerState = 'open' | 'upcoming' | 'ended';

export function bannerState(banner: Banner, at = Date.now()): BannerState {
  if (banner.startsAt && Date.parse(banner.startsAt) > at) return 'upcoming';
  if (banner.endsAt && Date.parse(banner.endsAt) < at) return 'ended';
  return 'open';
}

function ymd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** 한정 배너 기간 글 */
export function bannerDates(banner: Banner): string | undefined {
  if (!banner.startsAt && !banner.endsAt) return undefined;
  return `${banner.startsAt ? ymd(banner.startsAt) : ''} – ${banner.endsAt ? ymd(banner.endsAt) : ''}`;
}

export const KIND_LABEL = { standard: '상시', limited: '한정' } as const;
export const KIND_CODE = { standard: 'STANDARD', limited: 'LIMITED' } as const;
export const STATE_LABEL: Record<BannerState, string> = { open: '진행 중', upcoming: '예정', ended: '종료' };

export function pct(x: number): string {
  const v = x * 100;
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + '%';
}
