import { Icon } from '../Icon';
import { Panel, PageHint } from '../panel/Panel';
import { paths, type SettingsSub } from '../router';
import { ConnectionList } from './ConnectionList';
import { ConnectionEditor } from './ConnectionEditor';
import { RoutingPanel } from './RoutingPanel';
import { StoragePanel } from './StoragePanel';
import { DiagnosticsScreen } from './DiagnosticsScreen';
import { PromptList } from './PromptList';
import { PromptEditor } from './PromptEditor';

const MORE: { kind: SettingsSub['kind']; label: string; hint: string; path: string }[] = [
  { kind: 'routing', label: '작업별 연결', hint: '어떤 일에 어떤 모델을 쓸지', path: paths.routing },
  { kind: 'prompts', label: '프롬프트', hint: 'AI에게 보내는 글 보기·고치기', path: paths.prompts },
  { kind: 'storage', label: '저장 공간', hint: '보존 상태, 사용량', path: paths.storage },
  { kind: 'diagnostics', label: '연결 진단', hint: '중계기가 필요한지 확인', path: paths.diagnostics },
];

function Right({ sub }: { sub?: SettingsSub }) {
  if (!sub) return <PageHint>왼쪽에서 연결이나 항목을 고르세요.</PageHint>;
  switch (sub.kind) {
    case 'connection':
      return <ConnectionEditor key={sub.id} id={sub.id} />;
    case 'routing':
      return <RoutingPanel />;
    case 'storage':
      return <StoragePanel />;
    case 'diagnostics':
      return <DiagnosticsScreen />;
    case 'prompts':
      return sub.id ? <PromptEditor key={sub.id} id={sub.id} /> : <PromptList />;
  }
}

export function SettingsPanel({ sub }: { sub?: SettingsSub }) {
  return (
    <Panel
      name="settings"
      code="SETTINGS"
      title="설정"
      focus={sub ? 'right' : 'left'}
      back={sub?.kind === 'prompts' && sub.id ? paths.prompts : paths.settings}
      left={
        <div className="stack">
          <ConnectionList selectedId={sub?.kind === 'connection' ? sub.id : undefined} />
          <ul className="menu-list">
            {MORE.map((m) => (
              <li key={m.kind}>
                <a className="menu-row" href={'#' + m.path} aria-current={sub?.kind === m.kind ? 'true' : undefined}>
                  <span className="menu-row-text">
                    <strong>{m.label}</strong>
                    <small>{m.hint}</small>
                  </span>
                  <Icon name="chevron" size={16} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      }
      right={<Right sub={sub} />}
    />
  );
}
