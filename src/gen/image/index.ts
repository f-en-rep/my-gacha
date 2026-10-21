// 그림 생성 (계약). 구현은 이 폴더 안에서 한다.
import type { ImageProfile } from '../../types';
import type { ConnectionTestResult } from '../text';

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

export async function generateImage(_profile: ImageProfile, _req: ImageRequest): Promise<ImageResult> {
  throw new Error('not implemented');
}

/** 그림을 그리지 않고(돈·밴 위험 없이) 키와 연결만 확인 */
export async function testImageConnection(_profile: ImageProfile): Promise<ConnectionTestResult> {
  throw new Error('not implemented');
}
