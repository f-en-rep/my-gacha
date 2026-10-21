import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageProfile } from '../../types';
import { buildNovelAIBody, extractNovelAIImage, isNovelAIV4Model } from './novelai';
import { generateImage, testImageConnection } from './index';

/** IHDR까지만 있는 가짜 PNG (크기 읽기용) */
function fakePng(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

const profile: ImageProfile = {
  id: 'p1',
  type: 'image',
  label: 'nai',
  provider: 'novelai',
  apiKey: 'pst-secret',
  useRelay: false,
  model: 'nai-diffusion-4-5-full',
  minIntervalMs: 10_000,
  width: 832,
  height: 1216,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildNovelAIBody', () => {
  it('detects V4 models', () => {
    expect(isNovelAIV4Model('nai-diffusion-4-5-full')).toBe(true);
    expect(isNovelAIV4Model('nai-diffusion-4-5-curated')).toBe(true);
    expect(isNovelAIV4Model('nai-diffusion-4-full')).toBe(true);
    expect(isNovelAIV4Model('nai-diffusion-3')).toBe(false);
    expect(isNovelAIV4Model('nai-diffusion-furry-3')).toBe(false);
  });

  it('builds a V4.5 body with v4_prompt structures and defaults', () => {
    const body = buildNovelAIBody({
      model: 'nai-diffusion-4-5-full',
      prompt: '1girl, smile',
      negativePrompt: 'lowres',
      width: 832,
      height: 1216,
      seed: 42,
    });
    expect(body.action).toBe('generate');
    expect(body.input).toBe('1girl, smile');
    expect(body.model).toBe('nai-diffusion-4-5-full');
    const p = body.parameters as Record<string, unknown>;
    expect(p).toMatchObject({
      params_version: 3,
      width: 832,
      height: 1216,
      steps: 28,
      scale: 5,
      sampler: 'k_euler_ancestral',
      n_samples: 1,
      seed: 42,
      negative_prompt: 'lowres',
      sm: false,
      sm_dyn: false,
      use_coords: false,
      characterPrompts: [],
      v4_prompt: { caption: { base_caption: '1girl, smile', char_captions: [] }, use_coords: false, use_order: true },
      v4_negative_prompt: { caption: { base_caption: 'lowres', char_captions: [] } },
    });
  });

  it('builds a V3 body without v4 fields', () => {
    const body = buildNovelAIBody({ model: 'nai-diffusion-3', prompt: 'a', negativePrompt: 'b', width: 512, height: 768, seed: 1 });
    const p = body.parameters as Record<string, unknown>;
    expect(p.v4_prompt).toBeUndefined();
    expect(p.v4_negative_prompt).toBeUndefined();
    expect(p.negative_prompt).toBe('b');
    expect(body.input).toBe('a');
  });

  it('lets profile.extra override, but keeps SMEA off for V4; varietyBoost computes sigma', () => {
    const v4 = buildNovelAIBody({
      model: 'nai-diffusion-4-5-full',
      prompt: 'a',
      negativePrompt: '',
      width: 832,
      height: 1216,
      seed: 1,
      extra: { steps: 23, sampler: 'k_dpmpp_2m', sm: true, varietyBoost: true },
    });
    const p = v4.parameters as Record<string, unknown>;
    expect(p.steps).toBe(23);
    expect(p.sampler).toBe('k_dpmpp_2m');
    expect(p.sm).toBe(false);
    expect(p.varietyBoost).toBeUndefined();
    expect(p.skip_cfg_above_sigma).toBeCloseTo(58);

    const v3 = buildNovelAIBody({ model: 'nai-diffusion-3', prompt: 'a', negativePrompt: '', width: 832, height: 1216, seed: 1, extra: { sm: true } });
    expect((v3.parameters as Record<string, unknown>).sm).toBe(true);
  });
});

describe('extractNovelAIImage', () => {
  it('unzips the PNG from the response zip', () => {
    const png = fakePng(10, 20);
    const zip = zipSync({ 'image_0.png': png });
    expect(Array.from(extractNovelAIImage(zip.buffer as ArrayBuffer))).toEqual(Array.from(png));
  });
  it('accepts a raw PNG', () => {
    const png = fakePng(1, 1);
    expect(extractNovelAIImage(png)).toBe(png);
  });
  it('throws when the zip has no PNG', () => {
    const zip = zipSync({ 'readme.txt': new Uint8Array([65]) });
    expect(() => extractNovelAIImage(zip)).toThrow(/PNG/);
  });
});

describe('generateImage (novelai)', () => {
  it('posts to image.novelai.net with bearer key and returns the PNG', async () => {
    const png = fakePng(832, 1216);
    const zip = zipSync({ 'image_0.png': png });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(zip, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateImage(profile, { prompt: '1girl', negativePrompt: 'bad', seed: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://image.novelai.net/ai/generate-image');
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer pst-secret');
    const sent = JSON.parse(init!.body as string);
    expect(sent.parameters.seed).toBe(7);
    expect(sent.parameters.width).toBe(832);
    expect(result).toMatchObject({ mime: 'image/png', width: 832, height: 1216, seed: 7, prompt: '1girl', negativePrompt: 'bad' });
    expect(result.blob.size).toBe(png.length);
  });

  it('goes through the relay when useRelay is on', async () => {
    const zip = zipSync({ 'a.png': fakePng(1, 1) });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(zip));
    vi.stubGlobal('fetch', fetchMock);
    const r = await generateImage({ ...profile, useRelay: true }, { prompt: 'x' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/relay');
    expect(new Headers(init!.headers).get('x-relay-target')).toBe('https://image.novelai.net/ai/generate-image');
    expect(r.seed).toBeGreaterThanOrEqual(0);
  });

  it('maps 402 to a Korean Anlas message and network errors to a relay hint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"not enough"}', { status: 402 })));
    await expect(generateImage(profile, { prompt: 'x' })).rejects.toThrow(/Anlas가 부족/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(generateImage(profile, { prompt: 'x' })).rejects.toThrow(/API 키/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    await expect(generateImage(profile, { prompt: 'x' })).rejects.toThrow(/너무 잦습니다/);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(generateImage(profile, { prompt: 'x' })).rejects.toThrow(/중계기 사용/);
  });
});

describe('testImageConnection (novelai)', () => {
  it('reads subscription without generating', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 10000, purchasedTrainingSteps: 500 } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await testImageConnection(profile);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.novelai.net/user/subscription');
    expect(fetchMock.mock.calls[0]![1]!.method).toBe('GET');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Opus');
    expect(r.message).toContain('10,500');
  });

  it('reports a bad key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));
    const r = await testImageConnection(profile);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/API 키/);
  });
});
