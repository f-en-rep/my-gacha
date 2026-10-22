// AI에게 보내는 글 프롬프트 목록. 기본 글은 지금까지 쓰던 문구 그대로다 (golden.test 스냅숏으로 확인).
// 그림 프롬프트는 여기 없다 (연결 설정·캐릭터 화면에서 따로 고친다).
import type { PromptSection, PromptTemplate, PlaceholderDoc } from './template';

export type PromptId = 'world-setup' | 'characters' | 'card' | 'banner' | 'story-plan' | 'story-beat' | 'story-finish' | 'chat';

/** 사용자가 고친 프롬프트: 프롬프트 id → 칸 key → 글 */
export type PromptOverrides = Partial<Record<PromptId, Record<string, string>>>;

const JSON_ONLY_TEXT = 'Always answer with a single JSON object only — no explanations, no markdown, no code fences.';

const edit = (msg: PromptSection['msg'], key: string, label: string, text: string, hint?: string): PromptSection => ({ key, kind: 'edit', msg, label, text, hint });
const lock = (msg: PromptSection['msg'], key: string, label: string, hint?: string): PromptSection => ({ key, kind: 'lock', msg, label, hint });
const data = (msg: PromptSection['msg'], key: string, label: string, hint?: string): PromptSection => ({ key, kind: 'data', msg, label, hint });

const persona = (text: string) => edit('system', 'persona', '역할 (시스템)', text);
const jsonOnly = lock('system', 'jsonOnly', 'JSON만 답하기', '역할 글 뒤에 띄어쓰기 하나로 붙어요. 답을 JSON으로 읽기 때문에 고정');
const task = lock('user', 'task', '작업 표시', '어떤 작업인지 알리는 머리표. 앱과 테스트가 이걸로 작업을 구분해요');

const V = {
  language: { name: 'language', desc: '월드 언어 이름 (예: Korean (한국어))' },
  world: { name: 'world', desc: '월드 이름' },
} satisfies Record<string, PlaceholderDoc>;

const WORLD_PERSONA =
  'You are the lead writer and game designer of an anime-style gacha game (think Arknights). ' +
  'You design coherent worlds and memorable, visually distinct characters.';

