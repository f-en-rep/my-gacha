// 준비된 월드의 정보, 자유 모드, 내보내기
import { useState } from 'react';
import { activateWorld, putSave, useBanners } from '../../game/store';
import { exportBackup, exportWorldPack } from '../../pack';
import { Toggle } from '../settings/fields';
import { useSettings } from '../hooks';
import { paths } from '../router';
import type { Rarity, Save, World } from '../../types';
import { useRunState } from './runner';
import { downloadBlob, errorText, formatDate, languageLabel, useCastCounts, worldName } from './shared';

const RARITIES: Rarity[] = [6, 5, 4, 3];

export function WorldInfo({ world, save, active }: { world: World; save?: Save; active: boolean }) {
  const run = useRunState(world.id);
  const counts = useCastCounts(world.id);
  const banners = useBanners(world.id);
  const [playErr, setPlayErr] = useState<string>();

  return (
    <div className="wi stack">
      {run.finished && active && (
        <div className="wi-ready" role="status">
          <span>
            <strong>준비 완료</strong>
            <small>캐릭터 {counts?.total ?? '…'}명과 상시 배너가 만들어졌습니다.</small>
          </span>
          <a className="btn btn-accent" href={'#' + paths.pull}>
            뽑기 하러 가기
          </a>
        </div>
      )}

      <header className="wz-head">
        <span className="kicker">{active ? 'NOW PLAYING' : 'WORLD'}</span>
        <h2>{worldName(world)}</h2>
        <p className="wi-meta">
          <span>{languageLabel(world.language)}</span>
          {world.author && <span>만든 사람 {world.author}</span>}
          {world.importedFrom && (
            <span>
              받은 월드 · {world.importedFrom.packName} ({formatDate(world.importedFrom.importedAt)})
            </span>
          )}
        </p>
      </header>

      {!active && (
        <div className="wi-play">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => activateWorld(world.id).catch((e) => setPlayErr(errorText(e)))}
          >
            이 월드로 플레이
          </button>
          {playErr && <p className="field-error">{playErr}</p>}
        </div>
      )}

      <section>
        <div className="page-section-head">
          <h2>캐스트</h2>
          <span className="mono muted">{counts ? `${counts.total}명 · 배너 ${banners?.length ?? 0}` : '—'}</span>
        </div>
        <div className="wi-cast">
          {RARITIES.map((r) => (
            <div key={r} className={`wi-cast-cell r${r}`}>
              <span className="wi-stars">{r}★</span>
              <b>{counts?.[r] ?? '—'}</b>
            </div>
          ))}
        </div>
        <p className="small muted wi-currency">
          뽑기 재화 <b>{world.currency.pull || '—'}</b> · 상점 재화 <b>{world.currency.shop || '—'}</b>
        </p>
      </section>

      <TextBlock title="세계관" text={world.description} />
      {world.scenario && <TextBlock title="시나리오" text={world.scenario} />}
      {world.directives && <TextBlock title="작가 지시문" text={world.directives} />}

      {active && save && (
        <section>
          <div className="page-section-head">
            <h2>내 진행</h2>
            <span className="mono muted">{save.name}</span>
          </div>
          <div className="wi-toggle">
            <Toggle
              label="자유 모드"
              hint="재화를 마음대로 채울 수 있습니다. 친구끼리 가볍게 놀 때."
              checked={save.freeMode}
              onChange={(v) => void putSave({ ...save, freeMode: v })}
            />
          </div>
        </section>
      )}

      <ExportSection world={world} />
    </div>
  );
}

function TextBlock({ title, text }: { title: string; text: string }) {
  const long = text.length > 280;
  const [open, setOpen] = useState(false);
  return (
    <section>
      <div className="page-section-head">
        <h2>{title}</h2>
      </div>
      <p className={long && !open ? 'wi-text clamp' : 'wi-text'}>{text || '—'}</p>
      {long && (
        <button type="button" className="wi-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? '접기' : '더 보기'}
        </button>
      )}
    </section>
  );
}

function ExportSection({ world }: { world: World }) {
  const settings = useSettings();
  const [busy, setBusy] = useState<'pack' | 'backup'>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  async function run(kind: 'pack' | 'backup') {
    setBusy(kind);
    setMsg(undefined);
    try {
      const { blob, filename } = kind === 'pack' ? await exportWorldPack(world.id, { includeStory: false }) : await exportBackup(world.id);
      downloadBlob(blob, filename);
      setMsg({ ok: true, text: `${filename} (${formatSize(blob.size)})` });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section>
      <div className="page-section-head">
        <h2>내보내기</h2>
      </div>
      <div className="wi-export">
        <div className="wi-export-item">
          <span className="wi-export-text">
            <strong>월드 팩</strong>
            <small>친구에게 보낼 .zip. 세계관, 캐릭터, 배너, 그림만 들어가고 내 진행과 API 키는 들어가지 않습니다.</small>
          </span>
          <label className="wi-check">
            <input type="checkbox" disabled checked={false} readOnly />
            <span>
              스토리 포함 <small>스토리는 3단계부터</small>
            </span>
          </label>
          <button type="button" className="btn" disabled={!!busy} onClick={() => run('pack')}>
            {busy === 'pack' ? '만드는 중…' : '월드 팩 내보내기'}
          </button>
        </div>
        <div className="wi-export-item">
          <span className="wi-export-text">
            <strong>백업</strong>
            <small>
              월드 + 내 진행(세이브, 뽑기 기록). 기기를 옮기거나 지워질 때를 대비해. API 키는 들어가지 않습니다.
              {settings.lastBackupAt && <> 마지막 백업: {formatDate(settings.lastBackupAt)}</>}
            </small>
          </span>
          <button type="button" className="btn" disabled={!!busy} onClick={() => run('backup')}>
            {busy === 'backup' ? '만드는 중…' : '백업 내보내기'}
          </button>
        </div>
      </div>
      {msg && (
        <p className={msg.ok ? 'wl-msg wl-msg-ok' : 'wl-msg wl-msg-fail'} role={msg.ok ? 'status' : 'alert'}>
          {msg.ok ? '내려받기: ' : ''}
          {msg.text}
        </p>
      )}
    </section>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
