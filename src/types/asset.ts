import type { Id } from './world';

export interface Asset {
  id: Id;
  worldId: Id;
  /** 보통 image/webp */
  mime: string;
  blob: Blob;
  width: number;
  height: number;
  /** 그릴 때 쓴 프롬프트와 시드. 다시 그리기용 */
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  provider?: string;
  createdAt: string;
}
