// 배너 만들기·고치기 (뽑기 패널 오른쪽 페이지)
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { db } from '../../db';
import { newId, now } from '../../core/id';
import { isPaintingBanner, paintBannerArt } from '../../game/bannerArt';
import { usePaintAvailable } from '../../game/portraits';
import { generateBannerMeta, generateCharacters } from '../../gen/world';
import { describeTextError } from '../../gen/text';
import type { Banner, BannerKind, Character, Id, Rarity, World } from '../../types';
import { EmptyState } from '../common';
import { useProfiles, useSettings } from '../hooks';
import { Field } from '../settings/fields';
import { navigate, paths } from '../router';
import { BannerArt, Portrait, Stars } from './art';
import './banner-editor.css';

const DAY = 86_400_000;
const LENGTHS = [7, 14, 21] as const;
type Length = (typeof LENGTHS)[number];

interface Draft {
  kind: BannerKind;
  name: string;
  description: string;
  startMode: 'now' | 'date';
  startDate: string;
  endMode: 'days' | 'date';
  days: Length;
  endDate: string;
  featured6: Id[];
  featured5: Id[];
}

/** 기기 시간대 YYYY-MM-DD */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** YYYY-MM-DD → 그날 0시 (기기 시간대) */
function dayStart(s: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function dotted(d: Date): string {
  return ymd(d).replace(/-/g, '.');
}

function emptyDraft(): Draft {
  const today = new Date();
  return {
    kind: 'limited',
    name: '',
    description: '',
    startMode: 'now',
    startDate: ymd(today),
    endMode: 'days',
    days: 14,
    endDate: ymd(new Date(today.getTime() + 14 * DAY)),
    featured6: [],
    featured5: [],
  };
}

function draftFrom(b: Banner): Draft {
  const d = emptyDraft();
  d.kind = b.kind;
  d.name = b.name;
  d.description = b.description ?? '';
  d.featured6 = [...b.featured6];
  d.featured5 = [...b.featured5];
  const s = b.startsAt ? new Date(b.startsAt) : undefined;
  const e = b.endsAt ? new Date(b.endsAt) : undefined;
  if (s && !Number.isNaN(s.getTime())) {
    d.startMode = 'date';
    d.startDate = ymd(s);
  }
  if (e && !Number.isNaN(e.getTime())) {
    const len = s ? LENGTHS.find((n) => Math.abs(e.getTime() - s.getTime() - n * DAY) < 60_000) : undefined;
    if (len) d.days = len;
    else d.endMode = 'date';
    d.endDate = ymd(e);
  }
  return d;
}

interface Period {
  startsAt?: string;
  endsAt?: string;
  error?: string;
}

/** 기간 계산. 고치는 중이면 날짜가 그대로인 값은 원래 시각을 지킨다 */
function periodOf(d: Draft, orig: Banner | undefined, at = new Date()): Period {
  if (d.kind === 'standard') return {};
  let start: Date | undefined;
  if (d.startMode === 'now') start = at;
  else {
    const keep = orig?.startsAt && ymd(new Date(orig.startsAt)) === d.startDate;
    start = keep ? new Date(orig!.startsAt!) : dayStart(d.startDate);
    if (!start) return { error: '시작 날짜를 골라 주세요.' };
  }
  let end: Date | undefined;
  if (d.endMode === 'days') end = new Date(start!.getTime() + d.days * DAY);
  else {
    const keep = orig?.endsAt && ymd(new Date(orig.endsAt)) === d.endDate;
    const day = dayStart(d.endDate);
    end = keep ? new Date(orig!.endsAt!) : day && new Date(day.getTime() + DAY - 1);
    if (!end) return { error: '끝 날짜를 골라 주세요.' };
  }
  if (end.getTime() <= start!.getTime()) return { error: '끝 날짜가 시작보다 앞입니다.' };
  return { startsAt: start!.toISOString(), endsAt: end.toISOString() };
}

/** 구조화 작업(JSON)에 글 연결이 지정되어 있는지 */
function useTextReady(): { ready: boolean; hasProfile: boolean } | undefined {
  const profiles = useProfiles();
  const settings = useSettings();
  if (!profiles) return undefined;
  const id = settings.routing.structured;
  return {
    ready: !!id && profiles.some((p) => p.id === id && p.type === 'text'),
    hasProfile: profiles.some((p) => p.type === 'text'),
  };
}

function NeedText({ hasProfile }: { hasProfile: boolean }) {
  return (
    <p className="be-need small muted">
      AI로 만들려면 글 연결이 필요합니다. <a href={'#' + (hasProfile ? paths.routing : paths.settings)}>{hasProfile ? '구조화 작업에 연결 지정하기' : '글 연결 추가하기'}</a>
    </p>
  );
}

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg be-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} className="seg-item" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 픽업 고르기: 초상화 칩 여러 개 선택 */
function CharacterPicker({
  label,
  rarity,
  cast,
  selected,
  onChange,
  fresh,
}: {
  label: string;
  rarity: Rarity;
  cast: Character[];
  selected: Id[];
  onChange: (ids: Id[]) => void;
  fresh: Set<Id>;
}) {
  const list = cast.filter((c) => c.rarity === rarity);
  const toggle = (id: Id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <fieldset className="be-picker">
      <legend>
        {label} <span className="mono muted">{selected.filter((id) => list.some((c) => c.id === id)).length}</span>
      </legend>
      {list.length === 0 ? (
        <p className="small muted">{rarity}★ 캐릭터가 없습니다. 아래에서 새로 만들 수 있습니다.</p>
      ) : (
        <ul className="be-chars">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className="be-char" aria-pressed={selected.includes(c.id)} onClick={() => toggle(c.id)}>
                <Portrait character={c} className="be-char-portrait" />
                <span className="be-char-name">
                  {c.name}
                  {fresh.has(c.id) && <span className="pl-new">NEW</span>}
                </span>
                <Stars rarity={c.rarity} />
                <span className="be-check" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

interface GenRun {
  stage: string;
  done: number;
  total: number;
}

export function BannerEditor({
  world,
  banners,
  cast,
  mode,
  onSaved,
}: {
  world: World;
  banners: Banner[];
  cast: Character[];
  mode: 'new' | { edit: Id };
  /** 새로 만들었거나 고친 배너 id (뽑기 패널에서 고르게) */
  onSaved: (id: Id) => void;
}) {
  const editId = mode === 'new' ? undefined : mode.edit;
  const orig = editId ? banners.find((b) => b.id === editId) : undefined;
  const text = useTextReady();
  const paintAvailable = usePaintAvailable();

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string>();

  // AI 이름 짓기
  const [naming, setNaming] = useState(false);
  const [nameError, setNameError] = useState<string>();

  // 새 캐릭터 만들기
  const [new6, setNew6] = useState(1);
  const [new5, setNew5] = useState(1);
  const [theme, setTheme] = useState('');
  const [gen, setGen] = useState<GenRun>();
  const [genError, setGenError] = useState<string>();
  const [genNote, setGenNote] = useState<string>();
  const [fresh, setFresh] = useState<Set<Id>>(() => new Set());
  const genCtrl = useRef<AbortController | null>(null);

  // 그림
  const [painting, setPainting] = useState(false);
  const [paintError, setPaintError] = useState<string>();

  // 고칠 배너가 바뀌면(또는 처음 읽히면) 초안을 다시 채운다
  const initFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = editId ?? 'new';
    if (initFor.current === key) return;
    if (editId && !orig) return;
    // 새 배너를 저장하고 그대로 고치기로 넘어온 경우는 초안을 유지한다
    if (!(initFor.current === 'new' && editId)) setDraft(orig ? draftFrom(orig) : emptyDraft());
    initFor.current = key;
    setErrors([]);
    setConfirmDelete(false);
    setPainting(editId ? isPaintingBanner(editId) : false);
  }, [editId, orig]);

  useEffect(() => () => genCtrl.current?.abort(), []);

  // 저장이 검사에 걸리면 오류 목록이 보이게
  const errorsRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (errors.length) errorsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [errors]);

  const byId = useMemo(() => new Map(cast.map((c) => [c.id, c])), [cast]);
  const standardCount = banners.filter((b) => b.kind === 'standard').length;
  const lastStandard = orig?.kind === 'standard' && standardCount <= 1;
  const period = periodOf(draft, orig);

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setNotice(undefined);
  };

  if (editId && !orig) {
    return (
      <EmptyState title="배너를 찾을 수 없습니다" badge="NOT FOUND">
        <p>지워졌거나 다른 월드의 배너입니다.</p>
        <p style={{ marginTop: 12 }}>
          <a className="btn" href={'#' + paths.pull}>
            뽑기로 돌아가기
          </a>
        </p>
      </EmptyState>
    );
  }

  const validate = (d: Draft): string[] => {
    const out: string[] = [];
    if (!d.name.trim()) out.push('배너 이름을 입력해 주세요.');
    const has6 = d.featured6.some((id) => byId.get(id)?.rarity === 6);
    if (d.kind === 'limited' && !has6) out.push('한정 배너는 픽업 6★가 한 명 이상 있어야 합니다.');
    if (d.kind === 'limited' && period.error) out.push(period.error);
    if (lastStandard && d.kind !== 'standard') out.push('상시 배너가 하나는 있어야 합니다. 마지막 상시 배너는 한정으로 바꿀 수 없습니다.');
    return out;
  };

  /** 저장하고 배너 id를 돌려준다. 검사에 걸리면 undefined */
  const persist = async (): Promise<Id | undefined> => {
    const errs = validate(draft);
    setErrors(errs);
    if (errs.length) return undefined;
    const valid6 = draft.featured6.filter((id) => byId.get(id)?.rarity === 6);
    const valid5 = draft.featured5.filter((id) => byId.get(id)?.rarity === 5);
    const p = periodOf(draft, orig);
    const base: Banner = orig
      ? { ...orig }
      : {
          id: newId('banner_'),
          worldId: world.id,
          kind: draft.kind,
          name: '',
          featured6: [],
          featured5: [],
          createdAt: now(),
        };
    const next: Banner = {
      ...base,
      kind: draft.kind,
      name: draft.name.trim(),
      featured6: valid6,
      featured5: valid5,
    };
    const desc = draft.description.trim();
    if (desc) next.description = desc;
    else delete next.description;
    if (draft.kind === 'limited') {
      next.startsAt = p.startsAt;
      next.endsAt = p.endsAt;
    } else {
      delete next.startsAt;
      delete next.endsAt;
    }
    await db.banners.put(next);
    return next.id;
  };

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const id = await persist();
      if (!id) return;
      onSaved(id);
      navigate(paths.pull);
    } catch (e) {
      console.error(e);
      setErrors(['저장하지 못했습니다. 다시 시도해 주세요.']);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!orig || lastStandard) return;
    try {
      await db.transaction('rw', db.banners, db.assets, async () => {
        // 뽑기 기록(pulls)은 남긴다. 목록에서만 사라진다
        await db.banners.delete(orig.id);
        if (orig.artId) await db.assets.delete(orig.artId);
      });
      navigate(paths.pull, { replace: true });
    } catch (e) {
      console.error(e);
      setErrors(['지우지 못했습니다. 다시 시도해 주세요.']);
    }
  };

  const featuredNames = () => [...draft.featured6, ...draft.featured5].map((id) => byId.get(id)?.name).filter((n): n is string => !!n);

  const onName = async () => {
    if (naming) return;
    setNaming(true);
    setNameError(undefined);
    try {
      const meta = await generateBannerMeta(world.id, {
        brief: theme,
        featuredNames: featuredNames(),
        kind: draft.kind,
      });
      set({
        name: meta.name,
        ...(meta.description ? { description: meta.description } : {}),
      });
    } catch (e) {
      setNameError(describeTextError(e));
    } finally {
      setNaming(false);
    }
  };

  const onGenerate = async () => {
    if (gen || new6 + new5 === 0) return;
    const ctrl = new AbortController();
    genCtrl.current = ctrl;
    const total = new6 + new5;
    const before = new Set(cast.map((c) => c.id));
    setGenError(undefined);
    setGenNote(undefined);
    setGen({ stage: '준비 중…', done: 0, total });
    let offset = 0;
    try {
      for (const [rarity, count] of [
        [6, new6],
        [5, new5],
      ] as const) {
        if (count === 0) continue;
        const o = offset;
        await generateCharacters(world.id, {
          rarity,
          count,
          brief: theme,
          signal: ctrl.signal,
          onProgress: (stage, done) =>
            setGen({
              stage: stage === '완료' ? `${rarity}★ 완료` : stage,
              done: o + done,
              total,
            }),
        });
        offset += count;
      }
      setGenNote(`새 캐릭터 ${total}명을 만들어 픽업에 넣었습니다.`);
    } catch (e) {
      if (ctrl.signal.aborted) setGenNote('멈췄습니다. 그때까지 만든 캐릭터는 남아 있습니다.');
      else setGenError(describeTextError(e));
    } finally {
      // 실패·취소해도 그때까지 만든 캐릭터는 픽업에 넣는다
      const made = (await db.characters.where('worldId').equals(world.id).toArray()).filter((c) => !before.has(c.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      if (made.length) {
        setFresh((s) => new Set([...s, ...made.map((c) => c.id)]));
        setDraft((d) => ({
          ...d,
          featured6: [...d.featured6, ...made.filter((c) => c.rarity === 6 && !d.featured6.includes(c.id)).map((c) => c.id)],
          featured5: [...d.featured5, ...made.filter((c) => c.rarity === 5 && !d.featured5.includes(c.id)).map((c) => c.id)],
        }));
      }
      if (genCtrl.current === ctrl) genCtrl.current = null;
      setGen(undefined);
    }
  };

  const onPaint = async () => {
    if (painting) return;
    setPaintError(undefined);
    setPainting(true);
    try {
      const id = await persist();
      if (!id) return;
      if (!editId) {
        onSaved(id);
        navigate(paths.editBanner(id), { replace: true });
      } else setNotice('저장했습니다.');
      const had = editId ? !!orig?.artId : false;
      await paintBannerArt(id, { priority: 'foreground', force: had });
    } catch (e) {
      setPaintError(e instanceof Error ? e.message : String(e));
    } finally {
      setPainting(false);
    }
  };

  const aiReady = !!text?.ready;
  const genPct = gen && gen.total > 0 ? Math.round((gen.done / gen.total) * 100) : 0;

  return (
    <form
      className="be"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave();
      }}
      noValidate
    >
      <header className="be-head">
        <span className="kicker">{orig ? 'EDIT BANNER' : 'NEW BANNER'}</span>
        <h2>{orig ? '배너 고치기' : '새 배너 만들기'}</h2>
        <p className="small muted">픽업 캐릭터와 기간을 정합니다. 지금 있는 캐릭터만으로도 AI 없이 만들 수 있습니다.</p>
      </header>

      <section className="be-section">
        <div className="field">
          <span className="label">종류</span>
          <Seg
            label="배너 종류"
            value={draft.kind}
            options={[
              { value: 'standard', label: '상시' },
              { value: 'limited', label: '한정' },
            ]}
            onChange={(kind) => set({ kind })}
          />
          <p className="field-hint">
            {draft.kind === 'standard' ? '상시 배너끼리 천장을 공유하고, 기간이 없습니다.' : '천장을 따로 세고, 300회 교환이 있습니다. 기간이 정해집니다.'}
          </p>
        </div>

        <Field label="이름" error={nameError}>
          {(id) => (
            <div className="input-group">
              <input id={id} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 한여름 불꽃 모집" maxLength={60} autoComplete="off" />
              <button
                type="button"
                className="btn btn-inline"
                disabled={!aiReady || naming}
                onClick={() => void onName()}
                title={aiReady ? '테마와 픽업을 보고 이름·소개를 짓습니다' : '글 연결이 필요합니다'}
              >
                {naming ? '짓는 중…' : 'AI가 짓기'}
              </button>
            </div>
          )}
        </Field>

        <Field label="소개" hint="배너 아래에 한두 줄 보여 줍니다 (선택)">
          {(id) => (
            <textarea id={id} rows={3} value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="예: 축제의 밤, 불꽃 아래에서 만난 이들." />
          )}
        </Field>
      </section>

      {draft.kind === 'limited' && (
        <section className="be-section" aria-labelledby="be-period-h">
          <h3 id="be-period-h" className="be-h">
            한정 기간
          </h3>
          <div className="be-row">
            <span className="be-row-label small">시작</span>
            <div className="chips be-chips">
              <button type="button" className="chip" aria-pressed={draft.startMode === 'now'} onClick={() => set({ startMode: 'now' })}>
                지금
              </button>
              <button type="button" className="chip" aria-pressed={draft.startMode === 'date'} onClick={() => set({ startMode: 'date' })}>
                날짜 지정
              </button>
            </div>
            {draft.startMode === 'date' && (
              <input type="date" className="be-date" aria-label="시작 날짜" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            )}
          </div>
          <div className="be-row">
            <span className="be-row-label small">길이</span>
            <div className="chips be-chips">
              {LENGTHS.map((n) => (
                <button key={n} type="button" className="chip" aria-pressed={draft.endMode === 'days' && draft.days === n} onClick={() => set({ endMode: 'days', days: n })}>
                  {n}일
                </button>
              ))}
              <button type="button" className="chip" aria-pressed={draft.endMode === 'date'} onClick={() => set({ endMode: 'date' })}>
                끝 날짜
              </button>
            </div>
            {draft.endMode === 'date' && <input type="date" className="be-date" aria-label="끝 날짜" value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} />}
          </div>
          <p className={period.error ? 'small be-period be-period-error' : 'small be-period mono'}>
            {period.error ?? (period.startsAt && period.endsAt ? `${dotted(new Date(period.startsAt))} – ${dotted(new Date(period.endsAt))}` : '')}
          </p>
        </section>
      )}

      <section className="be-section" aria-labelledby="be-feat-h">
        <h3 id="be-feat-h" className="be-h">
          픽업
        </h3>
        <CharacterPicker
          label={`픽업 6★${draft.kind === 'limited' ? ' (1명 이상)' : ''}`}
          rarity={6}
          cast={cast}
          selected={draft.featured6}
          onChange={(featured6) => set({ featured6 })}
          fresh={fresh}
        />
        <CharacterPicker label="픽업 5★" rarity={5} cast={cast} selected={draft.featured5} onChange={(featured5) => set({ featured5 })} fresh={fresh} />
      </section>

      <section className="be-section be-box" aria-labelledby="be-gen-h">
        <h3 id="be-gen-h" className="be-h">
          새 캐릭터로 픽업 만들기
        </h3>
        <p className="small muted">AI가 이 월드에 맞는 새 캐릭터를 만들고 바로 픽업에 넣습니다. 6★·5★는 한 명씩 만듭니다.</p>
        <div className="be-counts">
          <div className="field">
            <span className="label">새 6★</span>
            <Seg label="새 6★ 수" value={new6} options={[0, 1, 2].map((n) => ({ value: n, label: `${n}명` }))} onChange={setNew6} />
          </div>
          <div className="field">
            <span className="label">새 5★</span>
            <Seg label="새 5★ 수" value={new5} options={[0, 1, 2, 3].map((n) => ({ value: n, label: `${n}명` }))} onChange={setNew5} />
          </div>
        </div>
        <Field label="테마" hint="배너 주제를 적으면 캐릭터와 AI 이름 짓기에 반영됩니다 (선택)">
          {(id) => <input id={id} value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="예: 여름 축제 한정, 검은 기사단" autoComplete="off" disabled={!!gen} />}
        </Field>
        {gen ? (
          <div className="be-progress" aria-live="polite">
            <div className="be-progress-line">
              <span className="pill pill-run">생성 중</span>
              <strong>{gen.stage}</strong>
              <span className="mono muted">
                {gen.done}/{gen.total}
              </span>
            </div>
            <div className="meter be-meter" role="progressbar" aria-valuemin={0} aria-valuemax={gen.total} aria-valuenow={gen.done} aria-label="캐릭터 생성 진행">
              <span style={{ width: Math.max(4, genPct) + '%' }} />
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => genCtrl.current?.abort()}>
              취소
            </button>
          </div>
        ) : (
          <div className="be-gen-actions">
            <button type="button" className="btn btn-accent" disabled={!aiReady || new6 + new5 === 0} onClick={() => void onGenerate()}>
              새 캐릭터 {new6 + new5}명 만들기
            </button>
          </div>
        )}
        {text && !text.ready && <NeedText hasProfile={text.hasProfile} />}
        {genNote && <p className="small be-ok">{genNote}</p>}
        {genError && (
          <div className="form-errors" role="alert">
            <strong>캐릭터를 만들지 못했습니다</strong>
            <p>{genError}</p>
          </div>
        )}
      </section>

      {paintAvailable && (
        <section className="be-section" aria-labelledby="be-art-h">
          <h3 id="be-art-h" className="be-h">
            배너 그림
          </h3>
          {orig ? (
            <BannerArt banner={orig} className="be-art" />
          ) : (
            <div className="pl-banner-art be-art">
              <span className="pl-hatch" />
            </div>
          )}
          <div className="be-gen-actions">
            <button type="button" className="btn" disabled={painting || !!gen} onClick={() => void onPaint()}>
              {painting ? '그리는 중…' : !orig ? '저장하고 배너 그림 그리기' : orig.artId ? '배너 그림 다시 그리기' : '배너 그림 그리기'}
            </button>
            {painting && <span className="pill pill-run">그리는 중</span>}
          </div>
          <p className="small muted">픽업 캐릭터 최대 3명(6★ 먼저)을 가로 그림으로 그립니다. 지금 내용을 먼저 저장합니다.</p>
          {paintError && (
            <p className="field-error" role="alert">
              {paintError}
            </p>
          )}
        </section>
      )}

      {errors.length > 0 && (
        <ul className="form-errors" role="alert" ref={errorsRef}>
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {notice && <p className="small be-ok">{notice}</p>}

      <div className="form-actions be-actions">
        <button type="submit" className="btn btn-primary" disabled={saving || !!gen}>
          {orig ? '저장' : '배너 만들기'}
        </button>
        <a className="btn btn-ghost" href={'#' + paths.pull}>
          취소
        </a>
        {orig && (
          <span className="be-delete">
            {confirmDelete ? (
              <>
                <span className="small">정말 지울까요?</span>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmDelete(false)}>
                  아니요
                </button>
                <button type="button" className="btn btn-danger btn-small" onClick={() => void onDelete()}>
                  삭제
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-danger"
                disabled={lastStandard}
                title={lastStandard ? '마지막 상시 배너는 지울 수 없습니다' : undefined}
                onClick={() => setConfirmDelete(true)}
              >
                삭제
              </button>
            )}
          </span>
        )}
      </div>
      {orig && lastStandard && <p className="small muted">마지막 상시 배너는 지울 수 없습니다. 뽑기 기록은 배너를 지워도 남습니다.</p>}
      {orig && !lastStandard && <p className="small muted">배너를 지워도 뽑기 기록은 남습니다.</p>}
    </form>
  );
}
