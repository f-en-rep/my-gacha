import { PageHeader } from '../common';
import { paths } from '../router';
import { ConnectionList } from './ConnectionList';
import { ConnectionEditor } from './ConnectionEditor';
import { RoutingPanel } from './RoutingPanel';
import { StoragePanel } from './StoragePanel';

/**
 * 설정. 좁으면 한 열(편집은 새 화면), 넓으면 목록 옆에 편집 화면.
 */
export function SettingsScreen({ editId }: { editId?: string }) {
  const editing = !!editId;
  return (
    <div className={`page settings ${editing ? 'is-editing' : ''}`}>
      <div className="settings-head">
        <PageHeader
          kicker="SETTINGS"
          title="설정"
          actions={
            <a className="btn btn-ghost" href={'#' + paths.diagnostics}>
              연결 진단
            </a>
          }
        />
      </div>
      <div className="settings-grid">
        <div className="settings-list">
          <ConnectionList selectedId={editId} />
        </div>
        {editId && (
          <div className="settings-detail">
            <ConnectionEditor key={editId} id={editId} />
          </div>
        )}
        <div className="settings-side">
          <RoutingPanel />
          <StoragePanel />
        </div>
      </div>
    </div>
  );
}
