// NovelAI 그림 생성.
//
// 요청 본문은 SillyTavern의 서버 코드를 기준으로 했다 (2026-10 확인, release 브랜치):
//   https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/novelai.js
//   - POST https://image.novelai.net/ai/generate-image, Authorization: Bearer <키>
//   - { action: 'generate', input, model, parameters: { params_version: 3, ..., v4_prompt, v4_negative_prompt } }
//   - 응답은 ZIP, 안의 .png 파일이 그림 (extractFileFromZipBuffer(buf, '.png'))
//   - 구독 확인: GET <host>/user/subscription (tier 0~3 = Paper/Tablet/Scroll/Opus,
//     Anlas = trainingStepsLeft.fixedTrainingStepsLeft; public/scripts/nai-settings.js)
//   - V4 계열에서는 SMEA(sm, sm_dyn)를 끈다 (public/scripts/extensions/stable-diffusion/index.js)
//   - Variety+ (skip_cfg_above_sigma) = sqrt(w*h / 832*1216) * (V4.5: 58, 그 외 19)
// SillyTavern은 모든 모델에 v4_* 필드를 같이 보내지만, 여기서는 V3 이하에는 보내지 않는다
// (V3는 input/negative_prompt만 쓴다. 불필요한 필드를 줄여 오래된 모델과의 충돌을 피함).
// purchasedTrainingSteps(구매한 Anlas)는 NovelAI 구독 응답에 함께 오는 필드로 알고 있으나
// SillyTavern 코드로는 확인하지 못했다 → 있으면 더하고, 없으면 무시.

import { unzipSync } from 'fflate';
import { apiFetch, ensureOk } from '../../net/http';
import type { ImageGenSettings, ImageProfile } from '../../types';
import type { ConnectionTestResult } from '../text';
import { isPng, readPngSize, resolveSeed, toImageError } from './common';
import type { CharacterPrompt, ImageRequest, ImageResult } from './types';
import { mergeCharacterPrompts } from './common';

export const NOVELAI_IMAGE_BASE = 'https://image.novelai.net';
export const NOVELAI_API_BASE = 'https://api.novelai.net';
export const NOVELAI_DEFAULT_MODEL = 'nai-diffusion-4-5-full';

const REFERENCE_PIXEL_COUNT = 832 * 1216;

/** nai-diffusion-4, 4-5, (앞으로의 5 이상)은 v4_prompt 구조를 쓴다 */
export function isNovelAIV4Model(model: string): boolean {
  const m = /^nai-diffusion-(\d+)/.exec(model);
  return !!m && Number(m[1]) >= 4;
}

export interface NovelAIBodyInput {
  model: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  /** V4 이상: 캐릭터 슬롯. V3: 프롬프트 뒤에 이어 붙인다 */
  characters?: CharacterPrompt[];
  /** 프로필의 생성 설정 (steps, scale, sampler …) */
  gen?: ImageGenSettings;
  /** profile.extra. parameters에 덮어쓴다. 단 extra.varietyBoost: true면 Variety+ 계산 */
  extra?: Record<string, unknown>;
}

/** 캐릭터 슬롯 하나는 화면 가운데에 둔다 (여러 명이면 가로로 나눈다) */
function slotCenter(i: number, n: number): { x: number; y: number } {
  return { x: Math.round(((i + 1) / (n + 1)) * 10) / 10, y: 0.5 };
}

/** 요청 본문 만들기 (테스트하기 쉽게 따로 뺌) */
export function buildNovelAIBody(i: NovelAIBodyInput): Record<string, unknown> {
  const { varietyBoost: extraVariety, ...extra } = i.extra ?? {};
  const v4 = isNovelAIV4Model(i.model);
  const gen = i.gen ?? {};
  const varietyBoost = extraVariety ?? gen.varietyBoost;
  const chars = (i.characters ?? []).filter((c) => c.prompt.trim());
  // V3에는 캐릭터 슬롯이 없다: 공통 프롬프트에 이어 붙인다
  const flat = v4 ? { prompt: i.prompt, negativePrompt: i.negativePrompt } : mergeCharacterPrompts(i.prompt, i.negativePrompt, chars);

  const parameters: Record<string, unknown> = {
    params_version: 3,
    width: i.width,
    height: i.height,
    scale: gen.scale ?? 5,
    sampler: gen.sampler || 'k_euler_ancestral',
    steps: gen.steps ?? 28,
    n_samples: 1,
    seed: i.seed,
    negative_prompt: flat.negativePrompt,
    noise_schedule: gen.noiseSchedule || 'karras',
    ucPreset: 0,
    qualityToggle: false,
    sm: false,
    sm_dyn: false,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    add_original_image: false,
    uncond_scale: 1,
    cfg_rescale: gen.cfgRescale ?? 0,
    prefer_brownian: true,
    deliberate_euler_ancestral_bug: false,
    legacy_v3_extend: false,
    skip_cfg_above_sigma: null,
  };

  if (varietyBoost === true) {
    const magic = i.model.includes('nai-diffusion-4-5') ? 58 : 19;
    parameters.skip_cfg_above_sigma = Math.sqrt((i.width * i.height) / REFERENCE_PIXEL_COUNT) * magic;
  }

  if (v4) {
    const centers = chars.map((_, k) => slotCenter(k, chars.length));
    Object.assign(parameters, {
      use_coords: false,
      characterPrompts: chars.map((c, k) => ({ prompt: c.prompt, uc: c.negative ?? '', center: centers[k], enabled: true })),
      reference_image_multiple: [],
      reference_information_extracted_multiple: [],
      reference_strength_multiple: [],
      v4_prompt: {
        caption: {
          base_caption: i.prompt,
          char_captions: chars.map((c, k) => ({ char_caption: c.prompt, centers: [centers[k]] })),
        },
        use_coords: false,
        use_order: true,
      },
      v4_negative_prompt: {
        caption: {
          base_caption: i.negativePrompt,
          char_captions: chars.map((c, k) => ({ char_caption: c.negative ?? '', centers: [centers[k]] })),
        },
      },
    });
  }

  Object.assign(parameters, extra);
  if (v4) {
    // V4는 SMEA를 지원하지 않는다
    parameters.sm = false;
    parameters.sm_dyn = false;
  }

  return { action: 'generate', input: flat.prompt, model: i.model, parameters };
}

