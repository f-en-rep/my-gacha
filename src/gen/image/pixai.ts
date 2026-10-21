// PixAI 그림 생성 (GraphQL).
//
// 확인한 근거: PixAI 공식 클라이언트
//   - npm @pixai-art/client 0.4.0 (src/client.ts, src/generated/graphql.ts, src/parameters.types.ts)
//   - github.com/pixai-art/pixai-client-go (mutation.go, query.go, task_utils.go, media.go, README)
// 여기서 확인된 것:
//   - POST https://api.pixai.art/graphql, Authorization: Bearer <API 키>, 본문 { query, variables }
//   - mutation createGenerationTask($parameters: JSONObject!) { createGenerationTask(parameters: $parameters) { id status ... } }
//   - query getTaskById($id: ID!) { task(id: $id) { id status outputs ... } }
//     status: waiting | running | completed | failed | cancelled
//   - 완료되면 outputs.mediaId (또는 outputs.batch[i].mediaId)
//   - query getMediaById($id: String!) { media(id: $id) { urls { variant url } width height imageType } }
//     variant 'PUBLIC' 의 url이 원본 그림
//   - mutation cancelGenerationTask($id: ID!)
//   - 파라미터 이름: prompts, negativePrompts, modelId, width, height, seed, samplingSteps,
//     samplingMethod, cfgScale, batchSize, lora ...
//   - 오류: 본문에 message 또는 errors[] (HTTP 200이어도 errors가 올 수 있음)
//   - Go README: priority: 1000 을 주면 공용 대기열 대신 바로 처리 ("historical legacy issue")
// 가정 (공식 클라이언트에 없음, 확인 못 함):
//   - 연결 확인용 `query { me { id } }` 가 API 키로 동작한다고 가정.
//   - 그림 주소 호스트는 images-ng.pixai.art 등 *.pixai.art 라고 가정 (중계기 허용 목록에 반영).
//   - 공식 클라이언트는 결과를 웹소켓 구독으로 기다리지만, 여기서는 task 조회를 반복(폴링)한다.
//   - 키 오류/크레딧 부족이 GraphQL errors 메시지로만 올 때 문구로 추정해 HTTP 상태처럼 다룬다.

import { ApiError, apiFetch, ensureOk } from '../../net/http';
import type { ImageProfile } from '../../types';
import type { ConnectionTestResult } from '../text';
import { isAbortError, resolveSeed, sleep, toImageError } from './common';
import type { ImageRequest, ImageResult } from './types';

export const PIXAI_API_BASE = 'https://api.pixai.art';

const TASK_FIELDS = 'id status outputs';

const CREATE_TASK = `mutation createGenerationTask($parameters: JSONObject!) {
  createGenerationTask(parameters: $parameters) { ${TASK_FIELDS} }
}`;
const GET_TASK = `query getTaskById($id: ID!) {
  task(id: $id) { ${TASK_FIELDS} }
}`;
const GET_MEDIA = `query getMediaById($id: String!) {
  media(id: $id) { id type width height imageType urls { variant url } }
}`;
const CANCEL_TASK = `mutation cancelGenerationTask($id: ID!) {
  cancelGenerationTask(id: $id) { id status }
}`;
const ME = `query me { me { id } }`;

export interface PixAITask {
  id: string;
  status?: string | null;
  outputs?: { mediaId?: string; batch?: { mediaId?: string }[]; [k: string]: unknown } | null;
}

interface PixAIMedia {
  id: string;
  width?: number | null;
  height?: number | null;
  imageType?: string | null;
  urls?: { variant?: string | null; url?: string | null }[] | null;
}

export interface PixAIPollOptions {
  /** 첫 조회까지, 그리고 조회 사이 간격 (기본 2000) */
  pollIntervalMs?: number;
  /** 이만큼 지나도 안 끝나면 포기 (기본 5분) */
  timeoutMs?: number;
}

/** GraphQL 오류 문구로 상태 코드를 추정한다 (가정) */
function guessStatus(message: string): number {
  const m = message.toLowerCase();
  if (/unauthori[sz]ed|unauthenticated|not logged|invalid (api )?(key|token)|forbidden|permission/.test(m)) return 401;
  if (/quota|credit|insufficient|balance|not enough/.test(m)) return 402;
  if (/rate limit|too many/.test(m)) return 429;
  return 400;
}

