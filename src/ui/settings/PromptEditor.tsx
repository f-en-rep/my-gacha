// 프롬프트 하나 고치기: 칸마다 순서대로. 고칠 수 있는 칸은 글 상자, 형식 칸은 잠금, 자료 칸은 실행 때 채워진다.
import { useMemo, useState } from 'react';
import { db, getSettings } from '../../db';
import { Icon } from '../Icon';
import { EmptyState } from '../common';
import { updateSettings, useLiveQuery } from '../hooks';
import { paths } from '../router';
import { PROMPT_TEMPLATES, cleanOverrides, type PromptId, type PromptSection, type PromptTemplate, type SectionOverrides } from '../../gen/prompts';
import { SAMPLE_CHAT } from '../../gen/prompts/sample';
import { SAMPLE_PREVIEW, previewMessages, type PreviewData } from '../../gen/prompts/preview';
import type { AppSettings } from '../../types';
import './prompts.css';

const MSG_LABEL: Record<PromptSection['msg'], string> = { system: '시스템 메시지', user: '사용자 메시지', history: '대화 기록' };

/** 미리 보기 자료: 지금 월드와 첫 캐릭터. 없으면 예시 */
async function loadPreviewData(): Promise<PreviewData> {
  const s = await getSettings();
  const world = s.activeWorldId ? await db.worlds.get(s.activeWorldId) : undefined;
  if (!world || world.status !== 'ready') return SAMPLE_PREVIEW;
  const cast = await db.characters.where('worldId').equals(world.id).sortBy('createdAt');
  if (!cast.length) return { ...SAMPLE_PREVIEW, world, sample: false };
  const chapters = await db.chapters.where('worldId').equals(world.id).toArray();
  const locations = await db.locations.where('worldId').equals(world.id).toArray();
  const save = s.activeSaveId ? await db.saves.get(s.activeSaveId) : undefined;
  const lead = cast[0]!;
  const lines = save ? await db.chatLines.where('[saveId+characterId]').equals([save.id, lead.id]).sortBy('id') : [];
  return { world, cast, chapters, locations, history: lines.length ? lines : SAMPLE_CHAT, playerName: save?.playerName, sample: false };
}

function initialDrafts(tpl: PromptTemplate, saved: SectionOverrides | undefined): SectionOverrides {
  const out: SectionOverrides = {};
  for (const s of tpl.sections) if (s.kind === 'edit') out[s.key] = saved?.[s.key]?.trim() ? saved[s.key]! : s.text ?? '';
  return out;
}

/** 이 프롬프트에서 모르는 {{변수}} (그대로 보낸다) */
function unknownVars(text: string, tpl: PromptTemplate): string[] {
  const known = new Set(tpl.vars.map((v) => v.name));
  const found = [...text.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)].map((m) => m[1]!).filter((k) => !known.has(k));
  return [...new Set(found)];
}

export function PromptEditor({ id }: { id: string }) {
  const tpl = PROMPT_TEMPLATES.find((t) => t.id === id);
  const settings = useLiveQuery<AppSettings>(() => getSettings(), []);
  if (!tpl) {
    return (
      <EmptyState title="없는 프롬프트">
        <a href={'#' + paths.prompts}>프롬프트 목록으로</a>
      </EmptyState>
    );
  }
  if (!settings) return <p className="muted">불러오는 중…</p>;
  return <Editor key={tpl.id} tpl={tpl} saved={cleanOverrides(tpl, settings.prompts?.[tpl.id])} />;
}

