// 캐릭터 직접 만들기·고치기 (캐릭터 패널 오른쪽 페이지)
import { useEffect, useId, useRef, useState } from 'react';
import { blankForm, characterFromForm, deleteCharacter, formOf, imageToAsset, RARITIES, saveCharacter, swapRarityTrait, validateCharacterForm, type CharacterForm } from '../../game/characters';
import { draftCharacter, type CharacterDraft } from '../../gen/world';
import { describeTextError } from '../../gen/text';
import type { Character, Id, Rarity, World } from '../../types';
import { EmptyState } from '../common';
import { navigate, paths } from '../router';
import { Portrait } from './Portrait';
import { useTextReady } from './textReady';
import './character-editor.css';

type PortraitEdit = { kind: 'keep' } | { kind: 'new'; blob: Blob } | { kind: 'remove' };

/** 여러 개 고르기 / 하나 고르기 칩 */
function ChipPick({ label, options, value, onChange, multi, error }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; multi?: boolean; error?: string }) {
  const toggle = (o: string) => {
    if (!multi) return onChange([o]);
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  };
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="chips ce-chips" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" className="chip" aria-pressed={value.includes(o)} onClick={() => toggle(o)}>
            {o}
          </button>
        ))}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

function TextField({ label, value, onChange, error, rows, hint, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; error?: string; rows?: number; hint?: string; placeholder?: string; mono?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {rows ? (
        <textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={mono ? 'ce-mono' : undefined} spellCheck={!mono} aria-invalid={!!error || undefined} />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" aria-invalid={!!error || undefined} />
      )}
      {hint && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

function PortraitPreview({ edit, orig, rarity }: { edit: PortraitEdit; orig?: Character; rarity: Rarity }) {
  const [url, setUrl] = useState<string>();
  const blob = edit.kind === 'new' ? edit.blob : undefined;
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  if (url) return <img className="portrait-img ce-portrait-img" src={url} alt="새 초상화 미리 보기" />;
  return <Portrait assetId={edit.kind === 'keep' ? orig?.portraitId : undefined} alt="초상화" className="portrait-img ce-portrait-img" rarity={rarity} />;
}

/** AI 시트로 빈 칸만 채운다. 채운 칸 이름도 돌려준다 */
function mergeDraft(f: CharacterForm, d: CharacterDraft): { form: CharacterForm; filled: string[] } {
  const n: CharacterForm = { ...f, tags: { ...f.tags } };
  const filled: string[] = [];
  const fill = (key: 'appearance' | 'imageTags' | 'personality' | 'background', v: string, label: string) => {
    if (!n[key].trim() && v) {
      n[key] = v;
      filled.push(label);
    }
  };
  if (!n.name.trim()) {
    n.name = d.name;
    filled.push('이름');
  }
  if (n.tags.role.length === 0) {
    n.tags.role = d.role;
    n.tags.position = d.position || n.tags.position;
    filled.push('역할·위치');
  }
  if (!n.tags.element) {
    n.tags.element = d.element;
    filled.push('속성');
  }
  fill('appearance', d.appearance, '외형');
  fill('imageTags', d.imageTags, '그림 태그');
  fill('personality', d.personality, '성격');
  fill('background', d.background, '배경');
  if (!n.quotes.some((q) => q.trim())) {
    n.quotes = d.quotes;
    filled.push('대사');
  }
  return { form: n, filled };
}

export function CharacterEditor({ world, cast, mode }: { world: World; cast: Character[]; mode: 'new' | { edit: Id } }) {
  const editId = mode === 'new' ? undefined : mode.edit;
  const orig = editId ? cast.find((c) => c.id === editId) : undefined;
  const text = useTextReady();

  const [form, setForm] = useState<CharacterForm>(() => (orig ? formOf(orig) : blankForm(world.tags)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [portrait, setPortrait] = useState<PortraitEdit>({ kind: 'keep' });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [brief, setBrief] = useState('');
  const [filling, setFilling] = useState(false);
  const [fillNote, setFillNote] = useState<string>();
  const fillCtrl = useRef<AbortController | null>(null);
  // AI가 답하는 동안 고친 내용도 지키도록 최신 폼을 기억해 둔다
  const formRef = useRef(form);
  formRef.current = form;

  // 고칠 캐릭터가 바뀌면(또는 처음 읽히면) 폼을 다시 채운다
  const initFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = editId ?? 'new';
    if (initFor.current === key) return;
    if (editId && !orig) return;
    setForm(orig ? formOf(orig) : blankForm(world.tags));
    setPortrait({ kind: 'keep' });
    setErrors({});
    setFailure(undefined);
    initFor.current = key;
  }, [editId, orig, world.tags]);

  useEffect(() => () => fillCtrl.current?.abort(), []);

  if (editId && !orig) {
    return (
      <EmptyState title="캐릭터를 찾을 수 없습니다" badge="NOT FOUND">
        <p>
          지워졌거나 다른 월드의 캐릭터입니다. <a href={'#' + paths.characters}>목록으로</a>
        </p>
      </EmptyState>
    );
  }

  const set = (patch: Partial<CharacterForm>) => setForm((f) => ({ ...f, ...patch }));
  const setTags = (patch: Partial<CharacterForm['tags']>) => setForm((f) => ({ ...f, tags: { ...f.tags, ...patch } }));
  const setRarity = (r: Rarity) => setForm((f) => ({ ...f, rarity: r, tags: { ...f.tags, trait: swapRarityTrait(f.tags.trait, world.tags, f.rarity, r) } }));
  const setQuote = (i: number, v: string) => setForm((f) => ({ ...f, quotes: f.quotes.map((q, j) => (j === i ? v : q)) }));
  const quoteError = Object.entries(errors).find(([k]) => k.startsWith('quotes'))?.[1];

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrors((e) => ({ ...e, portrait: '그림 파일을 골라 주세요.' }));
      return;
    }
    setErrors(({ portrait: _p, ...rest }) => rest);
    setPortrait({ kind: 'new', blob: file });
  };

  const onFill = async () => {
    if (filling) return;
    const ctrl = new AbortController();
    fillCtrl.current = ctrl;
    setFilling(true);
    setFillNote(undefined);
    setFailure(undefined);
    try {
      const d = await draftCharacter(world.id, { rarity: form.rarity, name: form.name, concept: brief, excludeId: editId, signal: ctrl.signal });
      const { form: next, filled } = mergeDraft(formRef.current, d);
      setForm(next);
      setFillNote(filled.length ? `채웠습니다: ${filled.join(', ')}` : '빈 칸이 없어서 바꾸지 않았습니다.');
    } catch (e) {
      if (!ctrl.signal.aborted) setFailure(describeTextError(e));
    } finally {
      if (fillCtrl.current === ctrl) fillCtrl.current = null;
      setFilling(false);
    }
  };

  const onSave = async () => {
    if (saving) return;
    setFailure(undefined);
    const r = validateCharacterForm(form, world.tags);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const c = characterFromForm(r.value, world.id, world.tags, orig);
      const asset = portrait.kind === 'new' ? await imageToAsset(world.id, portrait.blob) : portrait.kind === 'remove' ? null : undefined;
      await saveCharacter(c, asset);
      navigate(paths.character(c.id), { replace: true });
    } catch (e) {
      console.error(e);
      setFailure(e instanceof Error ? e.message : '저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!orig) return;
    if (!window.confirm(`${orig.name}을(를) 지울까요? 보유·호감도·대화·배너 픽업에서도 빠지고, 되돌릴 수 없습니다. (뽑기 기록은 남습니다)`)) return;
    try {
      await deleteCharacter(orig.id);
      navigate(paths.characters, { replace: true });
    } catch (e) {
      console.error(e);
      setFailure('지우지 못했습니다. 다시 시도해 주세요.');
    }
  };

  const hasErrors = Object.keys(errors).length > 0;
  const hasPortrait = portrait.kind === 'new' || (portrait.kind === 'keep' && !!orig?.portraitId);

  return (
    <form
      className="ce"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
      noValidate
    >
      <header className="ce-head">
        <span className="kicker">{orig ? 'EDIT OPERATOR' : 'NEW OPERATOR'}</span>
        <h2>{orig ? `${orig.name} 고치기` : '새 캐릭터 만들기'}</h2>
        <p className="small muted">{orig ? '바꾼 내용은 이 월드의 캐스트에 바로 반영됩니다.' : '만든 캐릭터는 바로 월드 캐스트에 들어가 뽑기에서 나옵니다.'}</p>
        {orig?.origin && (
          <p className="ce-origin small">
            카드에서 가져옴 · {orig.origin.fileName}
            {orig.origin.creator && ` · 만든 이 ${orig.origin.creator}`}
          </p>
        )}
      </header>

      <section className="ce-box" aria-labelledby="ce-fill-h">
        <h3 id="ce-fill-h" className="ce-h">
          AI로 채우기
        </h3>
        <p className="small muted">이름과 한 줄 설명을 보고 빈 칸만 채웁니다. 이미 쓴 칸은 건드리지 않습니다.</p>
        <TextField label="한 줄 설명 (선택)" value={brief} onChange={setBrief} placeholder="예: 늘 졸린 얼굴의 천재 저격수" />
        <div className="ce-row">
          {filling ? (
            <>
              <span className="pill pill-run">채우는 중</span>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => fillCtrl.current?.abort()}>
                취소
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-accent btn-small" disabled={!text?.ready} onClick={() => void onFill()}>
              AI로 채우기
            </button>
          )}
          {fillNote && <span className="small ce-ok">{fillNote}</span>}
        </div>
        {text && !text.ready && (
          <p className="small muted">
            글 연결이 필요합니다. <a href={'#' + (text.hasProfile ? paths.routing : paths.settings)}>{text.hasProfile ? '구조화 작업에 연결 지정하기' : '글 연결 추가하기'}</a>
          </p>
        )}
      </section>

      <section className="ce-section">
        <TextField label="이름" value={form.name} onChange={(name) => set({ name })} error={errors.name} placeholder="캐릭터 이름" />
        <div className="field">
          <span className="label">희귀도</span>
          <div className="chips ce-chips" role="group" aria-label="희귀도">
            {RARITIES.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={form.rarity === r} onClick={() => setRarity(r)}>
                {r}★
              </button>
            ))}
          </div>
          <p className="field-hint">희귀도를 바꾸면 능력치와 시트 종류(5★ 이상은 자세한 시트)가 다시 정해집니다.</p>
          {errors.rarity && <p className="field-error">{errors.rarity}</p>}
        </div>
      </section>

      <section className="ce-section" aria-labelledby="ce-tags-h">
        <h3 id="ce-tags-h" className="ce-h">
          태그
        </h3>
        <ChipPick label="위치" options={world.tags.position} value={[form.tags.position]} onChange={([position]) => setTags({ position: position ?? '' })} error={errors['tags.position']} />
        <ChipPick label="역할 (여러 개)" options={world.tags.role} value={form.tags.role} onChange={(role) => setTags({ role })} multi error={errors['tags.role']} />
        <ChipPick label="속성" options={world.tags.element} value={[form.tags.element]} onChange={([element]) => setTags({ element: element ?? '' })} error={errors['tags.element']} />
        <ChipPick label="특징 (여러 개)" options={world.tags.trait} value={form.tags.trait} onChange={(trait) => setTags({ trait })} multi error={errors['tags.trait']} />
      </section>

      <section className="ce-section" aria-labelledby="ce-portrait-h">
        <h3 id="ce-portrait-h" className="ce-h">
          초상화
        </h3>
        <div className="ce-portrait">
          <div className="ce-portrait-frame">
            <PortraitPreview edit={portrait} orig={orig} rarity={form.rarity} />
          </div>
          <div className="ce-portrait-actions">
            <label className="btn btn-small">
              그림 올리기
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            {hasPortrait && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPortrait({ kind: 'remove' })}>
                그림 지우기
              </button>
            )}
            {portrait.kind !== 'keep' && orig && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setPortrait({ kind: 'keep' })}>
                되돌리기
              </button>
            )}
            <p className="small muted">올린 그림은 WebP로 줄여 저장합니다. 지우면 희귀도 카드가 보입니다.</p>
            {errors.portrait && <p className="field-error">{errors.portrait}</p>}
          </div>
        </div>
      </section>

      <section className="ce-section" aria-labelledby="ce-profile-h">
        <h3 id="ce-profile-h" className="ce-h">
          프로필
        </h3>
        <TextField label="외형" rows={4} value={form.appearance} onChange={(appearance) => set({ appearance })} error={errors.appearance} />
        <TextField label="성격" rows={3} value={form.personality} onChange={(personality) => set({ personality })} error={errors.personality} />
        <TextField label="배경" rows={6} value={form.background} onChange={(background) => set({ background })} error={errors.background} />
        <div className="field">
          <span className="label">대사</span>
          <ul className="ce-quotes">
            {form.quotes.map((q, i) => (
              <li key={i}>
                <input value={q} onChange={(e) => setQuote(i, e.target.value)} aria-label={`대사 ${i + 1}`} autoComplete="off" />
                <button type="button" className="btn btn-ghost btn-small" aria-label={`대사 ${i + 1} 빼기`} onClick={() => set({ quotes: form.quotes.filter((_, j) => j !== i) })}>
                  빼기
                </button>
              </li>
            ))}
          </ul>
          <div>
            <button type="button" className="btn btn-small" onClick={() => set({ quotes: [...form.quotes, ''] })}>
              대사 추가
            </button>
          </div>
          {quoteError && <p className="field-error">{quoteError}</p>}
        </div>
      </section>

      <section className="ce-section" aria-labelledby="ce-image-h">
        <h3 id="ce-image-h" className="ce-h">
          그림 태그
        </h3>
        <TextField
          label="캐릭터 태그 (영어)"
          rows={3}
          mono
          value={form.imageTags}
          onChange={(imageTags) => set({ imageTags })}
          error={errors.imageTags}
          hint="외형만 적습니다. 예: 1girl, silver hair, blue eyes, black cloak"
        />
        <TextField label="캐릭터 네거티브 (선택)" rows={2} mono value={form.imageNegative} onChange={(imageNegative) => set({ imageNegative })} error={errors.imageNegative} />
      </section>

      {hasErrors && (
        <p className="form-errors" role="alert">
          입력을 확인해 주세요. 빨간 글씨로 표시한 칸이 있습니다.
        </p>
      )}
      {failure && (
        <p className="form-errors" role="alert">
          {failure}
        </p>
      )}

      <div className="form-actions ce-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || filling}>
          {orig ? '저장' : '캐릭터 만들기'}
        </button>
        <a className="btn btn-ghost" href={'#' + (orig ? paths.character(orig.id) : paths.characters)}>
          취소
        </a>
        {orig && (
          <button type="button" className="btn btn-danger ce-delete" onClick={() => void onDelete()}>
            삭제
          </button>
        )}
      </div>
    </form>
  );
}
