// Google Vertex AI 연결 칸: 인증 방식, API 키 또는 서비스 계정 JSON, 프로젝트·리전
import { useId, useMemo, useRef, useState } from 'react';
import type { TextProfile, VertexOptions } from '../../types';
import { VERTEX_DEFAULT_LOCATION, VERTEX_LOCATIONS, summarizeServiceAccount } from '../../gen/text';
import { Field, SecretInput } from './fields';

const AUTH_OPTIONS: { value: VertexOptions['auth']; label: string }[] = [
  { value: 'apiKey', label: 'API 키' },
  { value: 'serviceAccount', label: '서비스 계정 JSON' },
];

/** 서비스 계정 키 파일은 몇 KB라서 이보다 크면 잘못 고른 파일 */
const MAX_JSON_BYTES = 64 * 1024;

export function VertexFields({ p, set }: { p: TextProfile; set: (patch: Partial<TextProfile>) => void }) {
  const opts: VertexOptions = p.vertex ?? { auth: 'apiKey' };
  const setOpts = (patch: Partial<VertexOptions>) => set({ vertex: { ...opts, ...patch } });

  return (
    <>
      <div className="field field-wide">
        <span className="label">인증 방식</span>
        <div className="seg" role="radiogroup" aria-label="Vertex AI 인증 방식">
          {AUTH_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={opts.auth === o.value}
              className="seg-item"
              onClick={() => {
                // 방식을 바꾸면 다른 방식의 키를 남기지 않는다
                if (opts.auth !== o.value) set({ vertex: { ...opts, auth: o.value }, apiKey: '' });
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="field-hint">
          {opts.auth === 'apiKey'
            ? 'Vertex AI express mode에서 만든 API 키. 프로젝트·리전 설정 없이 global 엔드포인트를 씁니다.'
            : 'Google Cloud 서비스 계정의 JSON 키 파일. 이 브라우저에서 직접 액세스 토큰을 받아 씁니다.'}
        </p>
      </div>

      {opts.auth === 'apiKey' ? (
        <Field label="API 키" hint="Gemini API(AI Studio) 키라면 서비스를 'Google Gemini'로 고르세요.">
          {(id) => <SecretInput id={id} value={p.apiKey} onChange={(v) => set({ apiKey: v })} placeholder="Vertex AI API 키" />}
        </Field>
      ) : (
        <ServiceAccountFields p={p} opts={opts} set={set} setOpts={setOpts} />
      )}
    </>
  );
}

function ServiceAccountFields({
  p,
  opts,
  set,
  setOpts,
}: {
  p: TextProfile;
  opts: VertexOptions;
  set: (patch: Partial<TextProfile>) => void;
  setOpts: (patch: Partial<VertexOptions>) => void;
}) {
  const summary = useMemo(() => summarizeServiceAccount(p.apiKey), [p.apiKey]);
  const [fileMsg, setFileMsg] = useState('');
  const jsonId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const regionsId = useId();
  const hasKey = p.apiKey.trim() !== '';
  const loaded = summary.ok;

  async function openFile(file: File | undefined) {
    setFileMsg('');
    if (!file) return;
    if (file.size > MAX_JSON_BYTES) {
      setFileMsg('파일이 너무 커요. Google Cloud에서 받은 서비스 계정 .json 키 파일을 골라 주세요.');
      return;
    }
    try {
      set({ apiKey: (await file.text()).trim() });
    } catch {
      setFileMsg('파일을 읽지 못했어요.');
    }
  }

  return (
    <>
      <div className="field field-wide">
        {loaded ? <span className="label">서비스 계정 JSON 키</span> : <label htmlFor={jsonId}>서비스 계정 JSON 키</label>}
        {loaded ? (
          // 키를 넣은 뒤에는 내용(개인 키)을 다시 보여 주지 않고 요약만 보여 준다
          <div className="input-group" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
              <strong>{summary.clientEmail}</strong>
              <div className="muted small">프로젝트: {summary.projectId ?? '(JSON에 없음 — 아래에 입력)'}</div>
            </div>
            <button type="button" className="btn btn-inline" onClick={() => set({ apiKey: '' })}>
              다른 키 넣기
            </button>
          </div>
        ) : (
          <textarea
            id={jsonId}
            value={p.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder={'{\n  "type": "service_account",\n  "project_id": "…",\n  "client_email": "…",\n  "private_key": "…"\n}'}
            rows={6}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            style={{ padding: '10px 12px', minHeight: 132, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5, resize: 'vertical' }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-inline" onClick={() => fileRef.current?.click()}>
            JSON 파일 열기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void openFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <span className="field-hint">붙여 넣거나 파일로 열면 됩니다. 저장 후에는 개인 키를 화면에 보여 주지 않아요.</span>
        </div>
        {hasKey && !summary.ok && <p className="field-error">{summary.error}</p>}
        {fileMsg && <p className="field-error">{fileMsg}</p>}
        <p className="field-hint">
          키는 이 브라우저에만 저장됩니다. 이 게임 전용 서비스 계정을 따로 만들고 <strong>Vertex AI User</strong>(roles/aiplatform.user) 역할만 주는 것을 권장해요.
        </p>
      </div>

      <Field label="프로젝트 ID (선택)" hint="비우면 JSON의 project_id를 씁니다.">
        {(id) => (
          <input
            id={id}
            value={opts.projectId ?? ''}
            onChange={(e) => setOpts({ projectId: e.target.value || undefined })}
            placeholder={summary.ok && summary.projectId ? summary.projectId : 'my-project-id'}
            autoCapitalize="off"
            spellCheck={false}
          />
        )}
      </Field>
      <Field label="리전" hint="모르면 global. 예: us-central1, asia-northeast3">
        {(id) => (
          <>
            <input
              id={id}
              value={opts.location ?? ''}
              onChange={(e) => setOpts({ location: e.target.value || undefined })}
              list={regionsId}
              placeholder={VERTEX_DEFAULT_LOCATION}
              autoCapitalize="off"
              spellCheck={false}
            />
            <datalist id={regionsId}>
              {VERTEX_LOCATIONS.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </>
        )}
      </Field>
    </>
  );
}