function Editor({ tpl, saved }: { tpl: PromptTemplate; saved: SectionOverrides | undefined }) {
  const [drafts, setDrafts] = useState(() => initialDrafts(tpl, saved));
  const [notice, setNotice] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const data = useLiveQuery(loadPreviewData, []);

  const current = cleanOverrides(tpl, drafts);
  const dirty = JSON.stringify(current ?? {}) !== JSON.stringify(saved ?? {});
  const preview = useMemo(() => previewMessages(tpl.id as PromptId, current, data ?? SAMPLE_PREVIEW), [tpl.id, JSON.stringify(current), data]);
  const traced = (key: string) =>
    preview.trace
      .filter((t) => t.key === key)
      .map((t) => t.text)
      .join('\n…\n');

  function set(key: string, v: string) {
    setDrafts((d) => ({ ...d, [key]: v }));
    setNotice('');
  }

  async function write(next: SectionOverrides | undefined) {
    await updateSettings((s) => {
      const { [tpl.id]: _old, ...rest } = s.prompts ?? {};
      const prompts = next ? { ...rest, [tpl.id]: next } : rest;
      const { prompts: _p, ...base } = s;
      return Object.keys(prompts).length ? { ...base, prompts } : base;
    });
  }

  async function save() {
    await write(current);
    setNotice('저장했어요. 다음 생성부터 적용돼요.');
  }

  async function resetAll() {
    if (saved && !confirm('이 프롬프트를 전부 기본값으로 되돌릴까요?')) return;
    setDrafts(initialDrafts(tpl, undefined));
    await write(undefined);
    setNotice('기본값으로 되돌렸어요.');
  }

  let lastMsg: PromptSection['msg'] | undefined;
  return (
    <div className="pe stack">
      <div className="pe-head">
        <a className="pe-back small" href={'#' + paths.prompts}>
          <Icon name="back" size={14} /> 프롬프트 목록
        </a>
        <div className="page-section-head">
          <h2>{tpl.title}</h2>
          {saved && <span className="pe-badge">수정됨</span>}
        </div>
        <p className="muted small">{tpl.description}</p>
      </div>

      <details className="pe-vars">
        <summary>쓸 수 있는 변수 {tpl.vars.length}개</summary>
        <p className="small muted">고칠 수 있는 칸 어디에나 넣을 수 있어요. 목록에 없는 {'{{이름}}'}은 그대로 보내요.</p>
        <dl>
          {tpl.vars.map((v) => (
            <div key={v.name}>
              <dt>
                <code>{`{{${v.name}}}`}</code>
              </dt>
              <dd>{v.desc}</dd>
            </div>
          ))}
        </dl>
      </details>

      <ol className="pe-sections">
        {tpl.sections.map((s) => {
          const head = s.msg !== lastMsg ? <li className="pe-msg" key={`msg-${s.msg}`}>{MSG_LABEL[s.msg]}</li> : null;
          lastMsg = s.msg;
          return [head, <SectionRow key={s.key} tpl={tpl} s={s} value={drafts[s.key] ?? ''} traced={traced(s.key)} onChange={(v) => set(s.key, v)} />];
        })}
      </ol>

      <div className="form-actions pe-actions">
        <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => void save()}>
          저장
        </button>
        <span className="muted small grow">{dirty ? '저장 안 됨' : notice}</span>
        <button type="button" className="btn btn-small" disabled={!saved && !current} onClick={() => void resetAll()}>
          전체 기본값으로
        </button>
      </div>

      <section className="pe-preview">
        <button type="button" className="btn btn-small" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)}>
          {showPreview ? '미리 보기 닫기' : '미리 보기'}
        </button>
        {showPreview && (
          <>
            <p className="small muted">
              {data && !data.sample
                ? `지금 월드 "${data.world.name}"${data.cast[0] && data.cast[0].worldId === data.world.id ? `와 첫 캐릭터 "${data.cast[0].name}"` : ''}로 만든 예시예요.`
                : '월드가 없어서 예시 데이터로 만들었어요.'}{' '}
              저장하지 않은 글도 반영돼요. 실제 생성 때는 상황에 따라 일부 칸이 빠지거나 바뀌어요.
            </p>
            {preview.messages.map((m, i) => (
              <div key={i} className="pe-message">
                <span className="pe-role">{m.role}</span>
                <pre>{m.content}</pre>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}

function SectionRow({ tpl, s, value, traced, onChange }: { tpl: PromptTemplate; s: PromptSection; value: string; traced: string; onChange: (v: string) => void }) {
  if (s.kind === 'lock') {
    return (
      <li className="pe-sec pe-lock">
        <div className="pe-sec-head">
          <strong>{s.label}</strong>
          <span className="pe-lock-note">형식이라 고칠 수 없어요</span>
        </div>
        {s.hint && <p className="field-hint">{s.hint}</p>}
        <pre>{traced || '(미리 보기 상황에서는 들어가지 않아요)'}</pre>
      </li>
    );
  }
  if (s.kind === 'data') {
    return (
      <li className="pe-sec pe-data">
        <div className="pe-sec-head">
          <strong>{s.label}</strong>
          <span className="pe-lock-note">실행 때 채워져요</span>
        </div>
        {s.hint && <p className="field-hint">{s.hint}</p>}
      </li>
    );
  }
  const def = s.text ?? '';
  const changed = value.trim() !== '' && value !== def;
  const unknown = unknownVars(value, tpl);
  const id = `pe-${tpl.id}-${s.key}`;
  return (
    <li className="pe-sec">
      <div className="field">
        <div className="pe-sec-head">
          <label htmlFor={id}>{s.label}</label>
          {changed && <span className="pe-badge">수정됨</span>}
          <button type="button" className="btn btn-small pe-reset" disabled={value === def} onClick={() => onChange(def)}>
            기본값으로
          </button>
        </div>
        <textarea id={id} rows={Math.min(12, Math.max(2, Math.ceil(value.length / 70) + value.split('\n').length - 1))} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
        {s.hint && <p className="field-hint">{s.hint}</p>}
        {!value.trim() && <p className="field-hint">비워 두면 기본값을 써요.</p>}
        {unknown.length > 0 && <p className="field-hint pe-warn">모르는 변수는 그대로 보내요: {unknown.map((k) => `{{${k}}}`).join(', ')}</p>}
      </div>
    </li>
  );
}
