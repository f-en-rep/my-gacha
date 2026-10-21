import { EmptyState } from '../common';
import { Panel } from '../panel/Panel';

const FILTERS = ['전체', '6★', '5★', '4★', '3★', '보유'];

export function CharactersPanel() {
  return (
    <Panel
      name="characters"
      code="OPERATORS"
      title="캐릭터"
      left={
        <div className="stack">
          <div className="chips" role="toolbar" aria-label="필터">
            {FILTERS.map((f, i) => (
              <button key={f} className="chip" aria-pressed={i === 0} disabled={i !== 0}>
                {f}
              </button>
            ))}
          </div>
          <div className="char-grid">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="char-slot">
                <div className="skeleton-art tall" />
                <span className="skeleton-line" />
              </div>
            ))}
          </div>
        </div>
      }
      right={
        <EmptyState title="캐릭터가 없습니다" badge="PHASE 1">
          <p>월드를 만들면 캐스트가 왼쪽에 나오고, 고른 캐릭터의 프로필이 여기 펼쳐집니다. 초상화는 처음 뽑았을 때 그립니다.</p>
        </EmptyState>
      }
    />
  );
}
