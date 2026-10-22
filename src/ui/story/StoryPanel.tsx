// 스토리 패널: 왼쪽은 챕터 목록과 "다음 챕터 쓰기", 오른쪽은 고른 챕터. 읽기 화면은 그 위에 덮는다.
import { useEffect } from 'react';
import { EmptyState } from '../common';
import { Panel, PageHint } from '../panel/Panel';
import { paths } from '../router';
import { useSettings } from '../hooks';
import { useActiveGame, useBeats, useChapters, STORY_CLEAR_REWARD } from '../../game/store';
import { BEATS_PER_CHAPTER } from '../../gen/story';
import type { Chapter, Save, StoryProgress, World } from '../../types';
import { cancelPlan, openChapter, startPlan, usePlanState } from './runner';
import { Reader } from './Reader';
import './story.css';

const fmt = (n: number) => n.toLocaleString('ko-KR');

export function StoryPanel({ chapterId, read }: { chapterId?: string; read?: boolean }) {
  const { loading, world, save } = useActiveGame();
  const ready = world?.status === 'ready' ? world : undefined;
  const chapters = useChapters(ready?.id);
  const settings = useSettings();
  const selected = chapterId ? chapters?.find((c) => c.id === chapterId) : undefined;

  // 고른 챕터가 바뀌면 오른쪽 페이지를 맨 위부터
  useEffect(() => {
    document.querySelector('.panel .page-right')?.scrollTo(0, 0);
    if (chapterId) document.querySelector('.panel .book')?.scrollTo(0, 0);
  }, [chapterId]);

  if (loading) return <Panel name="story" code="STORY" title="스토리" left={null} right={null} />;

  if (!ready || !save) {
    return (
      <Panel
        name="story"
        code="STORY"
        title="스토리"
        focus="left"
        left={
          <EmptyState title="플레이 중인 월드가 없습니다">
            <p>
              스토리는 월드의 캐스트로 쓰입니다. 먼저 월드를 만들거나 골라 주세요. <a href={'#' + paths.world}>월드 패널 열기</a>
            </p>
          </EmptyState>
        }
        right={<PageHint>월드가 준비되면 여기에서 챕터를 읽습니다.</PageHint>}
      />
    );
  }

  // 넓은 화면에서 아무것도 안 골랐으면 마지막 챕터를 오른쪽에 보여 준다
  const shown = selected ?? (chapterId ? undefined : chapters?.[chapters.length - 1]);

  return (
    <>
      <Panel
        name="story"
        code="STORY"
        title="스토리"
        focus={chapterId ? 'right' : 'left'}
        back={paths.story}
        left={<ChapterList world={ready} save={save} chapters={chapters} selectedId={shown?.id} canWrite={!!settings.routing.structured} />}
        right={
          !chapters ? null : shown ? (
            <ChapterDetail key={shown.id} chapter={shown} save={save} world={ready} />
          ) : chapterId ? (
            <PageHint>챕터를 찾을 수 없습니다. 지워졌을 수 있습니다.</PageHint>
          ) : (
            <PageHint>첫 챕터를 쓰면 여기에서 읽을 수 있습니다.</PageHint>
          )
        }
      />
      {read && selected && <Reader key={selected.id} chapter={selected} world={ready} save={save} />}
    </>
  );
}

function stateOf(p: StoryProgress | undefined, total: number): { label: string; tone: 'done' | 'reading' | 'new' } {
  if (p?.clearedAt) return { label: '다 읽음', tone: 'done' };
  if (p) return { label: `읽는 중 ${Math.min(p.beat + 1, total)}/${total}`, tone: 'reading' };
  return { label: '아직 안 읽음', tone: 'new' };
}

