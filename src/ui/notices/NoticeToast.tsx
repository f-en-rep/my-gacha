// 로비에서 패널을 닫아 두었을 때 새 실패 알림이 오면 잠깐 띄우는 토스트. 알림 패널을 열면 거기서 본다.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { paths } from '../router';
import { JOB_LABEL, useLatestNotice } from '../../game/notices';
import type { Notice } from '../../types';
import './notices.css';

const SHOW_MS = 7000;

export function NoticeToast({ panelOpen }: { panelOpen: boolean }) {
  const latest = useLatestNotice();
  // 앱을 연 뒤에 생긴(또는 다시 난) 것만
  const since = useRef(new Date().toISOString());
  const [shown, setShown] = useState<Notice>();

  useEffect(() => {
    if (!latest || latest.kind !== 'error' || latest.readAt || latest.updatedAt <= since.current) return;
    since.current = latest.updatedAt;
    if (panelOpen) return;
    setShown(latest);
  }, [latest, panelOpen]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(undefined), SHOW_MS);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown || panelOpen) return null;
  return (
    <div className="nt-toast" role="alert">
      <a className="nt-toast-text" href={'#' + paths.notices} onClick={() => setShown(undefined)}>
        <strong>{shown.title}</strong>
        <small>{JOB_LABEL[shown.job]} 실패 · 알림에서 이유 보기</small>
      </a>
      <button type="button" className="icon-btn" aria-label="닫기" onClick={() => setShown(undefined)}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
