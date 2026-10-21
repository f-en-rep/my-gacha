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
    <Section title="연결">
      <p className="muted small">키는 이 브라우저에만 저장됩니다.</p>
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
        <p className="small list-empty">연결이 없습니다.</p>
      ) : (
        <>
          {text.length > 0 && (
            <>
              <h3 className="list-label">TEXT</h3>
              <ul className="conn-list">
                {text.map((p) => (
                  <Row key={p.id} p={p} selected={p.id === selectedId} />
                ))}
              </ul>
            </>
          )}
          {image.length > 0 && (
            <>
              <h3 className="list-label">IMAGE</h3>
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
