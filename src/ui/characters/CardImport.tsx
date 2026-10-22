// 캐릭터 카드 가져오기 (캐릭터 패널 오른쪽 페이지). 여러 파일을 한 번에 고를 수 있다
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CARD_RARITY, importCard, type CardImportResult } from '../../game/cardImport';
import { RARITIES } from '../../game/characters';
import { CardError, readCardFile, type ParsedCard } from '../../import/card';
import type { Rarity, Save, World } from '../../types';
import { Toggle } from '../settings/fields';
import { navigate, paths } from '../router';
import { useTextReady } from './textReady';
import './character-editor.css';

interface Item {
  key: string;
  fileName: string;
  card?: ParsedCard;
  /** 읽기·가져오기 실패 */
  error?: string;
  state: 'ready' | 'running' | 'done' | 'failed';
  result?: CardImportResult;
}

const SPEC_LABEL: Record<string, string> = { chara_card_v1: 'V1', chara_card_v2: 'V2', chara_card_v3: 'V3' };

function Thumb({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return <span className="ci-thumb">{url ? <img src={url} alt="" /> : <span className="ci-thumb-empty">그림 없음</span>}</span>;
}

let seq = 0;

export function CardImport({ world, save }: { world: World; save?: Save }) {
  const text = useTextReady();
  const [items, setItems] = useState<Item[]>([]);
  const [aiChoice, setAiChoice] = useState<boolean>();
  const [rarityChoice, setRarityChoice] = useState<Rarity | 'auto'>();
  const [own, setOwn] = useState(false);
  const [running, setRunning] = useState(false);
  const [reading, setReading] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const aiReady = !!text?.ready;
  const ai = aiReady && (aiChoice ?? true);
  const rarity: Rarity | 'auto' = rarityChoice === undefined ? (ai ? 'auto' : DEFAULT_CARD_RARITY) : rarityChoice === 'auto' && !ai ? DEFAULT_CARD_RARITY : rarityChoice;

  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setReading(true);
    const read: Item[] = [];
    for (const f of Array.from(files)) {
      const key = `card-${++seq}`;
      try {
        read.push({ key, fileName: f.name, card: await readCardFile(f), state: 'ready' });
      } catch (e) {
        read.push({ key, fileName: f.name, error: e instanceof CardError ? e.message : '파일을 읽을 수 없습니다.', state: 'failed' });
      }
    }
    setItems((list) => [...list.filter((it) => it.state !== 'done'), ...read]);
    setReading(false);
  };

  const pending = items.filter((it) => it.card && it.state === 'ready');

  const onImport = async () => {
    if (running || !pending.length) return;
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    try {
      for (const it of pending) {
        if (c.signal.aborted) break;
        patch(it.key, { state: 'running', error: undefined });
        try {
          const result = await importCard(world.id, it.card!, it.fileName, {
            ai,
            rarity,
            ownSaveId: own ? save?.id : undefined,
            playerName: save?.playerName,
            signal: c.signal,
          });
          patch(it.key, { state: 'done', result });
        } catch (e) {
          if (c.signal.aborted) {
            patch(it.key, { state: 'ready' });
            break;
          }
          console.error(e);
          patch(it.key, { state: 'failed', error: e instanceof Error ? e.message : '가져오지 못했습니다.' });
        }
      }
    } finally {
      if (ctrl.current === c) ctrl.current = null;
      setRunning(false);
    }
  };

  const done = items.filter((it) => it.state === 'done');

  return (
    <div className="ce ci">
      <header className="ce-head">
        <span className="kicker">IMPORT CARDS</span>
        <h2>캐릭터 카드 가져오기</h2>
        <p className="small muted">SillyTavern·RisuAI 캐릭터 카드(PNG, JSON, charx)를 이 월드의 캐스트로 들여옵니다. 카드 그림은 초상화로 씁니다.</p>
      </header>

      <section className="ce-section">
        <label className="btn ci-pick">
          {reading ? '읽는 중…' : '카드 파일 고르기'}
          <input
            type="file"
            multiple
            accept=".png,.json,.charx,image/png,application/json"
            className="sr-only"
            disabled={running || reading}
            onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <p className="field-hint">여러 파일을 한 번에 고를 수 있습니다. 카드 안의 HTML·스크립트는 글만 남기고 버립니다.</p>

        {items.length > 0 && (
          <ul className="ci-list" aria-label="고른 카드">
            {items.map((it) => (
              <li key={it.key} className="ci-item" data-state={it.state}>
                <Thumb blob={it.card?.image} />
                <span className="ci-main">
                  <strong>{it.card?.name ?? it.fileName}</strong>
                  <span className="small muted mono">
                    {it.fileName}
                    {it.card && ` · ${SPEC_LABEL[it.card.spec] ?? it.card.spec}`}
                    {it.card?.creator && ` · ${it.card.creator}`}
                  </span>
                  {it.error && <span className="field-error">{it.error}</span>}
                  {it.result?.aiError && <span className="small ci-warn">AI 정리에 실패해 카드 글 그대로 가져왔습니다: {it.result.aiError}</span>}
                </span>
                <span className="ci-side">
                  {it.state === 'running' && <span className="pill pill-run">가져오는 중</span>}
                  {it.state === 'done' && it.result && (
                    <a className="btn btn-small" href={'#' + paths.character(it.result.characterId)}>
                      보기
                    </a>
                  )}
                  {it.state !== 'running' && it.state !== 'done' && (
                    <button type="button" className="btn btn-ghost btn-small" disabled={running} onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))}>
                      빼기
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ce-section" aria-labelledby="ci-opt-h">
        <h3 id="ci-opt-h" className="ce-h">
          가져오기 설정
        </h3>
        <Toggle
          checked={ai}
          onChange={(v) => setAiChoice(v)}
          label="AI로 정리"
          hint={
            aiReady
              ? '월드 언어로 외형·성격·배경·대사를 정리하고, 태그·그림 태그·희귀도를 정합니다.'
              : '글 연결이 없어서 카드 글을 그대로 옮깁니다. 그림 태그는 비워 둡니다.'
          }
        />
        {text && !aiReady && (
          <p className="small muted">
            <a href={'#' + (text.hasProfile ? paths.routing : paths.settings)}>{text.hasProfile ? '구조화 작업에 글 연결 지정하기' : '글 연결 추가하기'}</a>
          </p>
        )}
        <div className="field">
          <span className="label">희귀도</span>
          <div className="chips ce-chips" role="group" aria-label="희귀도">
            {ai && (
              <button type="button" className="chip" aria-pressed={rarity === 'auto'} onClick={() => setRarityChoice('auto')}>
                AI 추천
              </button>
            )}
            {RARITIES.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={rarity === r} onClick={() => setRarityChoice(r)}>
                {r}★
              </button>
            ))}
          </div>
          <p className="field-hint">고른 카드 모두에 같은 희귀도를 줍니다. 나중에 캐릭터마다 고칠 수 있습니다.</p>
        </div>
        {save && <Toggle checked={own} onChange={setOwn} label="바로 보유" hint="뽑지 않아도 보유한 캐릭터로 넣습니다 (돌파 0). 끄면 뽑기에서 만나야 합니다." />}
      </section>

      <div className="form-actions ce-actions">
        {running ? (
          <button type="button" className="btn btn-ghost" onClick={() => ctrl.current?.abort()}>
            멈추기
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={!pending.length} onClick={() => void onImport()}>
            {pending.length ? `${pending.length}명 가져오기` : '가져오기'}
          </button>
        )}
        <a className="btn btn-ghost" href={'#' + paths.characters}>
          {done.length ? '닫기' : '취소'}
        </a>
        {done.length > 0 && !running && (
          <button type="button" className="btn btn-ghost ce-delete" onClick={() => navigate(paths.character(done[done.length - 1]!.result!.characterId))}>
            마지막 캐릭터 보기
          </button>
        )}
      </div>
      {done.length > 0 && <p className="small ce-ok">{done.length}명을 캐스트에 넣었습니다. 뽑기와 배너 픽업에 바로 나옵니다.</p>}
    </div>
  );
}
