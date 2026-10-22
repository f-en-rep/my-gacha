// 기록 패널: 왼쪽은 내 프로필 한 줄과 사건·인물·물건 목록(챕터별), 오른쪽은 고른 기록 고치기 또는 내 프로필.
// 기록은 챕터를 마칠 때 자동으로 쌓이고(월드 쪽, 스토리와 함께 팩에 들어감), 직접 적을 수도 있다.
import { useEffect, useRef, useState } from 'react';
import { ZodError } from 'zod';
import { EmptyState } from '../common';
import { Icon } from '../Icon';
import { Panel, PageHint } from '../panel/Panel';
import { Field } from '../settings/fields';
import { navigate, paths } from '../router';
import { useActiveGame, useCast, useChapters } from '../../game/store';
import { LORE_KINDS, LORE_LIMITS, deleteLore, saveLore, useLore } from '../../game/lore';
import { PLAYER_LIMITS, savePlayer } from '../../game/player';
import type { Chapter, Character, LoreEntry, LoreKind, Save, World } from '../../types';
import './archive.css';

const KIND: Record<LoreKind, { label: string; noun: string; hint: string; empty: string }> = {
  event: {
    label: '사건',
    noun: '사건',
    hint: '챕터마다 일어난 큰 일을 한두 줄로.',
    empty: '챕터를 끝까지 읽으면 그 챕터의 큰 사건이 여기에 한두 줄로 정리됩니다.',
  },
  person: {
    label: '인물',
    noun: '인물',
    hint: '이야기에 나왔지만 뽑을 수 없는 사람들. 캐스트(가챠 캐릭터)는 들어가지 않아요.',
    empty: '챕터를 끝까지 읽으면 이야기에 나온 캐스트 밖 인물(조력자, 적, 가족 …)이 여기에 모입니다.',
  },
  item: {
    label: '물건',
    noun: '물건',
    hint: '얻었거나 잃었거나, 이야기에 얽힌 물건.',
    empty: '챕터를 끝까지 읽으면 얻었거나 얽힌 물건이 여기에 남습니다.',
  },
};

function errorText(e: unknown): string {
  if (e instanceof ZodError) return e.issues[0]?.message ?? '입력을 확인해 주세요.';
  return e instanceof Error ? e.message : String(e);
}

export function ArchivePanel({ kind, id, mode }: { kind?: LoreKind; id?: string; mode?: 'new' | 'profile' }) {
  const { loading, world, save } = useActiveGame();
  const ready = world?.status === 'ready' ? world : undefined;
  const lore = useLore(ready?.id);
  const chapters = useChapters(ready?.id);
  const cast = useCast(ready?.id);
  const k: LoreKind = kind ?? 'event';
  const selected = id ? lore?.find((e) => e.id === id) : undefined;

  // 고른 기록이 바뀌면 오른쪽 페이지를 맨 위부터
  useEffect(() => {
    document.querySelector('.panel .page-right')?.scrollTo(0, 0);
    if (id || mode) document.querySelector('.panel .book')?.scrollTo(0, 0);
  }, [id, mode]);

  if (loading) return <Panel name="archive" code="ARCHIVE" title="기록" left={null} right={null} />;

  if (!ready || !save) {
    return (
      <Panel
        name="archive"
        code="ARCHIVE"
        title="기록"
        focus="left"
        left={
          <EmptyState title="플레이 중인 월드가 없습니다">
            <p>
              기록은 월드의 이야기에서 모입니다. 먼저 월드를 만들거나 골라 주세요. <a href={'#' + paths.world}>월드 패널 열기</a>
            </p>
          </EmptyState>
        }
        right={<PageHint>월드가 준비되면 여기에 사건·인물·물건과 내 프로필이 생깁니다.</PageHint>}
      />
    );
  }

  let right;
  if (!lore) right = null;
  else if (mode === 'new') right = <LoreEditor key={'new-' + k} world={ready} kind={k} />;
  else if (id)
    right = selected ? (
      <LoreEditor key={selected.id} world={ready} kind={selected.kind} entry={selected} chapters={chapters} cast={cast} />
    ) : (
      <PageHint>기록을 찾을 수 없습니다. 지워졌을 수 있습니다.</PageHint>
    );
  // 아무것도 안 골랐으면 (넓은 화면) 내 프로필
  else right = <ProfileEditor key={save.id} save={save} world={ready} />;

  return (
    <Panel
      name="archive"
      code="ARCHIVE"
      title="기록"
      focus={id || mode ? 'right' : 'left'}
      back={mode === 'profile' ? paths.archive : paths.loreKind(k)}
      left={<ArchiveList save={save} lore={lore} chapters={chapters} kind={k} selectedId={id} profileOpen={mode === 'profile'} />}
      right={right}
    />
  );
}

