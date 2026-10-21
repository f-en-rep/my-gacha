// 그림 생성 (계약). 구현은 이 폴더 안에서 한다.
//
// generateImage는 큐를 쓰지 않는다. 호출하는 쪽에서
//   enqueue(profile.id, () => generateImage(profile, req), { minIntervalMs: profile.minIntervalMs })
// 로 감싸거나, 그 일을 그대로 하는 paintQueued를 쓴다.
import type { ImageProfile } from '../../types';
import { enqueue, type JobPriority } from '../queue';
import type { ConnectionTestResult } from '../text';
import { generateNovelAI, testNovelAI } from './novelai';
import { generatePixAI, testPixAI } from './pixai';
import type { ImageRequest, ImageResult } from './types';

export type { ImageRequest, ImageResult } from './types';
export { toWebp } from './webp';
export { toImageError, randomSeed } from './common';
export { buildNovelAIBody, extractNovelAIImage, isNovelAIV4Model, NOVELAI_DEFAULT_MODEL } from './novelai';
export { buildPixAIParameters } from './pixai';

export async function generateImage(profile: ImageProfile, req: ImageRequest): Promise<ImageResult> {
  switch (profile.provider) {
    case 'novelai':
      return generateNovelAI(profile, req);
    case 'pixai':
      return generatePixAI(profile, req);
    default:
      throw new Error(`지원하지 않는 그림 서비스입니다: ${String((profile as { provider: unknown }).provider)}`);
  }
}

/** 그림을 그리지 않고(돈·밴 위험 없이) 키와 연결만 확인 */
export async function testImageConnection(profile: ImageProfile): Promise<ConnectionTestResult> {
  switch (profile.provider) {
    case 'novelai':
      return testNovelAI(profile);
    case 'pixai':
      return testPixAI(profile);
    default:
      return {
        ok: false,
        message: `지원하지 않는 그림 서비스입니다: ${String((profile as { provider: unknown }).provider)}`,
        ms: 0,
      };
  }
}

/** 연결별 큐(한 번에 하나, 최소 간격)를 거쳐 그린다. req.signal로 대기 중 취소 가능 */
export function paintQueued(
  profile: ImageProfile,
  req: ImageRequest,
  priority: JobPriority = 'background',
): Promise<ImageResult> {
  return enqueue(profile.id, () => generateImage(profile, req), {
    priority,
    minIntervalMs: profile.minIntervalMs,
    signal: req.signal,
  });
}
