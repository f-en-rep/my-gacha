// 프롬프트 미리 보기용 예시 데이터. 월드가 없을 때 쓰고, 테스트도 같이 쓴다.
import type { Chapter, Character, ChatLine, Location, World } from '../../types';

const T = '2026-01-01T00:00:00.000Z';

export const SAMPLE_WORLD: World = {
  id: 'sample_world',
  schemaVersion: 1,
  name: '아스트라',
  language: 'ko',
  description: '하늘에 뜬 섬들 위에 세워진 마도 공학 도시. 섬을 띄우는 결정이 조금씩 빛을 잃어 가고 있다.',
  scenario: '플레이어는 변두리 섬의 수비대에 새로 부임한 지휘관이다.',
  directives: '너무 어둡지 않게. 세 챕터마다 큰 반전이 하나 있다.',
  tags: {
    position: ['근거리', '원거리'],
    role: ['딜러', '방어형', '치료', '지원', '군중제어', '소환'],
    element: ['불꽃', '서리', '전격', '공허'],
    trait: ['신입', '숙련', '베테랑', '엘리트'],
  },
  currency: { pull: '성석', shop: '자격증' },
  art: { positiveTags: 'masterpiece, best quality', negativeTags: 'lowres' },
  status: 'ready',
  createdAt: T,
  updatedAt: T,
};

function sampleChar(id: string, name: string, rarity: 3 | 4 | 5 | 6, role: string, element: string, extra: Partial<Character> = {}): Character {
  return {
    id,
    worldId: SAMPLE_WORLD.id,
    name,
    rarity,
    tags: { position: rarity >= 5 ? '근거리' : '원거리', role: [role], element, trait: [SAMPLE_WORLD.tags.trait[rarity - 3] ?? ''] },
    appearance: `${name}은(는) 은발에 푸른 눈을 가졌다. 낡은 수비대 코트를 입는다.`,
    imageTags: '1girl, silver hair, long hair, blue eyes, military coat, gloves, sword',
    personality: `${name}은(는) 침착하고 말수가 적지만 동료를 아낀다.`,
    background: `${name}은(는) 섬이 처음 흔들리던 날부터 수비대에 있었다.`,
    quotes: ['지휘관, 오늘도 무사히 돌아오세요.', '이 섬은 제가 지킵니다.'],
    detail: rarity >= 5 ? 'full' : 'light',
    createdAt: T,
    updatedAt: T,
    ...extra,
  };
}

export const SAMPLE_CAST: Character[] = [
  sampleChar('sample_c1', '아린', 6, '딜러', '불꽃'),
  sampleChar('sample_c2', '세레나', 5, '치료', '서리', {
    origin: { kind: 'card', fileName: 'serena.png', spec: 'chara_card_v2', scenario: '세레나는 성당의 견습 사제였다.', greeting: '어서 오세요. 다치신 곳은 없나요?' },
  }),
  sampleChar('sample_c3', '카이', 4, '방어형', '전격'),
];

export const SAMPLE_LOCATIONS: Location[] = [
  { id: 'sample_l1', worldId: SAMPLE_WORLD.id, name: '변두리 초소', description: '바람이 거센 섬 끝의 낡은 초소.', imageTags: 'outpost, cliff, sky', createdAt: T },
];

export const SAMPLE_CHAPTERS: Chapter[] = [
  {
    id: 'sample_ch1',
    worldId: SAMPLE_WORLD.id,
    index: 1,
    title: '흔들리는 섬',
    synopsis: '지휘관이 부임한 날, 섬이 크게 흔들린다. 아린과 함께 결정실로 향한다.',
    nodes: [
      { title: '부임', guide: '지휘관이 초소에 도착해 아린을 만난다. 어색한 첫인사.', castIds: ['sample_c1'], locationId: 'sample_l1' },
      { title: '흔들림', guide: '섬이 흔들리고 경보가 울린다. 두 사람이 결정실로 달린다.', castIds: ['sample_c1', 'sample_c3'], locationId: 'sample_l1' },
      { title: '빛을 잃은 결정', guide: '결정실에서 빛이 흐려진 결정을 발견한다. 다음 챕터로 이어지는 의문.', castIds: ['sample_c1'], locationId: 'sample_l1' },
    ],
    summary: '지휘관이 부임했고, 섬이 흔들렸다. 결정의 빛이 흐려진 것을 아린과 함께 확인했다.',
    ledger: '결정이 약해지고 있다는 사실이 드러났다.',
    status: 'complete',
    createdAt: T,
    updatedAt: T,
  },
];

export const SAMPLE_CHAT: ChatLine[] = [
  { saveId: 'sample_save', characterId: 'sample_c1', role: 'user', text: '안녕, 아린. 오늘 순찰은 어땠어?', at: T },
  { saveId: 'sample_save', characterId: 'sample_c1', role: 'char', text: '조용했어요. 바람이 조금 셌을 뿐.', at: T },
  { saveId: 'sample_save', characterId: 'sample_c1', role: 'user', text: '다행이다. 같이 차라도 마실래?', at: T },
];

export const SAMPLE_CARD = {
  name: '리라',
  description: '리라는 떠돌이 음유시인이다. 붉은 머리를 땋아 내리고, 낡은 류트를 등에 멘다.',
  personality: '밝고 장난스럽지만 노래할 때만큼은 진지하다.',
  scenario: '여관에서 처음 만난다.',
  firstMes: '어머, 새 손님이네? 노래 한 곡 들어 볼래?',
  alternateGreetings: ['오늘은 무슨 노래를 할까?'],
  mesExample: '<START>\n리라: "박자는 마음으로 맞추는 거야."',
  tags: ['bard', 'fantasy'],
};