/* ── 왼쪽: 내 프로필 한 줄 + 종류별 목록 ───────────── */

function ArchiveList({
  save,
  lore,
  chapters,
  kind,
  selectedId,
  profileOpen,
}: {
  save: Save;
  lore: LoreEntry[] | undefined;
  chapters: Chapter[] | undefined;
  kind: LoreKind;
  selectedId?: string;
  profileOpen: boolean;
}) {
  if (!lore) return null;
  const list = lore.filter((e) => e.kind === kind);
  const title = (i: number | undefined) => chapters?.find((c) => c.index === i)?.title;
  const groups: { key: string; no?: string; label: string; items: LoreEntry[] }[] = [];
  for (const e of list) {
    const key = e.chapterIndex === undefined ? 'none' : String(e.chapterIndex);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const t = e.chapterIndex === undefined ? undefined : title(e.chapterIndex);
      g =
        e.chapterIndex === undefined
          ? { key, label: '챕터 없이 적은 기록', items: [] }
          : { key, no: `No.${String(e.chapterIndex).padStart(2, '0')}`, label: t ?? `${e.chapterIndex}장`, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }
  const intro = [save.player?.profile, save.player?.appearance].find((s) => s?.trim());

  return (
    <div className="stack">
      <div>
        <div className="page-section-head">
          <h2>내 프로필</h2>
          <span className="mono muted">{save.name}</span>
        </div>
        <a className="menu-row ar-me" href={'#' + paths.playerProfile} aria-current={profileOpen ? 'true' : undefined}>
          <span className="ar-me-icon" aria-hidden="true">
            <Icon name="star" size={18} />
          </span>
          <span className="menu-row-text">
            <strong>{save.playerName?.trim() || '이름 없음'}</strong>
            <small className="ar-clamp">{intro?.trim() || '소개와 외형을 적으면 대화와 스토리에 반영됩니다.'}</small>
          </span>
          <Icon name="chevron" size={18} />
        </a>
      </div>

      <div>
        <div className="ar-kinds" role="tablist" aria-label="기록 종류">
          {LORE_KINDS.map((x) => {
            const n = lore.filter((e) => e.kind === x).length;
            return (
              <a
                key={x}
                className="chip ar-kind"
                role="tab"
                aria-selected={x === kind}
                aria-current={x === kind ? 'page' : undefined}
                href={'#' + paths.loreKind(x)}
              >
                {KIND[x].label} <span className="mono">{n}</span>
              </a>
            );
          })}
        </div>
        <p className="small muted ar-kind-hint">{KIND[kind].hint}</p>
        <a className="btn btn-small ar-add" href={'#' + paths.newLore(kind)}>
          <Icon name="plus" size={16} /> {KIND[kind].noun} 직접 적기
        </a>
      </div>

      {list.length === 0 ? (
        <div className="hint-box ar-empty">
          <strong>아직 {KIND[kind].label} 기록이 없습니다</strong>
          <p className="small muted">
            {KIND[kind].empty} 직접 적어 둘 수도 있어요. <a href={'#' + paths.story}>스토리 열기</a>
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="ar-group">
            <h3 className="ar-group-head">
              {g.no && <span className="mono">{g.no}</span>}
              {g.label}
            </h3>
            <ul className="menu-list">
              {g.items.map((e) => (
                <li key={e.id}>
                  <a className="menu-row ar-row" href={'#' + paths.lore(e.kind, e.id)} aria-current={e.id === selectedId ? 'true' : undefined}>
                    <span className="menu-row-text">
                      <strong>
                        {e.name}
                        {e.source === 'manual' && <span className="ar-tag">직접</span>}
                      </strong>
                      {e.summary && <small className="ar-clamp">{e.summary}</small>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/* ── 오른쪽: 기록 하나 보기·고치기 ─────────────────── */

function LoreEditor({ world, kind, entry, chapters, cast }: { world: World; kind: LoreKind; entry?: LoreEntry; chapters?: Chapter[]; cast?: Character[] }) {
  const [name, setName] = useState(entry?.name ?? '');
  const [summary, setSummary] = useState(entry?.summary ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [note, setNote] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const dirty = name !== (entry?.name ?? '') || summary !== (entry?.summary ?? '');
  const chapter = entry?.chapterIndex !== undefined ? chapters?.find((c) => c.index === entry.chapterIndex) : undefined;
  const people = (entry?.castIds ?? []).map((id) => cast?.find((c) => c.id === id)).filter((c): c is Character => !!c);

  const save = async () => {
    setBusy(true);
    setErr(undefined);
    setNote(undefined);
    try {
      const id = await saveLore(world.id, kind, { name, summary }, entry?.id);
      if (!entry) navigate(paths.lore(kind, id), { replace: true });
      else setNote('저장했습니다.');
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!entry) return;
    await deleteLore(entry.id);
    navigate(paths.loreKind(kind), { replace: true });
  };

  return (
    <form
      className="ar-edit stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <header>
        <span className="kicker">{`${kind.toUpperCase()} · ${!entry ? 'NEW' : entry.source === 'manual' ? 'MANUAL' : 'FROM STORY'}`}</span>
        <h2 className="ar-title">{entry ? entry.name : `새 ${KIND[kind].noun}`}</h2>
        <p className="small muted">
          {entry
            ? chapter
              ? `${chapter.index}장 「${chapter.title}」에서`
              : entry.chapterIndex !== undefined
                ? `${entry.chapterIndex}장에서`
                : '직접 적은 기록'
            : KIND[kind].hint}
        </p>
      </header>

      <Field label={kind === 'event' ? '제목' : '이름'} error={err && !name.trim() ? err : undefined}>
        {(id) => <input id={id} value={name} maxLength={LORE_LIMITS.name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
      </Field>
      <Field label="설명" hint={`한두 줄이면 충분해요. ${summary.length}/${LORE_LIMITS.summary}`}>
        {(id) => <textarea id={id} rows={4} value={summary} maxLength={LORE_LIMITS.summary} onChange={(e) => setSummary(e.target.value)} />}
      </Field>

      {people.length > 0 && (
        <p className="small ar-meta">
          얽힌 캐릭터:{' '}
          {people.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ', '}
              <a href={'#' + paths.character(c.id)}>{c.name}</a>
            </span>
          ))}
        </p>
      )}
      {entry?.source === 'story' && (
        <p className="small muted">챕터 정리에서 자동으로 적은 기록입니다. 직접 고쳐 저장하면 다음 정리가 이 글을 덮어쓰지 않아요.</p>
      )}
      {err && name.trim() && <p className="field-error">{err}</p>}
      {note && !dirty && (
        <p className="small ar-ok" role="status">
          {note}
        </p>
      )}

      <div className="ar-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || (!!entry && !dirty)}>
          {entry ? '저장' : '적어 두기'}
        </button>
        {entry &&
          (confirm ? (
            <>
              <button type="button" className="btn btn-danger" onClick={() => void remove()}>
                정말 지우기
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>
                그만두기
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
              지우기
            </button>
          ))}
      </div>
      <p className="small muted">기록은 스토리와 함께 월드 팩(스토리 포함)과 백업에 들어갑니다. 인물·물건은 다음 챕터를 쓸 때 AI에게 짧게 알려 줘요.</p>
    </form>
  );
}

/* ── 오른쪽: 내 프로필 ───────────────────────────── */

function ProfileEditor({ save, world }: { save: Save; world: World }) {
  const init = () => ({
    name: save.playerName ?? '',
    profile: save.player?.profile ?? '',
    appearance: save.player?.appearance ?? '',
    imageTags: save.player?.imageTags ?? '',
  });
  const [form, setForm] = useState(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [saved, setSaved] = useState(false);
  const base = init();
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== base[k]);
  const set = (p: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...p }));
    setSaved(false);
  };

  // 대화의 "내 이름"에서 이름을 바꾸면 (고치는 중이 아닐 때) 따라간다
  const outsideName = save.playerName ?? '';
  const lastName = useRef(outsideName);
  useEffect(() => {
    const prev = lastName.current;
    lastName.current = outsideName;
    setForm((f) => (f.name === prev ? { ...f, name: outsideName } : f));
  }, [outsideName]);

  const submit = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await savePlayer(save.id, form);
      setSaved(true);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="ar-edit stack"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <header>
        <span className="kicker">MY PROFILE · {save.name}</span>
        <h2 className="ar-title">내 프로필</h2>
        <p className="small muted">「{world.name}」에서 내가 맡은 인물. 세이브마다 따로 저장됩니다.</p>
      </header>

      <Field label="이름" hint={`캐릭터가 나를 부르는 이름. 비우면 「당신」. 대화의 「내 이름」과 같은 칸이에요. ${form.name.length}/${PLAYER_LIMITS.name}`}>
        {(id) => (
          <input
            id={id}
            value={form.name}
            maxLength={PLAYER_LIMITS.name}
            placeholder="당신"
            autoComplete="off"
            onChange={(e) => set({ name: e.target.value })}
          />
        )}
      </Field>
      <Field label="짧은 소개" hint={`누구인지, 어떤 사람인지 몇 줄로. ${form.profile.length}/${PLAYER_LIMITS.profile}`}>
        {(id) => (
          <textarea
            id={id}
            rows={4}
            value={form.profile}
            maxLength={PLAYER_LIMITS.profile}
            placeholder="예: 변두리 섬 수비대에 새로 부임한 지휘관. 말수는 적지만 동료를 끝까지 믿는다."
            onChange={(e) => set({ profile: e.target.value })}
          />
        )}
      </Field>
      <Field label="외형" hint={`월드 언어로. ${form.appearance.length}/${PLAYER_LIMITS.appearance}`}>
        {(id) => (
          <textarea
            id={id}
            rows={3}
            value={form.appearance}
            maxLength={PLAYER_LIMITS.appearance}
            placeholder="예: 짧은 흑발, 회색 눈, 낡은 지휘관 코트"
            onChange={(e) => set({ appearance: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="그림 태그 (영어)"
        hint={`쉼표로 나눈 영어 태그. 지금은 저장만 해 두고, 내가 나오는 장면 그림이 생기면 그때 씁니다. ${form.imageTags.length}/${PLAYER_LIMITS.imageTags}`}
      >
        {(id) => (
          <input
            id={id}
            value={form.imageTags}
            maxLength={PLAYER_LIMITS.imageTags}
            placeholder="1boy, short black hair, grey eyes, long coat"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => set({ imageTags: e.target.value })}
          />
        )}
      </Field>

      {err && <p className="field-error">{err}</p>}
      <div className="ar-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
          저장
        </button>
        {saved && !dirty && (
          <span className="small ar-ok" role="status">
            저장했습니다.
          </span>
        )}
      </div>

      <div className="hint-box ar-uses">
        <strong>어디에 쓰이나요</strong>
        <ul className="small">
          <li>
            <b>1:1 대화</b> — 이름으로 부르고, 소개·외형을 알고 이야기해요.
          </li>
          <li>
            <b>스토리</b> — 챕터 계획과 장면 쓰기에 주인공으로 짧게 들어가요. 쓰인 장면은 월드 쪽 기록이라, 스토리를 넣은 월드 팩을 친구에게 주면 함께 갑니다.
          </li>
          <li>
            <b>그림 태그</b> — 아직 쓰는 곳이 없어요. 플레이어가 나오는 그림이 생기면 이 태그로 그립니다.
          </li>
        </ul>
        <p className="small muted">백업에 들어가고, 월드 팩에는 들어가지 않습니다.</p>
      </div>
    </form>
  );
}
