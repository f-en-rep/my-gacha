import { Icon } from '../Icon';
import { Section } from '../common';
import { useProfiles } from '../hooks';
import { paths } from '../router';
import { providerLabel } from '../connections';
import type { ConnectionProfile } from '../../types';

function Row({ p, selected }: { p: ConnectionProfile; selected: boolean }) {
  return (
    <li>
      <a className="conn-row" href={'#' + paths.connection(p.id)} aria-current={selected ? 'true' : undefined}>
        <span className={`conn-type conn-type-${p.type}`} aria-hidden="true">
          <Icon name={p.type === 'text' ? 'text' : 'image'} size={20} />
        </span>
        <span className="conn-main">
          <strong>{p.label || '(이름 없음)'}</strong>
          <small>
            {providerLabel(p)} · {p.model || '모델 미지정'}
          </small>
        </span>
        {p.useRelay && <span className="pill">중계기</span>}
        <Icon name="chevron" size={18} />
      </a>
    </li>
  );
}

export function ConnectionList({ selectedId }: { selectedId?: string }) {
  const profiles = useProfiles();
  const text = profiles?.filter((p) => p.type === 'text') ?? [];
  const image = profiles?.filter((p) => p.type === 'image') ?? [];

  return (
    <Section title="연결" icon="pulse">
      <p className="muted small">
        AI 서비스 주소와 API 키 묶음이에요. API 키는 <strong>이 브라우저에만</strong> 저장되고, 월드 팩·백업으로 절대 내보내지 않아요.
      </p>
      <div className="add-row">
        <a className="btn" href={'#' + paths.connection('new-text')} aria-current={selectedId === 'new-text' ? 'true' : undefined}>
          <Icon name="plus" size={18} /> 글 연결
        </a>
        <a className="btn" href={'#' + paths.connection('new-image')} aria-current={selectedId === 'new-image' ? 'true' : undefined}>
          <Icon name="plus" size={18} /> 그림 연결
        </a>
      </div>
      {profiles === undefined ? (
        <p className="muted">불러오는 중…</p>
      ) : profiles.length === 0 ? (
        <p className="muted small list-empty">아직 연결이 없어요. 위 버튼으로 추가하세요.</p>
      ) : (
        <>
          {text.length > 0 && (
            <>
              <h3 className="list-label">글 생성</h3>
              <ul className="conn-list">
                {text.map((p) => (
                  <Row key={p.id} p={p} selected={p.id === selectedId} />
                ))}
              </ul>
            </>
          )}
          {image.length > 0 && (
            <>
              <h3 className="list-label">그림 생성</h3>
              <ul className="conn-list">
                {image.map((p) => (
                  <Row key={p.id} p={p} selected={p.id === selectedId} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Section>
  );
}
