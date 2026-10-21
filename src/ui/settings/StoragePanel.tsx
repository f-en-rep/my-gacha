import { useEffect, useState } from 'react';
import { Section } from '../common';
import { requestPersistentStorage } from '../../db';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function StoragePanel() {
  const [persisted, setPersisted] = useState<boolean>();
  const [est, setEst] = useState<{ usage: number; quota: number }>();

  async function refresh() {
    try {
      setPersisted((await navigator.storage?.persisted?.()) ?? false);
      const e = await navigator.storage?.estimate?.();
      if (e) setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 });
    } catch {
      setPersisted(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const pct = est && est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
  const showIosHint = isIos() && !isStandalone();

  return (
    <Section title="저장 공간">
      <div className="stack">
        <div className="storage-status">
          <span className={`pill ${persisted ? 'pill-ok' : persisted === false ? 'pill-pending' : ''}`}>
            {persisted === undefined ? '확인 중' : persisted ? '보존됨' : '보존 안 됨'}
          </span>
          <p className="small">
            {persisted
              ? '브라우저가 데이터를 임의로 지우지 않습니다.'
              : '공간이 부족하거나 오래 안 쓰면 브라우저가 지울 수 있습니다. 가끔 백업하세요.'}
          </p>
        </div>
        {persisted === false && (
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await requestPersistentStorage();
              await refresh();
            }}
          >
            보존 다시 요청
          </button>
        )}
        {est && (
          <div>
            <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="저장 공간 사용량">
              <span style={{ width: `${Math.max(pct, 0.5)}%` }} />
            </div>
            <p className="muted small">
              {formatBytes(est.usage)} 사용 / 약 {formatBytes(est.quota)} 가능
            </p>
          </div>
        )}
        <div className={`hint-box ${showIosHint ? 'hint-strong' : ''}`}>
          <strong>iPhone · iPad</strong>
          <p className="small">
            Safari는 7일 넘게 안 연 사이트의 데이터를 지울 수 있습니다. 공유 → <b>홈 화면에 추가</b>로 설치해 두세요.
          </p>
        </div>
      </div>
    </Section>
  );
}
