// 그림 생성 요청/결과 타입 (index.ts에서 다시 내보낸다)

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
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