/** NovelAI 응답(보통 ZIP)에서 PNG를 꺼낸다. 이미 PNG면 그대로 */
export function extractNovelAIImage(buf: ArrayBuffer | Uint8Array): Uint8Array {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (isPng(bytes)) return bytes;
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('응답이 ZIP도 PNG도 아닙니다.');
  }
  const files = unzipSync(bytes, { filter: (f) => /\.png$/i.test(f.name) });
  const first = Object.values(files)[0];
  if (!first) throw new Error('응답 ZIP 안에 PNG 그림이 없습니다.');
  return first;
}

export async function generateNovelAI(profile: ImageProfile, req: ImageRequest): Promise<ImageResult> {
  const model = profile.model || NOVELAI_DEFAULT_MODEL;
  const width = req.width ?? profile.width;
  const height = req.height ?? profile.height;
  const seed = resolveSeed(req.seed ?? profile.gen?.seed);
  const negativePrompt = req.negativePrompt ?? '';
  const base = (profile.baseUrl || NOVELAI_IMAGE_BASE).replace(/\/+$/, '');
  const body = buildNovelAIBody({
    model,
    prompt: req.prompt,
    negativePrompt,
    width,
    height,
    seed,
    characters: req.characters,
    gen: profile.gen,
    extra: profile.extra,
  });

  try {
    const res = await apiFetch(
      `${base}/ai/generate-image`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${profile.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/x-zip-compressed, application/zip, image/png, */*',
        },
        body: JSON.stringify(body),
        signal: req.signal,
      },
      { useRelay: profile.useRelay },
    );
    await ensureOk(res, 'NovelAI 그림 생성');
    const png = extractNovelAIImage(await res.arrayBuffer());
    const size = readPngSize(png) ?? { width, height };
    return {
      blob: new Blob([png as BlobPart], { type: 'image/png' }),
      mime: 'image/png',
      width: size.width,
      height: size.height,
      seed,
      prompt: req.prompt,
      negativePrompt,
    };
  } catch (e) {
    throw toImageError('novelai', e, profile.useRelay);
  }
}

const NOVELAI_TIERS = ['Paper(무료 체험)', 'Tablet', 'Scroll', 'Opus'];

interface NovelAISubscription {
  tier?: number;
  active?: boolean;
  trainingStepsLeft?: { fixedTrainingStepsLeft?: number; purchasedTrainingSteps?: number };
}

/** 그림을 그리지 않고 구독 정보만 읽는다 */
export async function testNovelAI(profile: ImageProfile): Promise<ConnectionTestResult> {
  const started = Date.now();
  try {
    const res = await apiFetch(
      `${NOVELAI_API_BASE}/user/subscription`,
      { method: 'GET', headers: { Authorization: `Bearer ${profile.apiKey}` } },
      { useRelay: profile.useRelay },
    );
    await ensureOk(res, 'NovelAI 구독 확인');
    const data = (await res.json()) as NovelAISubscription;
    const tierName = typeof data.tier === 'number' ? (NOVELAI_TIERS[data.tier] ?? `등급 ${data.tier}`) : '알 수 없음';
    const steps = data.trainingStepsLeft;
    const anlas =
      steps && (typeof steps.fixedTrainingStepsLeft === 'number' || typeof steps.purchasedTrainingSteps === 'number')
        ? (steps.fixedTrainingStepsLeft ?? 0) + (steps.purchasedTrainingSteps ?? 0)
        : undefined;
    const parts = [`연결 성공 — 구독: ${tierName}${data.active === false ? ' (비활성)' : ''}`];
    if (anlas !== undefined) parts.push(`Anlas ${anlas.toLocaleString('ko-KR')}`);
    return { ok: true, message: parts.join(', '), ms: Date.now() - started };
  } catch (e) {
    return { ok: false, message: toImageError('novelai', e, profile.useRelay).message, ms: Date.now() - started };
  }
}
