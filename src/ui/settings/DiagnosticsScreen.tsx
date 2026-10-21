import { useState } from 'react';
import { db } from '../../db';
import type { ConnectionProfile } from '../../types';
import { EmptyState, PageHeader, TestBadge } from '../common';
import { useProfiles } from '../hooks';
import { paths } from '../router';
import { providerLabel, runConnectionTest, type TestOutcome } from '../connections';

interface RowResult {
  direct?: TestOutcome;
  relay?: TestOutcome;
  running?: 'direct' | 'relay';
}

function verdict(r: RowResult | undefined): { text: string; relay?: boolean } {
  if (!r?.direct || !r.relay) return { text: r?.running ? '확인 중' : '—' };
  const d = r.direct.state;
  const v = r.relay.state;
  if (d === 'pending' || v === 'pending') return { text: '테스트 미지원' };
  if (d === 'ok') return { text: '직접 연결', relay: false };
  if (v === 'ok') return { text: '중계기 필요', relay: true };
  return { text: '실패 · 키, 모델, 주소 확인' };
}

export function DiagnosticsScreen() {
  const profiles = useProfiles();
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [busy, setBusy] = useState(false);

  const patch = (id: string, r: Partial<RowResult>) => setResults((s) => ({ ...s, [id]: { ...s[id], ...r } }));

  async function runOne(p: ConnectionProfile) {
    patch(p.id, { direct: undefined, relay: undefined, running: 'direct' });
    const direct = await runConnectionTest({ ...p, useRelay: false });
    patch(p.id, { direct, running: 'relay' });
    const relay = await runConnectionTest({ ...p, useRelay: true });
    patch(p.id, { relay, running: undefined });
  }

  async function runAll() {
    if (!profiles) return;
    setBusy(true);
    for (const p of profiles) await runOne(p);
    setBusy(false);
  }

  return (
    <div className="stack diagnostics">
      <PageHeader
        kicker="DIAGNOSTICS"
        title="연결 진단"
        actions={
          profiles && profiles.length > 0 ? (
            <button className="btn btn-primary" onClick={() => void runAll()} disabled={busy}>
              {busy ? '테스트 중…' : '전체 테스트'}
            </button>
          ) : undefined
        }
      />

      <div className="explain">
        <div className="explain-item">
          <strong>직접 연결</strong>
          <p>브라우저가 서비스에 바로 요청합니다. 서비스가 허용하지 않으면(CORS) 키가 맞아도 실패합니다.</p>
        </div>
        <div className="explain-item">
          <strong>중계기</strong>
          <p>이 사이트의 /api/relay를 거쳐 전달합니다. 키는 저장하지 않습니다.</p>
        </div>
      </div>

      {profiles === undefined ? (
        <p className="muted">불러오는 중…</p>
      ) : profiles.length === 0 ? (
        <EmptyState title="연결이 없습니다">
          <p>
            <a href={'#' + paths.settings}>설정</a>에서 먼저 추가하세요.
          </p>
        </EmptyState>
      ) : (
        <div className="diag-wrap card">
          <table className="diag-table">
            <thead>
              <tr>
                <th scope="col">CONNECTION</th>
                <th scope="col">DIRECT</th>
                <th scope="col">RELAY</th>
                <th scope="col">RESULT</th>
                <th scope="col">
                  <span className="sr-only">동작</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const r = results[p.id];
                const v = verdict(r);
                const canApply = v.relay !== undefined && v.relay !== p.useRelay;
                return (
                  <tr key={p.id}>
                    <th scope="row">
                      <strong>{p.label}</strong>
                      <small className="muted">
                        {providerLabel(p)} · {p.useRelay ? '중계기' : '직접'}
                      </small>
                    </th>
                    <td data-label="DIRECT">
                      <TestBadge outcome={r?.direct} running={r?.running === 'direct'} />
                      {r?.direct && r.direct.state === 'fail' && <small className="diag-msg">{r.direct.message}</small>}
                    </td>
                    <td data-label="RELAY">
                      <TestBadge outcome={r?.relay} running={r?.running === 'relay'} />
                      {r?.relay && r.relay.state === 'fail' && <small className="diag-msg">{r.relay.message}</small>}
                    </td>
                    <td data-label="RESULT">
                      <span className="verdict">{v.text}</span>
                    </td>
                    <td className="diag-actions">
                      <button className="btn btn-small" onClick={() => void runOne(p)} disabled={busy || !!r?.running}>
                        테스트
                      </button>
                      {canApply && (
                        <button className="btn btn-small btn-primary" onClick={() => void db.profiles.update(p.id, { useRelay: v.relay })}>
                          {v.relay ? '중계기 켜기' : '중계기 끄기'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(() => {
        const pending = Object.values(results).some((r) => r.direct?.state === 'pending');
        return pending ? <p className="muted small">일부 서비스는 테스트를 지원하지 않습니다.</p> : null;
      })()}
    </div>
  );
}
