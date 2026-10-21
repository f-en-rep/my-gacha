import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueue, isRunning, pendingCount, resetQueueForTests } from './queue';

/** 수동으로 끝낼 수 있는 작업 */
function deferred<T = string>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 마이크로태스크를 충분히 비운다 */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('enqueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    resetQueueForTests();
  });
  afterEach(() => {
    resetQueueForTests();
    vi.useRealTimers();
  });

  it('runs at most one job per key, in order', async () => {
    const log: string[] = [];
    const a = deferred();
    const b = deferred();
    const pa = enqueue('k', () => (log.push('a'), a.promise));
    const pb = enqueue('k', () => (log.push('b'), b.promise));
    await flush();
    expect(log).toEqual(['a']);
    expect(isRunning('k')).toBe(true);
    expect(pendingCount('k')).toBe(1);
    a.resolve('A');
    await expect(pa).resolves.toBe('A');
    await flush();
    expect(log).toEqual(['a', 'b']);
    b.resolve('B');
    await expect(pb).resolves.toBe('B');
  });

  it('different keys run in parallel', async () => {
    const log: string[] = [];
    enqueue('x', () => (log.push('x'), new Promise(() => {})));
    enqueue('y', () => (log.push('y'), new Promise(() => {})));
    await flush();
    expect(log).toEqual(['x', 'y']);
  });

  it('queued foreground jobs jump ahead of queued background jobs, without preempting', async () => {
    const log: string[] = [];
    const first = deferred();
    enqueue('k', () => (log.push('bg1'), first.promise), { priority: 'background' });
    enqueue('k', async () => void log.push('bg2'), { priority: 'background' });
    enqueue('k', async () => void log.push('fg1'), { priority: 'foreground' });
    enqueue('k', async () => void log.push('fg2'), { priority: 'foreground' });
    await flush();
    expect(log).toEqual(['bg1']); // 실행 중인 것은 끊지 않음
    first.resolve('done');
    await flush();
    await flush();
    expect(log).toEqual(['bg1', 'fg1', 'fg2', 'bg2']);
  });

  it('enforces minIntervalMs between end of previous and start of next', async () => {
    const starts: number[] = [];
    const job = () => {
      starts.push(Date.now());
      return new Promise<void>((res) => setTimeout(res, 3000));
    };
    const t0 = Date.now();
    const p1 = enqueue('k', job, { minIntervalMs: 10_000 });
    const p2 = enqueue('k', job, { minIntervalMs: 10_000 });
    await flush();
    expect(starts).toEqual([t0]); // 첫 작업은 바로
    await vi.advanceTimersByTimeAsync(3000); // 첫 작업 끝 (t0+3000)
    await p1;
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([t0, t0 + 13_000]);
    await vi.advanceTimersByTimeAsync(3000);
    await p2;
  });

  it('a foreground job arriving during the interval wait goes before the waiting background job', async () => {
    const log: string[] = [];
    await enqueue('k', async () => void log.push('first'), { minIntervalMs: 5000 });
    const pbg = enqueue('k', async () => void log.push('bg'), { priority: 'background', minIntervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(2000);
    const pfg = enqueue('k', async () => void log.push('fg'), { priority: 'foreground', minIntervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(2999);
    expect(log).toEqual(['first']);
    await vi.advanceTimersByTimeAsync(1);
    expect(log).toEqual(['first', 'fg']);
    await pfg;
    await vi.advanceTimersByTimeAsync(5000);
    await pbg;
    expect(log).toEqual(['first', 'fg', 'bg']);
  });

  it('abort removes a queued job and rejects with AbortError', async () => {
    const log: string[] = [];
    const first = deferred();
    enqueue('k', () => (log.push('a'), first.promise));
    const ctrl = new AbortController();
    const pb = enqueue('k', async () => void log.push('b'), { signal: ctrl.signal });
    const pc = enqueue('k', async () => void log.push('c'));
    await flush();
    ctrl.abort();
    await expect(pb).rejects.toMatchObject({ name: 'AbortError' });
    expect(pendingCount('k')).toBe(1);
    first.resolve('ok');
    await pc;
    expect(log).toEqual(['a', 'c']);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const job = vi.fn(async () => 1);
    await expect(enqueue('k', job, { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(job).not.toHaveBeenCalled();
  });

  it('aborting a running job does not remove it from the queue (signal passes through)', async () => {
    const ctrl = new AbortController();
    const p = enqueue(
      'k',
      () =>
        new Promise((_res, rej) => {
          ctrl.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')));
        }),
      { signal: ctrl.signal },
    );
    await flush();
    expect(isRunning('k')).toBe(true);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    const after = await enqueue('k', async () => 'next');
    expect(after).toBe('next');
  });

  it('errors (async and sync throws) do not stall the queue', async () => {
    const p1 = enqueue('k', async () => {
      throw new Error('boom');
    });
    const p2 = enqueue('k', (() => {
      throw new Error('sync');
    }) as () => Promise<never>);
    const p3 = enqueue('k', async () => 'fine');
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).rejects.toThrow('sync');
    await expect(p3).resolves.toBe('fine');
  });
});
