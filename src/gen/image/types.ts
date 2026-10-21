// 그림 생성 요청/결과 타입 (index.ts에서 다시 내보낸다)

/** 캐릭터 한 명분 프롬프트 (NovelAI V4 이상의 캐릭터 슬롯) */
export interface CharacterPrompt {
  prompt: string;
  negative?: string;
}

export interface ImageRequest {
  /** 장면·화풍 같은 공통 프롬프트 (NovelAI V4: base caption) */
  prompt: string;
  negativePrompt?: string;
  /** 캐릭터마다 따로 넣을 프롬프트. 슬롯이 없는 모델은 공통 프롬프트 뒤에 이어 붙인다 */
  characters?: CharacterPrompt[];
  width?: number;
  height?: number;
  seed?: number;
  signal?: AbortSignal;
}

export interface ImageResult {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  seed: number;
  prompt: string;
  negativePrompt: string;
}
