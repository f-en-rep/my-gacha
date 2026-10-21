import { PageHeader, EmptyState } from '../common';

const FILTERS = ['전체', '6★', '5★', '4★', '3★', '보유만'];

export function CharactersScreen() {
  return (
    <div className="page">
      <PageHeader title="캐릭터" subtitle="태그·희귀도로 걸러 보기" />
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
          <EmptyState icon="cards" title="캐릭터가 아직 없어요" badge="1단계">
            <p>월드를 만들면 AI가 캐스트를 짜고 초상화를 그려요. 넓은 화면에서는 여기에 선택한 캐릭터의 프로필·대사·잠재 단계가 나와요.</p>
          </EmptyState>
        </div>
      </div>
    </div>
  );
}
