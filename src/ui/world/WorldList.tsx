// 왼쪽 페이지: 새 월드 / 팩 열기 / 백업 불러오기 + 월드 목록
import { useEffect, useRef, useState } from 'react';
import { db, getSettings } from '../../db';
import { activateWorld, deleteWorld } from '../../game/store';
import { importBackup, importWorldPack } from '../../pack';
import { Icon } from '../Icon';
import { navigate } from '../router';
import type { Id, World } from '../../types';
import { cancelGeneration, startGeneration, useRunState } from './runner';
import { errorText, languageLabel, useTextReady, worldName, worldPaths, WorldStatusPill } from './shared';

export function WorldList({ worlds, activeId, selectedId }: { worlds: World[] | undefined; activeId?: Id; selectedId?: Id }) {
  const [busy, setBusy] = useState<string>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [deleting, setDeleting] = useState<World>();
  const packInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  async function onFile(kind: 'pack' | 'backup', file: File | undefined) {
    if (!file) return;
    setBusy(kind === 'pack' ? '월드 팩을 여는 중…' : '백업을 불러오는 중…');
    setMsg(undefined);
    try {
      const id = kind === 'pack' ? await importWorldPack(file) : await importBackup(file);
      const w = await db.worlds.get(id);
      // 플레이 중인 월드가 없으면 바로 플레이할 수 있게
      if (!(await getSettings()).activeWorldId) await activateWorld(id);
      setMsg({ ok: true, text: `"${w ? worldName(w) : '월드'}"을(를) ${kind === 'pack' ? '가져왔습니다' : '되살렸습니다'}.` });
      navigate(worldPaths.of(id));
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="stack">
      <div className="wl-actions">
        <a className="btn btn-accent wl-new" href={'#' + worldPaths.new}>
          <Icon name="plus" size={18} /> 새 월드
        </a>
        <button type="button" className="btn" disabled={!!busy} onClick={() => packInput.current?.click()}>
          월드 팩 열기
        </button>
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => backupInput.current?.click()}>
          백업 불러오기
        </button>
        <input
          ref={packInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            void onFile('pack', e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={backupInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            void onFile('backup', e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {busy && (
        <p className="wl-msg" role="status">
          <span className="pill pill-run">{busy}</span>
        </p>
      )}
      {msg && (
        <p className={msg.ok ? 'wl-msg wl-msg-ok' : 'wl-msg wl-msg-fail'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}

      <div>
        <div className="page-section-head">
          <h2>내 월드</h2>
          <span className="mono muted">{worlds?.length ?? '—'}</span>
        </div>
        {worlds && worlds.length === 0 && <p className="wl-empty">아직 월드가 없습니다. 새로 만들거나 친구에게 받은 월드 팩을 열어 보세요.</p>}
        <ul className="wl-list">
          {worlds?.map((w) => (
            <WorldRow key={w.id} world={w} active={w.id === activeId} selected={w.id === selectedId} onDelete={() => setDeleting(w)} />
          ))}
        </ul>
      </div>

      {deleting && (
        <DeleteDialog
          world={deleting}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            if (selectedId === deleting.id) navigate(worldPaths.root, { replace: true });
            setDeleting(undefined);
          }}
        />
      )}
    </div>
  );
}

function WorldRow({ world, active, selected, onDelete }: { world: World; active: boolean; selected: boolean; onDelete: () => void }) {
  const run = useRunState(world.id);
  const text = useTextReady();
  const [err, setErr] = useState<string>();
  const ready = world.status === 'ready';

  return (
    <li className="wl-item" aria-current={selected ? 'true' : undefined} data-active={active || undefined}>
      <a className="wl-main" href={'#' + worldPaths.of(world.id)}>
        <span className="wl-title">
          <strong>{worldName(world)}</strong>
          {active && <span className="wl-mark">플레이 중</span>}
          {world.importedFrom && <span className="tag-optional">받은 월드</span>}
        </span>
        <span className="wl-meta">
          <WorldStatusPill world={world} run={run} />
          <span>{languageLabel(world.language)}</span>
          {world.author && <span>만든 사람 {world.author}</span>}
        </span>
      </a>
      <div className="wl-row-actions">
        {ready && !active && (
          <button
            type="button"
            className="btn btn-small btn-primary"
            onClick={() =>
              activateWorld(world.id).then(
                () => navigate(worldPaths.of(world.id)),
                (e) => setErr(errorText(e)),
              )
            }
          >
            플레이
          </button>
        )}
        {!ready && !run.running && (
          <button
            type="button"
            className="btn btn-small"
            disabled={!text?.ready}
            title={text?.ready ? undefined : '글 연결을 먼저 지정하세요'}
            onClick={() => {
              navigate(worldPaths.of(world.id));
              void startGeneration(world.id);
            }}
          >
            이어서 생성
          </button>
        )}
        <button type="button" className="btn btn-small btn-danger" onClick={onDelete}>
          삭제
        </button>
      </div>
      {err && <p className="field-error">{err}</p>}
    </li>
  );
}

function DeleteDialog({ world, onClose, onDeleted }: { world: World; onClose: () => void; onDeleted: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [counts, setCounts] = useState<{ chars: number; images: number; saves: number; pulls: number }>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    let alive = true;
    void (async () => {
      const [chars, images, saveIds] = await Promise.all([
        db.characters.where('worldId').equals(world.id).count(),
        db.assets.where('worldId').equals(world.id).count(),
        db.saves.where('worldId').equals(world.id).primaryKeys(),
      ]);
      let pulls = 0;
      for (const s of saveIds) pulls += await db.pulls.where('saveId').equals(s).count();
      if (alive) setCounts({ chars, images, saves: saveIds.length, pulls });
    })();
    return () => {
      alive = false;
    };
  }, [world.id]);

  async function confirm() {
    setBusy(true);
    try {
      cancelGeneration(world.id);
      await deleteWorld(world.id);
      onDeleted();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="wl-dialog" onClose={onClose} aria-labelledby="wl-dialog-title">
      <h2 id="wl-dialog-title">"{worldName(world)}" 삭제</h2>
      <p>이 월드와 거기 딸린 것이 모두 지워집니다. 되돌릴 수 없습니다.</p>
      <ul className="wl-loss">
        <li>
          캐릭터 <b>{counts?.chars ?? '…'}</b>명, 그림 <b>{counts?.images ?? '…'}</b>장
        </li>
        <li>
          내 진행: 세이브 <b>{counts?.saves ?? '…'}</b>개 (재화, 보유 캐릭터, 천장), 뽑기 기록 <b>{counts?.pulls ?? '…'}</b>건
        </li>
      </ul>
      {world.status === 'ready' && <p className="small muted">남겨 두려면 먼저 월드 정보에서 백업을 내보내세요.</p>}
      {err && <p className="field-error">{err}</p>}
      <div className="wl-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()} disabled={busy}>
          취소
        </button>
        <button type="button" className="btn btn-danger-solid" onClick={confirm} disabled={busy}>
          {busy ? '지우는 중…' : '삭제'}
        </button>
      </div>
    </dialog>
  );
}