async function gql<T>(
  profile: ImageProfile,
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const base = (profile.baseUrl || PIXAI_API_BASE).replace(/\/+$/, '');
  const res = await apiFetch(
    `${base}/graphql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal,
    },
    { useRelay: profile.useRelay },
  );
  await ensureOk(res, 'PixAI');
  const data = (await res.json()) as { data?: T; errors?: { message?: string }[]; message?: string };
  const errMsg = data.message ?? data.errors?.[0]?.message;
  if (errMsg || data.errors?.length) {
    const msg = errMsg ?? 'GraphQL 오류';
    throw new ApiError(`PixAI: ${msg}`, guessStatus(msg));
  }
  if (!data.data) throw new Error('PixAI: 응답에 data가 없습니다.');
  return data.data;
}

export function buildPixAIParameters(
  profile: ImageProfile,
  req: { prompt: string; negativePrompt: string; width: number; height: number; seed: number },
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    prompts: req.prompt,
    width: req.width,
    height: req.height,
    seed: req.seed,
    batchSize: 1,
    // 공식 Go 클라이언트 README: 1000이면 공용 대기열을 거치지 않고 바로 처리
    priority: 1000,
  };
  if (profile.model) params.modelId = profile.model;
  if (req.negativePrompt) params.negativePrompts = req.negativePrompt;
  return { ...params, ...(profile.extra ?? {}) };
}

function firstMediaId(task: PixAITask): string | undefined {
  const o = task.outputs;
  if (!o) return undefined;
  if (typeof o.mediaId === 'string' && o.mediaId) return o.mediaId;
  const b = Array.isArray(o.batch) ? o.batch.find((x) => typeof x?.mediaId === 'string') : undefined;
  return b?.mediaId;
}

export async function generatePixAI(
  profile: ImageProfile,
  req: ImageRequest,
  poll: PixAIPollOptions = {},
): Promise<ImageResult> {
  const { pollIntervalMs = 2000, timeoutMs = 5 * 60_000 } = poll;
  const width = req.width ?? profile.width;
  const height = req.height ?? profile.height;
  const seed = resolveSeed(req.seed);
  const negativePrompt = req.negativePrompt ?? '';
  const signal = req.signal;
  let taskId: string | undefined;

  try {
    const parameters = buildPixAIParameters(profile, { prompt: req.prompt, negativePrompt, width, height, seed });
    const created = await gql<{ createGenerationTask?: PixAITask | null }>(profile, CREATE_TASK, { parameters }, signal);
    let task = created.createGenerationTask;
    if (!task?.id) throw new Error('작업을 만들지 못했습니다.');
    taskId = task.id;

    const deadline = Date.now() + timeoutMs;
    while (task.status !== 'completed') {
      if (task.status === 'failed') throw new Error('그림 생성에 실패했습니다(작업 실패).');
      if (task.status === 'cancelled') throw new Error('작업이 취소되었습니다.');
      if (Date.now() > deadline) throw new Error('그림 생성이 너무 오래 걸려 기다리기를 멈췄습니다.');
      await sleep(pollIntervalMs, signal);
      const got = await gql<{ task?: PixAITask | null }>(profile, GET_TASK, { id: taskId }, signal);
      if (!got.task) throw new Error('작업을 찾을 수 없습니다.');
      task = got.task;
    }

    const mediaId = firstMediaId(task);
    if (!mediaId) throw new Error('완료된 작업에 그림(mediaId)이 없습니다.');
    const { media } = await gql<{ media?: PixAIMedia | null }>(profile, GET_MEDIA, { id: mediaId }, signal);
    const url = media?.urls?.find((u) => u.variant === 'PUBLIC')?.url ?? media?.urls?.find((u) => u.url)?.url;
    if (!url) throw new Error('그림 주소를 받지 못했습니다.');

    const imgRes = await apiFetch(url, { method: 'GET', signal }, { useRelay: profile.useRelay });
    await ensureOk(imgRes, 'PixAI 그림 내려받기');
    const blob = await imgRes.blob();
    const mime = blob.type || media?.imageType || 'image/png';
    return {
      blob: blob.type ? blob : new Blob([blob], { type: mime }),
      mime,
      width: media?.width ?? width,
      height: media?.height ?? height,
      seed,
      prompt: req.prompt,
      negativePrompt,
    };
  } catch (e) {
    if (taskId && isAbortError(e)) {
      // 사용자가 취소하면 서버 쪽 작업도 취소 시도 (실패해도 무시)
      gql(profile, CANCEL_TASK, { id: taskId }).catch(() => undefined);
    }
    throw toImageError('pixai', e, profile.useRelay);
  }
}

/** 그림을 그리지 않고 키만 확인 (`me` 조회 — 가정, 위 주석 참고) */
export async function testPixAI(profile: ImageProfile): Promise<ConnectionTestResult> {
  const started = Date.now();
  try {
    const data = await gql<{ me?: { id?: string } | null }>(profile, ME, {});
    if (!data.me?.id) {
      return { ok: false, message: 'PixAI: 키로 사용자 정보를 확인하지 못했습니다. 키를 확인해 주세요.', ms: Date.now() - started };
    }
    return { ok: true, message: `연결 성공 — PixAI 사용자 ${data.me.id}`, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, message: toImageError('pixai', e, profile.useRelay).message, ms: Date.now() - started };
  }
}
