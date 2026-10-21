// 생성 중이거나 멈춘 월드
import type { World } from '../../types';
import { cancelGeneration, startGeneration, useRunState } from './runner';
import { NeedTextConnection, useTextReady, worldName, WorldStatusPill } from './shared';

export function WorldProgress({ world }: { world: World }) {
  const run = useRunState(world.id);
  const text = useTextReady();
  // 이 탭에서 돌고 있으면 바로 받은 값, 아니면 DB에 남은 기록
  const p = (run.running && run.progress) || world.genProgress;
  const error = run.running ? undefined : (run.error ?? world.genProgress?.error);
  const pct = p && p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
  const stopped = !run.running && world.status === 'generating' && !error && !run.cancelled;

  return (
    <div className="wp stack">
      <header className="wz-head">
        <span className="kicker">{run.running ? 'GENERATING' : 'DRAFT'}</span>
        <h2>{world.name.trim() ? worldName(world) : run.running ? '이름 짓는 중…' : worldName(world)}</h2>
        {world.description && <p className="wp-desc muted small">{world.description}</p>}
      </header>

      <section className="wp-box" aria-live="polite">
        <div className="wp-line">
          <WorldStatusPill world={world} run={run} />
          <span className="mono muted">{p ? `${p.done}/${p.total}` : '—'}</span>
        </div>
        <strong className="wp-stage">{p?.stage ?? (run.running ? '준비 중…' : '아직 시작하지 않았습니다')}</strong>
        <div
          className={run.running ? 'meter wp-meter running' : 'meter wp-meter'}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={p?.total ?? 0}
          aria-valuenow={p?.done ?? 0}
          aria-label="생성 진행"
        >
          <span style={{ width: pct + '%' }} />
        </div>
        {run.running && <p className="small muted">패널을 닫아도 이 탭이 열려 있는 동안 계속 만듭니다. 멈춰도 만든 부분은 남아서 이어서 할 수 있습니다.</p>}
        {run.cancelled && !run.running && <p className="small muted">멈췄습니다. 만든 부분은 남아 있습니다.</p>}
        {stopped && <p className="small muted">생성이 중간에 끊겼습니다 (앱을 닫았거나 새로 고침). 이어서 할 수 있습니다.</p>}
      </section>

      {error && (
        <div className="form-errors" role="alert">
          <strong>생성 실패</strong>
          <p>{error}</p>
        </div>
      )}

      {run.running ? (
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => cancelGeneration(world.id)}>
            취소
          </button>
        </div>
      ) : text && !text.ready ? (
        <NeedTextConnection hasProfile={text.hasProfile} />
      ) : (
        <div className="form-actions">
          <button type="button" className="btn btn-accent" disabled={!text} onClick={() => void startGeneration(world.id)}>
            {world.genProgress ? '이어서 생성' : '생성 시작'}
          </button>
        </div>
      )}

      <details className="wp-input">
        <summary>입력한 내용</summary>
        <dl>
          <dt>세계관</dt>
          <dd>{world.description || '—'}</dd>
          <dt>시나리오</dt>
          <dd>{world.scenario || '—'}</dd>
          <dt>작가 지시문</dt>
          <dd>{world.directives || '—'}</dd>
        </dl>
      </details>
    </div>
  );
}
