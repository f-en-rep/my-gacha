import { useState } from 'react';
import { db } from '../../db';
import type { ConnectionProfile } from '../../types';
import { EmptyState, PageHeader, TestBadge } from '../common';
import { Icon } from '../Icon';
import { useProfiles } from '../hooks';
import { paths } from '../router';
import { providerLabel, runConnectionTest, type TestOutcome } from '../connections';

interface RowResult {
  direct?: TestOutcome;
  relay?: TestOutcome;
  running?: 'direct' | 'relay';
}

function verdict(r: RowResult | undefined): { text: string; relay?: boolean } {
  if (!r?.direct || !r.relay) return { text: r?.running ? '확인 중…' : '아직 안 돌림' };
  const d = r.direct.state;
  const v = r.relay.state;
  if (d === 'pending' || v === 'pending') return { text: '테스트 기능 준비 중' };
  if (d === 'ok') return { text: '직접 연결 가능', relay: false };
  if (v === 'ok') return { text: '중계기 필요', relay: true };
  return { text: '둘 다 실패 — 키·모델·주소 확인' };
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
    <div className="page diagnostics">
      <PageHeader
        title="연결 진단"
        subtitle="서비스마다 직접 연결과 중계기 연결을 각각 테스트해요"
        back={paths.settings}
        actions={
          profiles && profiles.length > 0 ? (
            <button className="btn btn-primary" onClick={() => void runAll()} disabled={busy}>
              <Icon name="pulse" size={18} /> {busy ? '테스트 중…' : '모두 테스트'}
            </button>
          ) : undefined
        }
      />

      <div className="explain">
        <div className="explain-item">
          <strong>CORS란?</strong>
          <p>브라우저는 보안 때문에, 다른 회사 서버가 "웹페이지에서 불러도 돼요"라고 허락한 경우에만 직접 요청을 보내요. 허락이 없으면 키가 맞아도 막혀요.</p>
        </div>
        <div className="explain-item">
          <strong>중계기란?</strong>
          <p>이 사이트에 붙은 작은 전달 서버(/api/relay)예요. 막힌 요청을 대신 전달만 하고, 키는 저장하지 않아요.</p>
        </div>
      </div>

      {profiles === undefined ? (
        <p className="muted">불러오는 중…</p>
      ) : profiles.length === 0 ? (
        <EmptyState icon="pulse" title="테스트할 연결이 없어요">
          <p>
            먼저 <a href={'#' + paths.settings}>설정 → 연결</a>에서 연결을 추가하세요.
          </p>
        </EmptyState>
      ) : (
        <div className="diag-wrap card">
          <table className="diag-table">
            <thead>
              <tr>
                <th scope="col">연결</th>
                <th scope="col">직접</th>
                <th scope="col">중계기</th>
                <th scope="col">판단</th>
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
                        {providerLabel(p)} · {p.useRelay ? '지금: 중계기 사용' : '지금: 직접'}
                      </small>
                    </th>
                    <td data-label="직접">
                      <TestBadge outcome={r?.direct} running={r?.running === 'direct'} />
                      {r?.direct && r.direct.state === 'fail' && <small className="diag-msg">{r.direct.message}</small>}
                    </td>
                    <td data-label="중계기">
                      <TestBadge outcome={r?.relay} running={r?.running === 'relay'} />
                      {r?.relay && r.relay.state === 'fail' && <small className="diag-msg">{r.relay.message}</small>}
                    </td>
                    <td data-label="판단">
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
        return pending ? <p className="muted small">일부 테스트 기능이 아직 구현 중이라 "준비 중"으로 보여요. 업데이트 후 다시 돌려 보세요.</p> : null;
      })()}
    </div>
  );
}
