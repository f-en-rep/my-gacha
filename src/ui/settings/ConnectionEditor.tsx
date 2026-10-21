import { useEffect, useMemo, useState } from 'react';
import { db } from '../../db';
import type { ConnectionProfile, ImageProfile, TextProfile } from '../../types';
import { listModels } from '../../gen/text';
import { PageHeader, TestBadge } from '../common';
import { Icon } from '../Icon';
import { navigate, paths } from '../router';
import { updateSettings } from '../hooks';
import {
  IMAGE_PROVIDERS,
  MIN_INTERVAL_FLOOR,
  NOVELAI_MODELS,
  SIZE_PRESETS,
  TEXT_PROVIDERS,
  newImageProfile,
  newTextProfile,
  runConnectionTest,
  validateProfile,
  type TestOutcome,
} from '../connections';
import { Field, NumberInput, SecretInput, Toggle } from './fields';

type Load = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; profile: ConnectionProfile; isNew: boolean };

export function ConnectionEditor({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    if (id === 'new-text') setLoad({ status: 'ready', profile: newTextProfile(), isNew: true });
    else if (id === 'new-image') setLoad({ status: 'ready', profile: newImageProfile(), isNew: true });
    else
      void db.profiles.get(id).then((p) => {
        if (alive) setLoad(p ? { status: 'ready', profile: p, isNew: false } : { status: 'missing' });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (load.status === 'loading') return <p className="muted pad">불러오는 중…</p>;
  if (load.status === 'missing')
    return (
      <div className="card">
        <PageHeader title="연결을 찾을 수 없어요" />
        <p className="muted">삭제되었거나 다른 기기의 주소일 수 있어요.</p>
      </div>
    );
  return <EditorForm initial={load.profile} isNew={load.isNew} />;
}

function EditorForm({ initial, isNew }: { initial: ConnectionProfile; isNew: boolean }) {
  const [draft, setDraft] = useState<ConnectionProfile>(initial);
  const [saved, setSaved] = useState<ConnectionProfile>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [test, setTest] = useState<TestOutcome>();
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');

  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<TextProfile> | Partial<ImageProfile>) => setDraft((d) => ({ ...d, ...patch }) as ConnectionProfile);

  async function save() {
    const errs = validateProfile(draft);
    setErrors(errs);
    if (errs.length) return;
    const clean: ConnectionProfile = { ...draft, label: draft.label.trim(), model: draft.model.trim(), baseUrl: draft.baseUrl?.trim() || undefined };
    await db.profiles.put(clean);
    // 작업별 연결이 비어 있으면 처음 저장한 연결로 채운다
    const slot = clean.type === 'text' ? 'structured' : 'image';
    await updateSettings((s) => (s.routing[slot] ? s : { ...s, routing: { ...s.routing, [slot]: clean.id } }));
    setSaved(clean);
    setDraft(clean);
    setNotice('저장됨');
    if (isNew) navigate(paths.connection(clean.id), { replace: true });
  }

  async function remove() {
    if (!confirm(`"${saved.label}" 연결을 지울까요?`)) return;
    await db.profiles.delete(saved.id);
    await updateSettings((s) => {
      const r = { ...s.routing };
      for (const k of ['structured', 'prose', 'image'] as const) if (r[k] === saved.id) delete r[k];
      return { ...s, routing: r };
    });
    navigate(paths.settings, { replace: true });
  }

  async function runTest() {
    setTesting(true);
    setTest(undefined);
    setTest(await runConnectionTest(draft));
    setTesting(false);
  }

  const title = isNew ? (draft.type === 'text' ? '새 글 연결' : '새 그림 연결') : saved.label || '연결 편집';

  return (
    <form
      className="card editor"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PageHeader title={title} kicker={draft.type === 'text' ? 'TEXT CONNECTION' : 'IMAGE CONNECTION'} />

      <div className="form-grid">
        {draft.type === 'text' ? <TextFields p={draft} set={set} /> : <ImageFields p={draft} set={set} />}
      </div>

      <Toggle
        checked={draft.useRelay}
        onChange={(v) => set({ useRelay: v })}
        label="중계기 사용"
        hint="브라우저에서 직접 호출이 막힌 서비스일 때 켭니다. 연결 진단에서 확인할 수 있어요."
      />

      <p className="key-note">
        <Icon name="eyeOff" size={18} /> 키는 이 브라우저에만 저장되고, 월드 팩·백업에는 들어가지 않습니다.
      </p>

      {errors.length > 0 && (
        <ul className="form-errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className={`test-box ${test ? 'test-' + test.state : ''}`} aria-live="polite">
        <div className="test-head">
          <button type="button" className="btn" onClick={() => void runTest()} disabled={testing}>
            연결 테스트
          </button>
          <TestBadge outcome={test} running={testing} />
        </div>
        {test && <p className="test-msg">{test.message}</p>}
        {!test && !testing && <p className="muted small">지금 입력한 값으로 확인합니다.{draft.type === 'image' && ' 그림은 그리지 않습니다.'}</p>}
      </div>

      <div className="form-actions">
        {!isNew && (
          <button type="button" className="btn btn-danger" onClick={() => void remove()}>
            삭제
          </button>
        )}
        <span className="muted small grow">{notice && !dirty ? notice : dirty ? '저장 안 됨' : ''}</span>
        <button type="submit" className="btn btn-primary" disabled={!dirty}>
          저장
        </button>
      </div>
    </form>
  );
}

function TextFields({ p, set }: { p: TextProfile; set: (patch: Partial<TextProfile>) => void }) {
  const [models, setModels] = useState<string[]>();
  const [modelMsg, setModelMsg] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const listId = useMemo(() => 'models-' + p.id, [p.id]);
  const provider = TEXT_PROVIDERS.find((x) => x.value === p.provider);
  const needsBase = p.provider === 'openai-compatible';

  async function fetchModels() {
    setLoadingModels(true);
    setModelMsg('');
    try {
      const list = await listModels(p);
      setModels(list);
      setModelMsg(list.length ? `${list.length}개. 입력하면 걸러집니다.` : '목록을 받지 못했습니다. 직접 입력하세요.');
    } catch (e) {
      setModelMsg('목록을 받지 못했습니다: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoadingModels(false);
    }
  }

  return (
    <>
      <Field label="서비스">
        {(id) => (
          <select id={id} value={p.provider} onChange={(e) => set({ provider: e.target.value as TextProfile['provider'] })}>
            {TEXT_PROVIDERS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="이름">{(id) => <input id={id} value={p.label} onChange={(e) => set({ label: e.target.value })} placeholder={`예: ${provider?.label ?? ''} 메인`} />}</Field>
      <Field label="API 키">
        {(id) => <SecretInput id={id} value={p.apiKey} onChange={(v) => set({ apiKey: v })} placeholder={needsBase ? '필요 없으면 비워 두세요' : 'sk-…'} />}
      </Field>
      <Field label={needsBase ? 'Base URL' : 'Base URL (선택)'} hint={needsBase ? '예: https://example.com/v1' : '비우면 기본 주소'}>
        {(id) => (
          <input id={id} type="url" inputMode="url" value={p.baseUrl ?? ''} onChange={(e) => set({ baseUrl: e.target.value })} placeholder={needsBase ? 'https://…/v1' : '기본 주소'} autoCapitalize="off" spellCheck={false} />
        )}
      </Field>
      <Field label="모델" hint={modelMsg || provider?.modelHint} wide>
        {(id) => (
          <div className="input-group">
            <input id={id} value={p.model} onChange={(e) => set({ model: e.target.value })} list={listId} placeholder={provider?.modelHint} autoCapitalize="off" spellCheck={false} />
            <button type="button" className="btn btn-inline" onClick={() => void fetchModels()} disabled={loadingModels}>
              {loadingModels ? '불러오는 중…' : '목록 불러오기'}
            </button>
            <datalist id={listId}>
              {models?.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        )}
      </Field>
      <Field label="최대 출력 토큰" hint="추론 모델은 8000 이상">
        {(id) => <NumberInput id={id} value={p.maxTokens} onChange={(v) => set({ maxTokens: v })} min={1} step={256} placeholder="8192" />}
      </Field>
      <Field label="온도" hint="보통 0.7 ~ 1.0">
        {(id) => <NumberInput id={id} value={p.temperature} onChange={(v) => set({ temperature: v })} min={0} max={2} step={0.05} placeholder="0.9" />}
      </Field>
    </>
  );
}

function ImageFields({ p, set }: { p: ImageProfile; set: (patch: Partial<ImageProfile>) => void }) {
  const isNai = p.provider === 'novelai';
  const naiKnown = NOVELAI_MODELS.some((m) => m.value === p.model);
  const sizeKey = SIZE_PRESETS.find((s) => s.width === p.width && s.height === p.height)?.key;

  return (
    <>
      <Field label="서비스">
        {(id) => (
          <select
            id={id}
            value={p.provider}
            onChange={(e) => {
              const provider = e.target.value as ImageProfile['provider'];
              set({ provider, model: provider === 'novelai' ? 'nai-diffusion-4-5-full' : '' });
            }}
          >
            {IMAGE_PROVIDERS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="이름">{(id) => <input id={id} value={p.label} onChange={(e) => set({ label: e.target.value })} placeholder={isNai ? '예: NovelAI 초상화' : '예: PixAI'} />}</Field>
      <Field label="API 키" hint={isNai ? 'Account Settings → Persistent API Token' : 'PixAI 설정 → API'}>
        {(id) => <SecretInput id={id} value={p.apiKey} onChange={(v) => set({ apiKey: v })} placeholder={isNai ? 'pst-…' : 'API 키'} />}
      </Field>
      <Field label="모델" hint={isNai ? undefined : 'PixAI 모델 id'}>
        {(id) =>
          isNai ? (
            <select id={id} value={naiKnown ? p.model : '__custom'} onChange={(e) => set({ model: e.target.value === '__custom' ? '' : e.target.value })}>
              {NOVELAI_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
              <option value="__custom">직접 입력…</option>
            </select>
          ) : (
            <input id={id} value={p.model} onChange={(e) => set({ model: e.target.value })} placeholder="모델 id" autoCapitalize="off" spellCheck={false} />
          )
        }
      </Field>
      {isNai && !naiKnown && <Field label="모델 이름 (직접 입력)">{(id) => <input id={id} value={p.model} onChange={(e) => set({ model: e.target.value })} placeholder="nai-diffusion-…" autoCapitalize="off" spellCheck={false} />}</Field>}
      <div className="field field-wide">
        <span className="label">기본 그림 크기</span>
        <div className="seg" role="radiogroup" aria-label="기본 그림 크기">
          {SIZE_PRESETS.map((s) => (
            <button key={s.key} type="button" role="radio" aria-checked={sizeKey === s.key} className="seg-item" onClick={() => set({ width: s.width, height: s.height })}>
              <span className={`seg-shape shape-${s.key}`} aria-hidden="true" />
              {s.label}
            </button>
          ))}
        </div>
        {!sizeKey && (
          <p className="field-hint">
            지금 값: {p.width}×{p.height}
          </p>
        )}
      </div>
      <Field wide label="요청 간격 (초)" hint={<>연달아 요청하면 NovelAI 계정이 제재될 수 있어 간격을 둡니다. 최소 {MIN_INTERVAL_FLOOR / 1000}초.</>}>
        {(id) => (
          <NumberInput
            id={id}
            value={p.minIntervalMs / 1000}
            onChange={(v) => set({ minIntervalMs: v === undefined ? NaN : Math.round(v * 1000) })}
            min={MIN_INTERVAL_FLOOR / 1000}
            step={1}
            placeholder="10"
          />
        )}
      </Field>
    </>
  );
}
