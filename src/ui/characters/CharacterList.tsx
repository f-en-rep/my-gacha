// 캐릭터 패널 왼쪽 페이지: 필터 + 카드 목록
import { paths } from '../router';
import type { Character, Id, Rarity, Save, World } from '../../types';
import { LockMark, Portrait, RarityBadge } from './Portrait';
import './character-editor.css';
import { resonanceLabel } from '../terms';

export type RarityFilter = 'all' | Rarity | 'owned';
/** "role:딜러" 처럼 분류:값. 빈 문자열이면 전체 */
export type TagFilter = string;

const RARITY_CHIPS: { value: RarityFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 6, label: '6★' },
  { value: 5, label: '5★' },
  { value: 4, label: '4★' },
  { value: 3, label: '3★' },
  { value: 'owned', label: '보유만' },
];

const TAG_GROUPS: { key: 'position' | 'role' | 'element' | 'trait'; label: string }[] = [
  { key: 'role', label: '역할' },
  { key: 'element', label: '속성' },
  { key: 'position', label: '위치' },
  { key: 'trait', label: '특징' },
];

export function matchesTag(c: Character, filter: TagFilter): boolean {
  if (!filter) return true;
  const i = filter.indexOf(':');
  const key = filter.slice(0, i);
  const value = filter.slice(i + 1);
  switch (key) {
    case 'position':
      return c.tags.position === value;
    case 'element':
      return c.tags.element === value;
    case 'role':
      return c.tags.role.includes(value);
    case 'trait':
      return c.tags.trait.includes(value);
    default:
      return true;
  }
}

export function filterCast(cast: Character[], save: Save | undefined, rarity: RarityFilter, tag: TagFilter): Character[] {
  return cast.filter((c) => {
    if (rarity === 'owned' ? !save?.owned[c.id] : rarity !== 'all' && c.rarity !== rarity) return false;
    return matchesTag(c, tag);
  });
}

export function CharacterList({
  world,
  cast,
  save,
  selectedId,
  rarity,
  tag,
  onRarity,
  onTag,
}: {
  world: World;
  cast: Character[];
  save?: Save;
  selectedId?: Id;
  rarity: RarityFilter;
  tag: TagFilter;
  onRarity: (r: RarityFilter) => void;
  onTag: (t: TagFilter) => void;
}) {
  const list = filterCast(cast, save, rarity, tag);
  const ownedCount = cast.filter((c) => save?.owned[c.id]).length;
  // 실제로 캐스트에 쓰인 태그만 고를 수 있게 (월드 목록 순서 유지)
  const used = (key: (typeof TAG_GROUPS)[number]['key'], v: string) => cast.some((c) => matchesTag(c, `${key}:${v}`));

  return (
    <div className="stack chars-left">
      <div className="chars-actions">
        <a className="btn btn-small" href={'#' + paths.newCharacter}>
          새 캐릭터
        </a>
        <a className="btn btn-small" href={'#' + paths.importCards}>
          카드 가져오기
        </a>
      </div>
      <div className="chars-filters">
        <div className="chips" role="toolbar" aria-label="희귀도 필터">
          {RARITY_CHIPS.map((f) => (
            <button key={String(f.value)} type="button" className="chip" aria-pressed={rarity === f.value} onClick={() => onRarity(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="chars-filter-row">
          <label className="chars-tag-select">
            <span className="sr-only">태그 필터</span>
            <select value={tag} onChange={(e) => onTag(e.target.value)}>
              <option value="">모든 태그</option>
              {TAG_GROUPS.map((g) => {
                const values = world.tags[g.key].filter((v) => used(g.key, v));
                if (!values.length) return null;
                return (
                  <optgroup key={g.key} label={g.label}>
                    {values.map((v) => (
                      <option key={v} value={`${g.key}:${v}`}>
                        {v}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
          <span className="mono chars-count">
            {list.length}명 · 보유 {ownedCount}/{cast.length}
          </span>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="list-empty">조건에 맞는 캐릭터가 없습니다.</p>
      ) : (
        <ul className="cc-grid" aria-label="캐릭터 목록">
          {list.map((c) => {
            const owned = save?.owned[c.id];
            return (
              <li key={c.id}>
                <a
                  className="cc-card"
                  href={'#' + paths.character(c.id)}
                  aria-current={c.id === selectedId ? 'true' : undefined}
                  data-owned={owned ? 'true' : 'false'}
                >
                  <span className="cc-art">
                    <Portrait assetId={c.portraitId} alt="" silhouetteClass="silhouette" rarity={c.rarity} locked={!owned} />
                    <RarityBadge rarity={c.rarity} className="cc-rarity" />
                    {!owned && (
                      <span className="cc-lock" aria-label="미보유">
                        <LockMark />
                      </span>
                    )}
                  </span>
                  <span className="cc-name">{c.name}</span>
                  <span className="cc-sub mono">{owned ? resonanceLabel(owned.potential) : '미보유'}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