function ChapterList({
  world,
  save,
  chapters,
  selectedId,
  canWrite,
}: {
  world: World;
  save: Save;
  chapters: Chapter[] | undefined;
  selectedId?: string;
  canWrite: boolean;
}) {
  const plan = usePlanState(world.id);
  if (!chapters) return null;
  const last = chapters[chapters.length - 1];
  const unlocked = !last || !!save.story?.[last.id]?.clearedAt;

  return (
    <div className="stack">
      <div>
        <div className="page-section-head">
          <h2>챕터</h2>
          <span className="mono muted">{chapters.length}</span>
        </div>
        {chapters.length === 0 ? (
          <p className="list-empty st-empty-list">아직 쓴 챕터가 없습니다. 첫 챕터를 써 보세요.</p>
        ) : (
          <ol className="menu-list st-ch-list">
            {chapters.map((c) => {
              const p = save.story?.[c.id];
              const st = stateOf(p, c.nodes.length || BEATS_PER_CHAPTER);
              const verb = st.tone === 'reading' ? '이어 읽기' : st.tone === 'done' ? '다시 읽기' : '읽기';
              return (
                <li key={c.id} className={c.id === selectedId ? 'is-selected' : undefined}>
                  {/* 이름을 누르면 바로 읽는다 ("이어 읽기"와 같다). 장면 목록은 "자세히"로 */}
                  <a
                    className="menu-row st-ch-row"
                    href={'#' + paths.read(c.id)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      openChapter(c.id, p);
                    }}
                  >
                    <span className="st-ch-no mono" aria-label={`${c.index}장`}>
                      No.{String(c.index).padStart(2, '0')}
                    </span>
                    <span className="menu-row-text">
                      <strong>{c.title}</strong>
                      <small className={'st-state st-state-' + st.tone}>{st.label}</small>
                    </span>
                    <span className="st-ch-play">
                      <span className="st-ch-play-text">{verb}</span>
                      <span aria-hidden="true">▶</span>
                    </span>
                  </a>
                  <a
                    className="st-ch-more"
                    href={'#' + paths.chapter(c.id)}
                    aria-current={c.id === selectedId ? 'true' : undefined}
                    aria-label={`${c.index}장 자세히`}
                  >
                    자세히
                  </a>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="st-write">
        {!canWrite ? (
          <div className="hint-box hint-strong">
            <strong>글 연결이 필요합니다</strong>
            <p className="small muted">
              새 챕터를 쓰려면 구조화 작업에 쓸 글 연결을 지정해 주세요. <a href={'#' + paths.settings}>설정 열기</a>
            </p>
          </div>
        ) : plan.running ? (
          <div className="st-plan-run" role="status">
            <span className="kicker">WRITING · NEXT CHAPTER</span>
            <p className="st-plan-stage">
              <span className="st-spinner" aria-hidden="true" />
              {plan.stage || '챕터를 계획하는 중'}…
            </p>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => cancelPlan(world.id)}>
              취소
            </button>
          </div>
        ) : (
          <>
            {plan.error && (
              <div className="st-error" role="alert">
                <strong>챕터를 쓰지 못했습니다</strong>
                <p className="small">{plan.error}</p>
              </div>
            )}
            {plan.cancelled && <p className="small muted">챕터 쓰기를 멈췄습니다.</p>}
            <button type="button" className="btn btn-accent st-write-btn" disabled={!unlocked} onClick={() => void startPlan(world.id)}>
              {plan.error ? '다시 시도' : '다음 챕터 쓰기'}
            </button>
            <p className="small muted">
              {unlocked
                ? `${chapters.length + 1}장을 계획합니다. 처음 끝까지 읽으면 ${world.currency.pull} ${fmt(STORY_CLEAR_REWARD)}을 받습니다.`
                : `${last!.index}장을 끝까지 읽으면 다음 챕터를 쓸 수 있습니다.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** 줄거리의 첫 문장만 */
function firstSentence(s: string): string {
  const t = s.trim();
  const m = t.match(/^.*?[.!?。！？…](?=\s|$)/s);
  return (m ? m[0] : t).trim();
}

function ChapterDetail({ chapter, save, world }: { chapter: Chapter; save: Save; world: World }) {
  const p = save.story?.[chapter.id];
  const cleared = !!p?.clearedAt;
  const total = chapter.nodes.length;
  // 한 번이라도 닿은 장면은 계속 보인다: 다 읽음, 지금 위치까지, 또는 본문이 이미 쓰인 장면 ("처음부터"로 돌아가도 숨기지 않는다)
  const written = useBeats(chapter.id);
  const writtenSet = new Set((written ?? []).map((b) => b.index));
  const reached = (i: number) => cleared || (!!p && i <= p.beat) || writtenSet.has(i);

  const open = (fresh: boolean) => openChapter(chapter.id, p, fresh);

  return (
    <article className="st-detail">
      <header className="st-detail-head">
        <span className="kicker">CHAPTER {String(chapter.index).padStart(2, '0')}</span>
        <h2>{chapter.title}</h2>
        <p className={'st-teaser' + (p ? '' : ' muted')}>{p ? firstSentence(chapter.synopsis) : '아직 읽지 않은 이야기'}</p>
      </header>

      <div className="st-actions">
        {cleared ? (
          <>
            <p className="st-cleared">
              <span aria-hidden="true">✓</span> 다 읽음 · 보상 받음
            </p>
            <button type="button" className="btn btn-ghost" onClick={() => open(true)}>
              처음부터
            </button>
          </>
        ) : p ? (
          <>
            <button type="button" className="btn btn-primary" onClick={() => open(false)}>
              이어 읽기 <span className="mono">{Math.min(p.beat + 1, total)}/{total}</span>
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => open(true)}>
              처음부터
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => open(true)}>
            처음부터
          </button>
        )}
      </div>
      {!cleared && (
        <p className="small muted st-reward-note">
          처음 끝까지 읽으면 {world.currency.pull} +{fmt(STORY_CLEAR_REWARD)}
        </p>
      )}

      <div>
        <div className="page-section-head">
          <h2>장면</h2>
          <span className="mono muted">{total}</span>
        </div>
        <ol className="st-scenes">
          {chapter.nodes.map((n, i) => {
            const ok = reached(i);
            const here = !cleared && p?.beat === i;
            return (
              <li key={i} className={(ok ? 'is-reached' : 'is-locked') + (here ? ' is-here' : '')}>
                <span className="mono st-scene-no">{String(i + 1).padStart(2, '0')}</span>
                <span className="st-scene-title">{ok ? n.title : '???'}</span>
                {here && <span className="st-here mono">HERE</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </article>
  );
}
