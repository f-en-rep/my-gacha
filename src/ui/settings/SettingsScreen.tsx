import { PageHeader } from '../common';
import { paths } from '../router';
import { ConnectionList } from './ConnectionList';
import { ConnectionEditor } from './ConnectionEditor';
import { RoutingPanel } from './RoutingPanel';
import { StoragePanel } from './StoragePanel';
import { EmptyState } from '../common';

/**
 * 설정. 좁으면 한 열(편집은 새 화면), 중간이면 목록+상세, 넓으면 목록+상세+옆 패널.
 */
export function SettingsScreen({ editId }: { editId?: string }) {
  const editing = !!editId;
  return (
    <div className={`page settings ${editing ? 'is-editing' : ''}`}>
      <div className="settings-head">
        <PageHeader
          title="설정"
          subtitle="연결, 작업별 연결, 저장 공간"
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
        <div className="settings-detail">
          {editId ? (
            <ConnectionEditor key={editId} id={editId} />
          ) : (
            <div className="detail-placeholder">
              <EmptyState icon="gear" title="연결을 골라 편집하세요">
                <p>왼쪽 목록에서 연결을 누르거나 새 연결을 추가하세요.</p>
              </EmptyState>
            </div>
          )}
        </div>
        <div className="settings-side">
          <RoutingPanel />
          <StoragePanel />
        </div>
      </div>
    </div>
  );
}
