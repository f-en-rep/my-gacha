import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageProfile } from '../../types';
import { generatePixAI } from './pixai';
import { testImageConnection } from './index';

const profile: ImageProfile = {
  id: 'px',
  type: 'image',
  label: 'pixai',
  provider: 'pixai',
  apiKey: 'pix-key',
  useRelay: false,
  model: '1648918127446573124',
  minIntervalMs: 0,
  width: 768,
  height: 1280,
  extra: { samplingSteps: 25 },
};

function json(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('generatePixAI', () => {
  it('creates a task, polls until completed, fetches media and downloads the image', async () => {
    const calls: { url: string; body?: { query: string; variables: Record<string, unknown> } }[] = [];
    let polls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, body });
      if (url === 'https://api.pixai.art/graphql') {
        expect(new Headers(init!.headers).get('authorization')).toBe('Bearer pix-key');
        if (body.query.includes('createGenerationTask')) return json({ data: { createGenerationTask: { id: 't1', status: 'waiting' } } });
        if (body.query.includes('task(id')) {
          polls++;
          return json({
            data: { task: polls < 2 ? { id: 't1', status: 'running' } : { id: 't1', status: 'completed', outputs: { mediaId: 'm1' } } },
          });
        }
        if (body.query.includes('media(id')) {
          return json({
            data: {
              media: {
                id: 'm1',
                width: 768,
                height: 1280,
                imageType: 'image/png',
                urls: [
                  { variant: 'THUMBNAIL', url: 'https://images-ng.pixai.art/thumb' },
                  { variant: 'PUBLIC', url: 'https://images-ng.pixai.art/orig' },
                ],
              },
            },
          });
        }
      }
      if (url === 'https://images-ng.pixai.art/orig') {
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await generatePixAI(profile, { prompt: '1girl', negativePrompt: 'bad', seed: 99 }, { pollIntervalMs: 1 });
    expect(r).toMatchObject({ mime: 'image/png', width: 768, height: 1280, seed: 99, prompt: '1girl', negativePrompt: 'bad' });
    expect(r.blob.size).toBe(3);

    const create = calls[0]!.body!;
    expect(create.variables.parameters).toMatchObject({
      prompts: '1girl',
      negativePrompts: 'bad',
      modelId: '1648918127446573124',
      width: 768,
      height: 1280,
      seed: 99,
      batchSize: 1,
      priority: 1000,
      samplingSteps: 25,
    });
    expect(polls).toBe(2);
    expect(calls.find((c) => c.body?.query.includes('media(id'))!.body!.variables).toEqual({ id: 'm1' });
  });

  it('reports failed tasks in Korean', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string);
        if (body.query.includes('createGenerationTask')) return json({ data: { createGenerationTask: { id: 't', status: 'waiting' } } });
        return json({ data: { task: { id: 't', status: 'failed' } } });
      }),
    );
    await expect(generatePixAI(profile, { prompt: 'x' }, { pollIntervalMs: 1 })).rejects.toThrow(/PixAI: .*실패/);
  });

  it('maps GraphQL auth errors to a key message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: [{ message: 'Unauthorized' }] })));
    await expect(generatePixAI(profile, { prompt: 'x' })).rejects.toThrow(/API 키/);
  });

  it('abort during polling rejects with AbortError and tries to cancel the task', async () => {
    const queries: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string);
        queries.push(body.query);
        if (body.query.includes('createGenerationTask')) return json({ data: { createGenerationTask: { id: 't', status: 'waiting' } } });
        if (body.query.includes('cancelGenerationTask')) return json({ data: { cancelGenerationTask: { id: 't', status: 'cancelled' } } });
        return json({ data: { task: { id: 't', status: 'running' } } });
      }),
    );
    const ctrl = new AbortController();
    const p = generatePixAI(profile, { prompt: 'x', signal: ctrl.signal }, { pollIntervalMs: 50 });
    setTimeout(() => ctrl.abort(), 70);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((r) => setTimeout(r, 5));
    expect(queries.some((q) => q.includes('cancelGenerationTask'))).toBe(true);
  });
});

describe('testImageConnection (pixai)', () => {
  it('uses a cheap me query', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json({ data: { me: { id: 'u1' } } }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await testImageConnection(profile);
    expect(r.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.query).toContain('me');
    expect(body.query).not.toContain('createGenerationTask');
  });
});
