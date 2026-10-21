import { useState } from 'react';
import { EmptyState } from '../common';
import { PageHint, Panel } from '../panel/Panel';
import { paths } from '../router';
import { useActiveGame, useCast } from '../../game/store';
import { CharacterList, type RarityFilter, type TagFilter } from '../characters/CharacterList';
import { CharacterDetail } from '../characters/CharacterDetail';

export function CharactersPanel({ id }: { id?: string }) {
  const { loading, world, save } = useActiveGame();
  const ready = world?.status === 'ready' ? world : undefined;
  const cast = useCast(ready?.id);
  const [rarity, setRarity] = useState<RarityFilter>('all');
  const [tag, setTag] = useState<TagFilter>('');

  const common = { name: 'characters' as const, code: 'OPERATORS', title: '캐릭터' };

  if (loading || (ready && !cast)) {
    return <Panel {...common} focus="left" left={<div className="skeleton-art tall" />} right={null} />;
  }

  if (!ready || !cast) {
    const empty = (
      <EmptyState title="플레이 중인 월드가 없습니다" badge="WORLD">
        <p>
          월드를 만들거나 고르면 캐스트가 여기 나옵니다. <a href={'#' + paths.world}>월드 패널로 가기</a>
        </p>
      </EmptyState>
    );
    return <Panel {...common} focus="left" left={empty} right={<PageHint>월드가 준비되면 고른 캐릭터의 프로필이 여기 펼쳐집니다.</PageHint>} />;
  }

  const index = id ? cast.findIndex((c) => c.id === id) : -1;
  const selected = index >= 0 ? cast[index] : undefined;

  return (
    <Panel
      {...common}
      focus={id ? 'right' : 'left'}
      back={paths.characters}
      left={
        <CharacterList
          world={ready}
          cast={cast}
          save={save}
          selectedId={selected?.id}
          rarity={rarity}
          tag={tag}
          onRarity={setRarity}
          onTag={setTag}
        />
      }
      right={
        selected ? (
          <CharacterDetail character={selected} save={save} no={index + 1} />
        ) : id ? (
          <EmptyState title="캐릭터를 찾을 수 없습니다">
            <p>
              이 월드에 없는 캐릭터입니다. <a href={'#' + paths.characters}>목록으로</a>
            </p>
          </EmptyState>
        ) : (
          <PageHint>왼쪽에서 캐릭터를 고르면 프로필이 여기 펼쳐집니다.</PageHint>
        )
      }
    />
  );
}
