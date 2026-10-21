// 대화 패널: 왼쪽은 보유한 캐릭터 목록, 오른쪽은 고른 캐릭터와의 1:1 대화.
import { EmptyState } from '../common';
import { Panel, PageHint } from '../panel/Panel';
import { paths } from '../router';
import { useLiveQuery, useSettings } from '../hooks';
import { useActiveGame, useCast } from '../../game/store';
import { db } from '../../db';
import { bondLevel, bondTitle, claimableLevels } from '../../core/bond';
import type { Character, ChatLine, Id, Save } from '../../types';
import { Portrait } from '../characters/Portrait';
import { ChatRoom } from './ChatRoom';
import { useChatRun } from './runner';
import './chat.css';

/** 세이브의 캐릭터별 마지막 대화 줄 */
function useLastLines(saveId: Id | undefined): Map<Id, ChatLine> | undefined {
  return useLiveQuery(async () => {
    const out = new Map<Id, ChatLine>();
    if (!saveId) return out;
    await db.chatLines
      .where('saveId')
      .equals(saveId)
      .reverse()
      .each((l) => {
        if (!out.has(l.characterId)) out.set(l.characterId, l);
      });
    return out;
  }, [saveId]);
}

export function ChatPanel({ characterId }: { characterId?: string }) {
  const { loading, world, save } = useActiveGame();
  const ready = world?.status === 'ready' ? world : undefined;
  const cast = useCast(ready?.id);
  const lastLines = useLastLines(save?.id);
  const settings = useSettings();
  const hasText = !!(settings.routing.prose || settings.routing.structured);

  if (loading) return <Panel name="chat" code="TALK" title="대화" left={null} right={null} />;

  if (!ready || !save) {
    return (
      <Panel
        name="chat"
        code="TALK"
        title="대화"
        focus="left"
        left={
          <EmptyState title="플레이 중인 월드가 없습니다">
            <p>
              대화는 월드의 캐릭터와 나눕니다. 먼저 월드를 만들거나 골라 주세요. <a href={'#' + paths.world}>월드 패널 열기</a>
            </p>
          </EmptyState>
        }
        right={<PageHint>월드가 준비되면 여기에서 캐릭터와 대화합니다.</PageHint>}
      />
    );
  }

  const owned = (cast ?? []).filter((c) => save.owned[c.id]);
  // 최근에 대화한 캐릭터가 위로, 대화가 없으면 희귀도 순 (cast가 이미 희귀도 순)
  const sorted = owned
    .map((c, i) => ({ c, i, at: lastLines?.get(c.id)?.at ?? '' }))
    .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at < b.at ? 1 : -1))
    .map((x) => x.c);
  const selected = characterId ? owned.find((c) => c.id === characterId) : undefined;

  return (
    <Panel
      name="chat"
      code="TALK"
      title="대화"
      focus={characterId ? 'right' : 'left'}
      back={paths.chat()}
      left={<ChatList characters={sorted} save={save} lastLines={lastLines} selectedId={selected?.id} loaded={!!cast} />}
      right={
        !cast ? null : selected ? (
          <ChatRoom key={selected.id} character={selected} save={save} world={ready} hasText={hasText} />
        ) : characterId ? (
          <PageHint>
            {cast.some((c) => c.id === characterId) ? '아직 만나지 못한 캐릭터와는 대화할 수 없어요.' : '캐릭터를 찾을 수 없습니다.'}{' '}
            <a href={'#' + paths.chat()}>목록으로</a>
          </PageHint>
        ) : (
          <PageHint>{owned.length ? '왼쪽에서 대화할 캐릭터를 고르세요.' : '캐릭터를 뽑으면 여기에서 대화할 수 있어요.'}</PageHint>
        )
      }
    />
  );
}

function ChatList({
  characters,
  save,
  lastLines,
  selectedId,
  loaded,
}: {
  characters: Character[];
  save: Save;
  lastLines: Map<Id, ChatLine> | undefined;
  selectedId?: Id;
  loaded: boolean;
}) {
  if (!loaded) return null;
  if (!characters.length) {
    return (
      <EmptyState title="뽑은 캐릭터와 대화할 수 있어요">
        <p>
          아직 만난 캐릭터가 없습니다. 뽑기에서 첫 동료를 만나 보세요. <a href={'#' + paths.pull}>뽑기로 가기</a>
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      <div>
        <div className="page-section-head">
          <h2>대화 상대</h2>
          <span className="mono muted">{characters.length}</span>
        </div>
        <ul className="menu-list ch-list">
          {characters.map((c) => (
            <ChatListRow key={c.id} character={c} save={save} last={lastLines?.get(c.id)} selected={c.id === selectedId} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ChatListRow({ character: c, save, last, selected }: { character: Character; save: Save; last?: ChatLine; selected: boolean }) {
  const bond = save.bonds?.[c.id];
  const lv = bondLevel(bond?.points ?? 0).level;
  const reward = claimableLevels(bond).length > 0;
  const run = useChatRun(save.id, c.id);
  const preview = run.replying ? '답을 쓰는 중…' : last ? (last.role === 'user' ? '나: ' : '') + last.text.replace(/\s+/g, ' ') : '아직 나눈 대화가 없어요';
  return (
    <li>
      <a className="menu-row ch-row" href={'#' + paths.chat(c.id)} aria-current={selected ? 'true' : undefined}>
        <span className={'ch-row-art r' + c.rarity}>
          <Portrait assetId={c.portraitId} alt="" rarity={c.rarity} className="ch-avatar-img" silhouetteClass="ch-silhouette" />
        </span>
        <span className="menu-row-text ch-row-text">
          <span className="ch-row-top">
            <strong>{c.name}</strong>
            <span className="ch-row-bond mono">
              Lv.{lv} <span className="ch-row-title">{bondTitle(lv)}</span>
            </span>
          </span>
          <small className={'ch-row-preview' + (last || run.replying ? '' : ' is-empty')}>{preview}</small>
        </span>
        {reward && <span className="ch-dot" role="img" aria-label="받을 보상 있음" />}
      </a>
    </li>
  );
}
