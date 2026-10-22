// 프롬프트 미리 보기: 지금 월드(없으면 예시 데이터)로 실제 메시지를 만들고, 칸마다 들어간 글을 기록한다.
import type { ChatMessage } from '../text';
import type { Chapter, Character, ChatLine, Location, LoreEntry, PlayerProfile, World } from '../../types';
import { formatKnownLore } from '../../game/lore';
import { formatPlayer } from '../../game/player';
import { bondStance } from '../../core/bond';
import { bannerMetaMessages, cardMessages, characterMessages, setupMessages } from '../world/prompts';
import { beatMessages, finishMessages, formatStorySoFar, planMessages } from '../story/prompts';
import { chatMessages } from '../chat/prompts';
import type { PromptId } from './registry';
import type { SectionOverrides, TraceEntry } from './template';
import { SAMPLE_CARD, SAMPLE_CAST, SAMPLE_CHAPTERS, SAMPLE_CHAT, SAMPLE_LOCATIONS, SAMPLE_WORLD } from './sample';

export interface PreviewData {
  world: World;
  /** 첫 캐릭터가 주인공 (대화 상대, 새 캐릭터 희귀도 기준) */
  cast: Character[];
  chapters: Chapter[];
  locations: Location[];
  history: ChatLine[];
  playerName?: string;
  /** 내 프로필 (플레이 중인 세이브) */
  player?: PlayerProfile;
  /** 기록 (인물·물건이 계획·장면·마무리에 들어간다) */
  lore?: LoreEntry[];
  /** 예시 데이터인지 */
  sample: boolean;
}

export const SAMPLE_PREVIEW: PreviewData = {
  world: SAMPLE_WORLD,
  cast: SAMPLE_CAST,
  chapters: SAMPLE_CHAPTERS,
  locations: SAMPLE_LOCATIONS,
  history: SAMPLE_CHAT,
  sample: true,
};

/** 미리 보기의 장면 수 (스토리 생성과 같게) */
const NODES = 6;

/** 월드에 챕터가 없으면 예시 챕터의 등장인물을 이 월드 캐스트로 바꿔 쓴다 */
function chapterFor(d: PreviewData): Chapter {
  const done = [...d.chapters].sort((a, b) => b.index - a.index).find((c) => c.nodes.length > 0);
  if (done) return done;
  const sample = SAMPLE_CHAPTERS[0]!;
  const ids = new Map(SAMPLE_CAST.map((c, i) => [c.id, d.cast[i]?.id ?? '']));
  return { ...sample, worldId: d.world.id, nodes: sample.nodes.map((n) => ({ ...n, castIds: n.castIds.map((id) => ids.get(id) ?? '').filter(Boolean) })) };
}

export function previewMessages(id: PromptId, overrides: SectionOverrides | undefined, d: PreviewData): { messages: ChatMessage[]; trace: TraceEntry[] } {
  const trace: TraceEntry[] = [];
  const ctx = { overrides, trace };
  const { world, cast } = d;
  const lead = cast[0];
  const lore = formatKnownLore(d.lore ?? []);
  const me = { playerName: d.playerName, player: d.player };
  const messages = ((): ChatMessage[] => {
    switch (id) {
      case 'world-setup':
        return setupMessages(world, { askName: true, askArt: true }, ctx);
      case 'characters':
        return characterMessages(world, cast, { rarity: lead?.rarity ?? 6, count: 1, detail: 'full', index: 1 }, ctx);
      case 'card':
        return cardMessages(world, cast, SAMPLE_CARD, { askRarity: true }, ctx);
      case 'banner':
        return bannerMetaMessages(world, { featuredNames: cast.slice(0, 2).map((c) => c.name) }, ctx);
      case 'story-plan':
        return planMessages(
          { world, cast, locations: d.locations, chapterIndex: d.chapters.length + 1, nodeCount: NODES, storySoFar: formatStorySoFar(d.chapters, 4), lore, player: formatPlayer(me) },
          ctx,
        );
      case 'story-beat': {
        const chapter = chapterFor(d);
        const index = Math.min(1, chapter.nodes.length - 1);
        const node = chapter.nodes[index]!;
        return beatMessages(
          {
            world,
            chapter,
            index,
            cast: cast.filter((c) => node.castIds.includes(c.id)),
            location: d.locations.find((l) => l.id === node.locationId) ?? d.locations[0],
            previousTail: index > 0 ? ['(이전 장면의 마지막 몇 줄)'] : [],
            storySoFar: formatStorySoFar(d.chapters.filter((c) => c.index < chapter.index), 2),
            lore,
            player: formatPlayer(me),
          },
          ctx,
        );
      }
      case 'story-finish': {
        const chapter = chapterFor(d);
        return finishMessages(
          {
            world,
            chapter,
            scenes: chapter.nodes.map((n) => ({ title: n.title, lines: ['(이 장면의 대본)'] })),
            storySoFar: formatStorySoFar(d.chapters.filter((c) => c.index < chapter.index), 2),
            castNames: cast.map((c) => c.name),
            known: lore,
          },
          ctx,
        );
      }
      case 'chat': {
        const c = lead ?? SAMPLE_CAST[0]!;
        return chatMessages(
          { world, character: c, playerName: d.playerName, player: formatPlayer(me, { name: false }), stance: bondStance(1), level: 1, storySoFar: formatStorySoFar(d.chapters, 2), history: d.history },
          ctx,
        );
      }
    }
  })();
  return { messages, trace };
}