const IMAGE_TAGS_RULE =
  '- "imageTags": ENGLISH danbooru-style tags, comma-separated, 10–25 tags, describing only PERMANENT visual traits: start with a subject count tag (1girl, 1boy or 1other), then hair colour/length/style, eye colour, body build/age look, signature outfit pieces, accessories/weapons. No pose, expression, camera, background or quality tags. Must match the appearance text.';

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'world-setup',
    title: '세계 설정',
    description: '새 월드를 만들 때 처음 한 번. 이름, 역할·속성·특징 태그, 재화 이름, 화풍, 상시 배너 이름을 정해요.',
    vars: [
      V.language,
      V.world,
      { name: 'artNote', desc: '화풍도 물을 때만 붙는 "artStyle은 영어 태그" 예외 문구, 아니면 빈 칸' },
      { name: 'roleMin', desc: '역할 수 최소' },
      { name: 'roleMax', desc: '역할 수 최대' },
      { name: 'elementMin', desc: '속성 수 최소' },
      { name: 'elementMax', desc: '속성 수 최대' },
      { name: 'traitsExample', desc: '특징 이름 예시 (JSON 배열)' },
    ],
    sections: [
      persona(WORLD_PERSONA),
      jsonOnly,
      task,
      data('user', 'world', '월드 정보', '이름, 설명, 시작 상황, 작가 지시문'),
      edit('user', 'language', '언어 지시', 'Write all names and labels in {{language}}{{artNote}}.'),
      lock('user', 'fields', 'JSON 필드 틀', '필드 이름과 형식. 아래 필드 설명이 이 틀 안 "—" 뒤에 들어가요'),
      edit('user', 'fieldName', '필드 설명 · name', 'a short, evocative name for this world', '월드 이름을 비워 뒀을 때만'),
      edit('user', 'fieldPosition', '필드 설명 · position', 'the two words for melee / ranged fighters', '언어에 정해진 근거리·원거리 말이 없을 때만'),
      edit(
        'user',
        'fieldRoles',
        '필드 설명 · roles',
        '{{roleMin}}–{{roleMax}} combat role names (e.g. damage dealer, defender, healer, support, crowd control, summoner, sniper, specialist). Short, clear words a player instantly understands; flavour them to the world only lightly.',
      ),
      edit(
        'user',
        'fieldElements',
        '필드 설명 · elements',
        '{{elementMin}}–{{elementMax}} elements/affinities that fit this world (they need not be classic fire/water; e.g. a cyberpunk world might use voltage, toxin ...). One or two words each.',
      ),
      edit(
        'user',
        'fieldTraits',
        '필드 설명 · traits',
        'exactly 4 seniority/rank labels in rarity order [3★, 4★, 5★, 6★], e.g. {{traitsExample}}. Keep them simple; flavour to the world is fine.',
      ),
      edit(
        'user',
        'fieldCurrency',
        '필드 설명 · currency',
        '"pull" is the precious currency spent on gacha pulls; "shop" is the token earned from duplicate characters. Names that fit the world.',
      ),
      edit(
        'user',
        'fieldArt',
        '필드 설명 · artStyle',
        'image-generation style tags for an anime model (NovelAI / danbooru tag style). ' +
          '"positive": 8–20 English comma-separated tags describing medium, rendering and mood that suit the world (e.g. "masterpiece, best quality, anime coloring, detailed background, soft lighting, ..."); NO character or subject tags. ' +
          '"negative": 5–15 English comma-separated tags to avoid (e.g. "lowres, bad anatomy, bad hands, text, watermark, ...").',
        '화풍을 비워 뒀을 때만',
      ),
      edit('user', 'fieldBanner', '필드 설명 · standardBannerName', 'name of the always-open standard recruitment banner.'),
    ],
  },
  {
    id: 'characters',
    title: '캐릭터 만들기',
    description: '월드 생성, 새 배너, 직접 만들기의 "AI로 채우기"에서 캐릭터 시트를 만들어요.',
    vars: [
      V.language,
      V.world,
      { name: 'rarity', desc: '희귀도 숫자 (3~6)' },
      { name: 'count', desc: '이번에 만들 인원' },
      { name: 'indexNote', desc: '한 명씩 만들 때 몇 번째인지 (예: " (6★ #2)"), 아니면 빈 칸' },
      { name: 'roles', desc: '아직 적게 쓰인 역할들' },
      { name: 'elements', desc: '아직 적게 쓰인 속성들' },
      { name: 'positions', desc: '아직 적게 쓰인 위치들' },
      { name: 'theme', desc: '새 배너 주제 (플레이어가 적은 글)' },
      { name: 'name', desc: '플레이어가 정한 이름' },
      { name: 'concept', desc: '플레이어가 적은 한 줄 설명' },
    ],
    sections: [
      persona(WORLD_PERSONA),
      jsonOnly,
      task,
      data('user', 'world', '월드 정보'),
      lock('user', 'catalog', '태그 목록', '고를 수 있는 태그 값. 답을 이 값과 맞춰 보기 때문에 고정'),
      edit('user', 'castIntro', '기존 캐스트 머리말', 'Existing cast (do NOT reuse these names; make the new character(s) clearly distinct in name, role, silhouette, hair colour/style and outfit):', '바로 아래 줄에 캐스트 목록이 붙어요'),
      data('user', 'cast', '기존 캐스트 목록'),
      edit('user', 'castNone', '캐스트가 없을 때', 'Existing cast: none yet. This is the first character.'),
      edit('user', 'balance', '고르게 퍼지게', 'Under-used so far — prefer these when they fit: roles {{roles}}; elements {{elements}}; position {{positions}}.', '캐스트가 있을 때만'),
      edit(
        'user',
        'theme',
        '배너 주제',
        'Theme of the new recruitment banner (written by the player — follow it): {{theme}}\nDesign the new character(s) around this theme (look, outfit, story hook) while keeping them consistent with the world and the tag catalog.',
        '새 배너 주제가 있을 때만',
      ),
      edit('user', 'fixedName', '정해 둔 이름', 'The character\'s name is fixed by the player: "{{name}}". Use exactly this name.', '직접 만들기에서 이름을 적었을 때만'),
      edit('user', 'concept', '한 줄 설명', 'Character concept from the player (follow it): {{concept}}', '직접 만들기에서 설명을 적었을 때만'),
      edit('user', 'createOne', '한 명 만들기', 'Create ONE new {{rarity}}★ character{{indexNote}}.'),
      edit('user', 'createMany', '여러 명 만들기', 'Create {{count}} new {{rarity}}★ characters in one go. They must clearly differ from each other in name, gender/age mix, role, element, position and silhouette.'),
      edit('user', 'rarity6', '6★ 느낌', 'top-tier legend of this world: iconic, central to the story, with a striking signature look and a dramatic past.', '"Rarity 6★ (rank label …): " 뒤에 붙어요'),
      edit('user', 'rarity5', '5★ 느낌', 'notable elite: highly capable, with a clear specialty, strong personality and their own agenda.'),
      edit('user', 'rarity4', '4★ 느낌', 'dependable regular: competent and likeable, with one memorable quirk.'),
      edit('user', 'rarity3', '3★ 느낌', 'rookie or ordinary member: humble, simple, still charming and visually distinct.'),
      edit('user', 'langRule', '규칙 · 언어', '- Write name, appearance, personality, background and quotes in {{language}}.', '"Field rules:" 아래 첫 줄'),
      lock('user', 'tagRule', '규칙 · 태그 값', '태그 칸은 목록 값 그대로'),
      lock('user', 'archetypeRule', '규칙 · 전투 유형', '정해진 유형 이름 중 하나'),
      edit(
        'user',
        'lengthsFull',
        '규칙 · 분량 (6★·5★)',
        [
          '- "appearance": 3–5 sentences: face, hair, eyes, build, signature outfit, accessories, overall silhouette.',
          '- "personality": 2–4 sentences.',
          '- "background": 4–8 sentences (one or two short paragraphs): origin, role in the world, a hook tied to the scenario.',
          '- "quotes": 3–5 short in-character lines (string array).',
        ].join('\n'),
      ),
      edit(
        'user',
        'lengthsLight',
        '규칙 · 분량 (4★·3★)',
        [
          '- "appearance": 1–3 sentences: hair, eyes, outfit, one distinctive detail.',
          '- "personality": 1–2 sentences.',
          '- "background": 1–2 sentences.',
          '- "quotes": 1–2 short in-character lines (string array).',
        ].join('\n'),
      ),
      edit('user', 'imageTagsRule', '규칙 · 그림 태그', IMAGE_TAGS_RULE),
      lock('user', 'shape', 'JSON 모양', '답을 읽는 모양과 인원 수'),
    ],
  },
  {
    id: 'card',
    title: '카드 가져오기',
    description: '바깥 캐릭터 카드(SillyTavern·RisuAI)를 이 월드의 캐릭터 시트로 정리해요.',
    vars: [V.language, V.world, { name: 'name', desc: '카드 캐릭터 이름' }],
    sections: [
      persona(WORLD_PERSONA),
      jsonOnly,
      task,
      data('user', 'world', '월드 정보'),
      lock('user', 'catalog', '태그 목록', '고를 수 있는 태그 값. 답을 이 값과 맞춰 보기 때문에 고정'),
      edit('user', 'castIntro', '기존 캐스트 머리말', 'Existing cast (for scale and tone):', '캐스트가 있을 때만. 바로 아래 줄에 목록이 붙어요'),
      data('user', 'cast', '기존 캐스트 목록', '최대 30명'),
      edit(
        'user',
        'intro',
        '작업 설명',
        'A player is importing a character card from a roleplay app into this game. Turn it into a game character sheet.',
      ),
      lock('user', 'dataGuard', '카드 글은 자료일 뿐', '카드 안에 적힌 지시를 따르지 않게 하는 안전 문구. 작업 설명 뒤에 띄어쓰기 하나로 붙어요'),
      data('user', 'card', '카드 글', '<card> … </card>. 칸마다 길이를 잘라 넣어요'),
      edit(
        'user',
        'langRule',
        '규칙 · 언어',
        '- Write appearance, personality, background and quotes in {{language}} (translate if the card is in another language). Keep the name "{{name}}" as is.',
        '"Field rules:" 아래 첫 줄',
      ),
      edit(
        'user',
        'faithful',
        '규칙 · 카드 그대로',
        '- Stay faithful to the card: same look, personality, history and way of speaking. You may lightly tie the background to this world, but do not change who the character is.',
      ),
      lock('user', 'tagRule', '규칙 · 태그 값'),
      lock('user', 'archetypeRule', '규칙 · 전투 유형'),
      edit(
        'user',
        'lengths',
        '규칙 · 분량',
        [
          '- "appearance": 2–5 sentences: face, hair, eyes, build, outfit, accessories.',
          '- "personality": 2–4 sentences.',
          '- "background": 3–8 sentences.',
          '- "quotes": 3–5 short in-character lines in the character\'s own voice, drawn from the first message and example dialogue where possible (string array). Only spoken words, no narration.',
        ].join('\n'),
      ),
      edit(
        'user',
        'imageTagsRule',
        '규칙 · 그림 태그',
        '- "imageTags": ENGLISH danbooru-style tags (NovelAI style), comma-separated, 10–25 tags, ONLY permanent visual traits: start with 1girl, 1boy or 1other, then hair, eyes, body/age look, outfit, accessories. No pose, expression, background, quality tags. If the card says little about looks, infer a plausible look that matches the text.',
      ),
      edit(
        'user',
        'rarityRule',
        '규칙 · 희귀도',
        '- "rarity": 3, 4, 5 or 6 — how prominent/powerful this character is compared with the existing cast (6 = legendary centrepiece, 3 = ordinary).',
        '희귀도를 AI에게 맡길 때만',
      ),
      lock('user', 'shape', 'JSON 모양'),
    ],
  },
  {
    id: 'banner',
    title: '배너 이름·소개',
    description: '새 배너를 열 때 배너 이름과 짧은 소개를 지어요.',
    vars: [
      V.language,
      V.world,
      { name: 'kind', desc: '배너 종류 (영어 문구: an always-open standard … / a limited-time …)' },
      { name: 'featured', desc: '픽업 캐릭터 이름들 (6★ 먼저)' },
      { name: 'theme', desc: '새 배너 주제 (플레이어가 적은 글)' },
    ],
    sections: [
      persona(WORLD_PERSONA),
      jsonOnly,
      task,
      data('user', 'world', '월드 정보'),
      edit('user', 'opening', '배너 종류', 'We are opening {{kind}} in this game.'),
      edit('user', 'featured', '픽업 캐릭터', 'Featured (rate-up) characters: {{featured}}', '픽업이 있을 때'),
      edit('user', 'noFeatured', '픽업 없음', 'No featured characters chosen yet.', '픽업이 없을 때'),
      edit(
        'user',
        'theme',
        '배너 주제',
        'Theme of the new recruitment banner (written by the player — follow it): {{theme}}\nThe banner name and description must reflect this theme.',
        '주제가 있을 때만',
      ),
      edit('user', 'langRule', '규칙 · 언어', '- Write in {{language}}.', '"Field rules:" 아래 첫 줄'),
      edit('user', 'nameRule', '규칙 · 이름', '- "name": a short, catchy banner title (2–6 words), like gacha games use. No quotes, no rarity stars, no dates.'),
      edit('user', 'descRule', '규칙 · 소개', '- "description": 1–2 short sentences inviting the player, hinting at the featured characters and the theme.'),
      lock('user', 'shape', 'JSON 모양'),
    ],
  },
  {
    id: 'story-plan',
    title: '스토리 · 챕터 계획',
    description: '다음 챕터의 제목, 줄거리, 장면 목록(장면마다 지시, 등장인물, 장소)을 짜요.',
    vars: [
      V.language,
      V.world,
      { name: 'chapter', desc: '계획하는 챕터 번호' },
      { name: 'nodes', desc: '장면 수' },
      { name: 'halfCast', desc: '이번 챕터에 쓸 등장인물 수 상한 (캐스트 절반)' },
    ],
    sections: [
      persona(
        'You are the head writer of an anime-style gacha game (think Arknights) planning its main story chapter by chapter. ' +
          'You keep long-running continuity, honour the author directives exactly, and give every chapter a clear shape.',
      ),
      jsonOnly,
      task,
      data('user', 'world', '월드 정보', '작가 지시문은 언제나 그대로, 최우선'),
      lock('user', 'castRule', '캐스트 머리말', '이름을 캐스트 목록과 맞춰 보기 때문에 고정'),
      data('user', 'cast', '캐스트 목록'),
      data('user', 'locations', '장소 목록'),
      data('user', 'story', '지금까지의 이야기', '최근 4챕터는 요약 전체, 그 전은 한 줄씩'),
      edit('user', 'storyNone', '첫 챕터일 때', 'Story so far: nothing yet — this is the very first chapter.', '이야기가 아직 없을 때 "지금까지의 이야기" 대신'),
      data('user', 'lore', '알려진 인물·물건', '기록 패널의 인물·물건 (최근 것부터, 개수 제한). 있을 때만'),
      data('user', 'player', '플레이어', '내 프로필의 이름·소개·외형. 있을 때만'),
      edit('user', 'goal', '지시 · 첫 줄', 'Plan chapter {{chapter}}.'),
      edit('user', 'firstChapter', '지시 · 1챕터', '- This is chapter 1: introduce the premise of the starting scenario and the main situation the player is thrown into.', '1챕터일 때'),
      edit(
        'user',
        'continue',
        '지시 · 이어 쓰기',
        '- Continue directly from the story so far. Keep continuity: what happened stays happened, the dead stay dead, relationships carry over. Do not repeat earlier chapters.',
        '2챕터부터',
      ),
      edit(
        'user',
        'directives',
        '지시 · 작가 지시문',
        '- Re-read the author directives. If a directive is periodic or conditional (e.g. "someone dies every three chapters"), use the chapter numbers and the arc ledger above to decide whether chapter {{chapter}} must fulfil it, and if so plan it explicitly.',
      ),
      lock('user', 'nodeCount', '지시 · 장면 수', '답의 장면 수를 맞춰 보기 때문에 고정. 아래 "챕터 모양"이 띄어쓰기 하나로 붙어요'),
      edit('user', 'arc', '지시 · 챕터 모양', 'Together they form one chapter with a beginning, rising tension and a closing hook.'),
      edit(
        'user',
        'castLimit',
        '지시 · 등장인물 수',
        '- Use about half of the cast at most in this chapter (≤ {{halfCast}} different named characters), at most 3 named characters per node. A node with no named character (narration, unnamed extras, the player alone) is fine.',
      ),
      edit('user', 'reuseLocations', '지시 · 장소', '- Prefer reusing existing locations; invent a new one only when the story needs it.'),
      edit('user', 'synopsisRule', '지시 · 줄거리', '- synopsis: 3–5 sentences describing the whole chapter.'),
      edit('user', 'guideRule', '지시 · 장면 지시', '- node.guide: 2–4 sentences of instructions for the scene writer: what happens, the emotional turn, how it ends.'),
      lock('user', 'locationRule', '지시 · 장소 형식', '기존 장소 이름 또는 새 장소 객체'),
      edit('user', 'langRule', '지시 · 언어', '- Write title, synopsis, guides, location names and descriptions in {{language}}.', '아래 고정 문구가 띄어쓰기 하나로 붙어요'),
      lock('user', 'nameRule', '지시 · 이름·태그 형식', '캐릭터 이름은 목록 그대로, 그림 태그는 영어'),
      lock('user', 'shape', 'JSON 모양'),
    ],
  },
  {
    id: 'story-beat',
    title: '스토리 · 장면 쓰기',
    description: '계획한 장면 하나의 본문(지문, 대사, 속마음)을 써요.',
    vars: [
      V.language,
      V.world,
      { name: 'chapter', desc: '챕터 번호' },
      { name: 'scene', desc: '이번 장면 번호' },
      { name: 'scenes', desc: '이 챕터의 장면 수' },
      { name: 'next', desc: '다음 장면 지시의 첫 문장' },
      { name: 'maxNarration', desc: '지문 한 토막 최대 글자 수' },
    ],
    sections: [
      persona(
        'You are the scenario writer of an anime-style gacha game, writing visual-novel scenes (think Arknights or Blue Archive story mode). ' +
          'Your prose is vivid but easy to read on a phone, characters sound like themselves, and every scene moves the story.',
      ),
      jsonOnly,
      task,
      data('user', 'world', '월드 정보 (짧게)'),
      data('user', 'story', '이전 챕터들', '최근 2챕터 요약'),
      data('user', 'lore', '알려진 인물·물건', '기록 패널의 인물·물건 (최근 것부터, 개수 제한). 있을 때만'),
      data('user', 'player', '플레이어', '내 프로필의 이름·소개·외형. 있을 때만'),
      data('user', 'chapter', '이번 챕터', '제목과 줄거리'),
      data('user', 'earlier', '이미 쓴 장면들'),
      edit('user', 'firstScene', '첫 장면일 때', 'This is the first scene of the chapter.'),
      edit('user', 'tailIntro', '이전 장면 끝 머리말', 'The previous scene ended like this (continue seamlessly from here):', '바로 아래 줄에 이전 장면의 마지막 몇 줄이 붙어요'),
      data('user', 'tail', '이전 장면의 끝'),
      data('user', 'scene', '이번 장면', '제목, 지시, 장소'),
      data('user', 'cast', '이번 장면 등장인물', '캐릭터 시트 (성격, 외형, 말투 예시)'),
      edit('user', 'noCast', '등장인물이 없을 때', 'No named cast member appears in this scene; use narration and, if needed, unnamed extras.'),
      edit('user', 'nextDirection', '다음 장면으로', 'Direction for the ending (do NOT reveal or start it, just lead toward it): the next scene will be about — {{next}}'),
      edit('user', 'lastScene', '마지막 장면일 때', 'This is the last scene of the chapter: close the chapter with a satisfying beat and a hook for what comes next.'),
      lock('user', 'segmentCount', '규칙 · 토막 수', '"Rules:" 아래 첫 줄. 답의 토막 수를 맞춰 보기 때문에 고정. 아래 "호흡"이 띄어쓰기 하나로 붙어요'),
      edit(
        'user',
        'pacing',
        '규칙 · 호흡',
        'Visual-novel pacing: each segment is ONE beat of action or ONE line of dialogue, short (narration ≤ 2 sentences, under {{maxNarration}} characters).',
      ),
      lock('user', 'kinds', '규칙 · 토막 종류', 'narration / line / thought. 화면이 이 구분으로 그려요'),
      lock('user', 'speaker', '규칙 · 말하는 사람', '캐스트 이름과 맞춰 보기 때문에 고정. 아래 "조연"이 띄어쓰기 하나로 붙어요'),
      edit(
        'user',
        'extras',
        '규칙 · 조연',
        'An unnamed or minor character may speak with a short descriptive name (e.g. "Guard"). Named cast members who are not listed for this scene should not appear.',
      ),
      edit('user', 'voice', '규칙 · 말투', '- Keep each character in voice (see voice samples). Show, do not tell. No meta commentary, no scene headings, no quotation marks around line text.'),
      edit('user', 'continuity', '규칙 · 연속성', '- Follow the author directives and stay consistent with the previous chapters.'),
      edit('user', 'langRule', '규칙 · 언어', '- Write all text and non-cast speaker names in {{language}}.'),
      lock('user', 'shape', 'JSON 모양'),
    ],
  },
  {
    id: 'story-finish',
    title: '스토리 · 챕터 요약',
    description: '다 쓴 챕터를 요약하고, 다음 챕터가 참고할 한 줄 장부와 기록(사건·인물·물건)을 남겨요.',
    vars: [V.language, V.world, { name: 'chapter', desc: '챕터 번호' }],
    sections: [
      persona('You are the story editor of an anime-style gacha game. You write precise recaps that later writers rely on for continuity.'),
      jsonOnly,
      task,
      data('user', 'directives', '작가 지시문', '있을 때만'),
      data('user', 'story', '이 챕터 전의 이야기'),
      data('user', 'chapter', '이번 챕터', '제목과 계획한 줄거리'),
      data('user', 'script', '챕터 대본 전체'),
      data('user', 'cast', '캐스트 이름', '인물 기록에 넣지 않을 이름들. 캐스트가 있을 때만'),
      data('user', 'known', '이미 있는 기록', '기록 패널의 인물·물건. 있을 때만'),
      edit(
        'user',
        'summaryRule',
        '쓸 것 · 요약',
        '- summary: 5–8 sentences. What actually happened (as written, not as planned), who changed and how (relationships, injuries, deaths, revelations, decisions), and open threads. Use character names.',
        '"Write:" 아래 첫 줄',
      ),
      edit(
        'user',
        'ledgerRule',
        '쓸 것 · 장부',
        '- ledger: ONE line stating what this chapter did to the overall arc (e.g. "X died; the alliance broke; the gate was found"). It will be used to keep periodic author directives on schedule, so mention any event a directive cares about.',
      ),
      edit('user', 'eventsRule', '쓸 것 · 사건', '- events: the 1–3 major events of this chapter, each with "name" (a short title) and "summary" (one or two short sentences).', '기록 패널 「사건」'),
      edit(
        'user',
        'peopleRule',
        '쓸 것 · 인물',
        '- people: named characters who appeared in this chapter but are NOT in the cast list (allies, rivals, officials, family, villains …), each with "name" and "summary" (one line: who they are and their part so far). Repeat an already recorded person only if something new was learned, using the exact same name. [] if none.',
        '기록 패널 「인물」. 캐스트 이름은 앱이 걸러 내요',
      ),
      edit(
        'user',
        'itemsRule',
        '쓸 것 · 물건',
        '- items: notable objects obtained, lost, used or sought in this chapter (artifacts, keys, documents, weapons …), each with "name" and "summary" (one line: what it is and where it stands now). Same-name rule as people. [] if none.',
        '기록 패널 「물건」',
      ),
      edit('user', 'langRule', '쓸 것 · 언어', '- Write all text in {{language}}.'),
      lock('user', 'shape', 'JSON 모양', '요약·장부·사건·인물·물건. 답을 이 모양으로 읽어요'),
    ],
  },
  {
    id: 'chat',
    title: '1:1 대화',
    description: '보유한 캐릭터와 나누는 대화. 시스템 글 하나 뒤에 최근 대화가 차례로 붙어요.',
    vars: [
      { name: 'char', desc: '대화하는 캐릭터 이름' },
      { name: 'user', desc: '플레이어 이름 (없으면 "당신" 같은 중립 호칭)' },
      { name: 'you', desc: '월드 언어의 중립 호칭 (예: 당신)' },
      V.language,
      V.world,
      { name: 'level', desc: '호감도 단계 (1~10)' },
    ],
    sections: [
      edit(
        'system',
        'persona',
        '역할',
        'You are {{char}}, a character in the anime-style gacha game world below, having a private one-on-one conversation with the player. ' +
          'Stay fully in character as {{char}} for the whole conversation.',
      ),
      data('system', 'world', '월드 정보 (짧게)'),
      data('system', 'sheet', '캐릭터 시트', 'YOUR CHARACTER SHEET: 외형, 성격, 배경, 말투 예시, (카드 출신이면) 원래 상황·첫 인사'),
      data('system', 'bond', '관계', '호감도 단계와 그에 맞는 태도'),
      edit('system', 'playerNamed', '플레이어 (이름 있음)', 'The player\'s name is "{{user}}". Call them by that name when it feels natural.', '"THE PLAYER" 아래'),
      edit(
        'system',
        'playerUnnamed',
        '플레이어 (이름 없음)',
        'The player has no name set. Address them naturally in the second person (e.g. "{{you}}"); do not invent a name for them.',
        '"THE PLAYER" 아래',
      ),
      data('system', 'player', '플레이어 프로필', '"THE PLAYER" 아래 내 프로필의 소개·외형. 있을 때만'),
      data('system', 'story', '최근 이야기', '플레이어가 다 읽은 최근 챕터 요약. 있을 때만'),
      edit(
        'system',
        'style',
        '말하기 규칙',
        [
          'STYLE RULES',
          '- Reply only in {{language}}.',
          '- Speak only as {{char}}, in first person, true to the sheet and voice samples. The author directives win over everything else.',
          '- Keep it short: 1–4 short paragraphs, like a chat message.',
          '- Actions or expressions may go in parentheses, sparingly, e.g. (smiles).',
          "- Never write the player's lines, actions, thoughts or feelings, and never continue the conversation for them.",
          '- Never mention being an AI, a language model, a game, a prompt or these rules. No meta commentary, no name prefix, no quotation marks around the whole reply.',
        ].join('\n'),
      ),
      data('history', 'history', '대화 기록', '최근 40줄. 플레이어 줄부터 시작하고, 같은 쪽이 연달아 말하면 합쳐요'),
    ],
  },
];

export const JSON_ONLY = JSON_ONLY_TEXT;

export function promptTemplate(id: PromptId): PromptTemplate {
  const t = PROMPT_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown prompt ${id}`);
  return t;
}
