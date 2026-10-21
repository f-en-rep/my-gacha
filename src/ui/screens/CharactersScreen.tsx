import { PageHeader, EmptyState } from '../common';

const FILTERS = ['전체', '6★', '5★', '4★', '3★', '보유'];

export function CharactersScreen() {
  return (
    <div className="page characters">
      <PageHeader kicker="OPERATORS" title="캐릭터" />
      <div className="chips" role="toolbar" aria-label="필터">
        {FILTERS.map((f, i) => (
          <button key={f} className="chip" aria-pressed={i === 0} disabled={i !== 0}>
            {f}
          </button>
        ))}
      </div>
      <div className="split">
        <div className="split-list">
          <div className="char-grid">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="char-slot">
                <div className="skeleton-art tall" />
                <span className="skeleton-line" />
              </div>
            ))}
          </div>
        </div>
        <div className="split-detail detail-first-narrow">
          <EmptyState title="캐릭터가 없습니다" badge="PHASE 1">
            <p>월드를 만들면 캐스트가 여기 나옵니다. 초상화는 처음 뽑았을 때 그립니다.</p>
          </EmptyState>
        </div>
      </div>
    </div>
  );
}
