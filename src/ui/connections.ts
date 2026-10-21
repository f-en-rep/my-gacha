// 연결 프로필 관련 공용 값과 도우미
import type { ConnectionProfile, ImageProfile, ImageProviderKind, TextProfile, TextProviderKind } from '../types';
import { summarizeServiceAccount, testTextConnection } from '../gen/text';
import { testImageConnection } from '../gen/image';
import { newId } from '../core/id';

export const TEXT_PROVIDERS: { value: TextProviderKind; label: string; modelHint: string }[] = [
  { value: 'openrouter', label: 'OpenRouter', modelHint: '예: anthropic/claude-sonnet-4.5' },
  { value: 'openai', label: 'OpenAI', modelHint: '예: gpt-4.1-mini' },
  { value: 'anthropic', label: 'Anthropic (Claude)', modelHint: '예: claude-sonnet-4-5' },
  { value: 'gemini', label: 'Google Gemini', modelHint: '예: gemini-2.5-flash' },
  { value: 'vertex', label: 'Google Vertex AI', modelHint: '예: gemini-2.5-flash (목록 불러오기로 고를 수 있어요)' },
  { value: 'nanogpt', label: 'NanoGPT', modelHint: '예: deepseek-chat' },
  { value: 'openai-compatible', label: 'OpenAI 호환 (직접 주소)', modelHint: '서비스에서 쓰는 모델 이름' },
];

export const IMAGE_PROVIDERS: { value: ImageProviderKind; label: string }[] = [
  { value: 'novelai', label: 'NovelAI' },
  { value: 'pixai', label: 'PixAI' },
];

export const NOVELAI_MODELS: { value: string; label: string }[] = [
  { value: 'nai-diffusion-4-5-full', label: 'NAI Diffusion 4.5 Full (추천)' },
  { value: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion 4.5 Curated' },
  { value: 'nai-diffusion-4-full', label: 'NAI Diffusion 4 Full' },
  { value: 'nai-diffusion-3', label: 'NAI Diffusion 3 (애니풍)' },
];

export const SIZE_PRESETS: { key: string; label: string; width: number; height: number }[] = [
  { key: 'portrait', label: '세로 832×1216', width: 832, height: 1216 },
  { key: 'landscape', label: '가로 1216×832', width: 1216, height: 832 },
  { key: 'square', label: '정사각 1024×1024', width: 1024, height: 1024 },
];

export const MIN_INTERVAL_FLOOR = 5000;

export function providerLabel(p: ConnectionProfile): string {
  const list: { value: string; label: string }[] = p.type === 'text' ? TEXT_PROVIDERS : IMAGE_PROVIDERS;
  return list.find((x) => x.value === p.provider)?.label ?? p.provider;
}

export function newTextProfile(): TextProfile {
  return {
    id: newId('conn-'),
    type: 'text',
    provider: 'openrouter',
    label: '',
    apiKey: '',
    model: '',
    maxTokens: 8192,
    temperature: 0.9,
    useRelay: false,
  };
}

export function newImageProfile(): ImageProfile {
  return {
    id: newId('conn-'),
    type: 'image',
    provider: 'novelai',
    label: '',
    apiKey: '',
    model: 'nai-diffusion-4-5-full',
    minIntervalMs: 10000,
    width: 832,
    height: 1216,
    useRelay: false,
  };
}

/** 저장 전 검사. 문제가 있으면 한국어 메시지 목록 */
export function validateProfile(p: ConnectionProfile): string[] {
  const errs: string[] = [];
  if (!p.label.trim()) errs.push('이름을 입력하세요.');
  if (!p.model.trim()) errs.push('모델 이름을 입력하세요.');
  if (p.type === 'text') {
    if (p.provider === 'openai-compatible') {
      if (!p.baseUrl?.trim()) errs.push('OpenAI 호환 서비스는 주소(Base URL)가 꼭 필요해요.');
    } else if (p.provider === 'vertex' && p.vertex?.auth === 'serviceAccount') {
      errs.push(...validateVertexServiceAccount(p));
    } else if (!p.apiKey.trim()) errs.push('API 키를 입력하세요.');
    if (p.provider === 'vertex') {
      const loc = p.vertex?.location?.trim();
      if (loc && !/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(loc)) errs.push('리전은 global 또는 us-central1 같은 형식이어야 해요.');
    }
    if (p.baseUrl?.trim() && !/^https?:\/\//.test(p.baseUrl.trim())) errs.push('주소는 http:// 또는 https:// 로 시작해야 해요.');
    if (p.maxTokens !== undefined && (!Number.isFinite(p.maxTokens) || p.maxTokens < 1)) errs.push('최대 토큰은 1 이상이어야 해요.');
    if (p.temperature !== undefined && (p.temperature < 0 || p.temperature > 2)) errs.push('온도는 0~2 사이여야 해요.');
  } else {
    if (!p.apiKey.trim()) errs.push('API 키를 입력하세요.');
    if (!Number.isFinite(p.minIntervalMs) || p.minIntervalMs < MIN_INTERVAL_FLOOR) errs.push(`요청 간격은 최소 ${MIN_INTERVAL_FLOOR / 1000}초예요.`);
  }
  return errs;
}

function validateVertexServiceAccount(p: TextProfile): string[] {
  if (!p.apiKey.trim()) return ['서비스 계정 JSON 키를 붙여 넣거나 파일로 열어 주세요.'];
  const s = summarizeServiceAccount(p.apiKey);
  if (!s.ok) return [s.error];
  if (!s.projectId && !p.vertex?.projectId?.trim()) return ['JSON에 project_id가 없어요. 프로젝트 ID를 입력해 주세요.'];
  return [];
}

export type TestState = 'ok' | 'fail' | 'pending';

export interface TestOutcome {
  state: TestState;
  message: string;
  ms: number;
}

/** 연결 테스트. 예외도 결과로 바꿔서 돌려준다 */
export async function runConnectionTest(p: ConnectionProfile): Promise<TestOutcome> {
  const t0 = performance.now();
  try {
    const r = p.type === 'text' ? await testTextConnection(p) : await testImageConnection(p);
    return { state: r.ok ? 'ok' : 'fail', message: r.message, ms: Math.round(r.ms) };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const msg = e instanceof Error ? e.message : String(e);
    if (/not implemented/i.test(msg)) {
      return { state: 'pending', message: '테스트 기능이 아직 준비 중이에요. 다음 업데이트에서 동작해요.', ms };
    }
    return { state: 'fail', message: msg || '알 수 없는 오류', ms };
  }
}
