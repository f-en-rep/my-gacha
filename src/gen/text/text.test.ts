import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { TextProfile, TextProviderKind } from '../../types';
import { ApiError } from '../../net/http';
import {
  JsonGenerationError,
  TextTruncatedError,
  chatComplete,
  describeTextError,
  generateJson,
  listModels,
  testTextConnection,
  type ChatMessage,
} from './index';

function profile(provider: TextProviderKind, extra: Partial<TextProfile> = {}): TextProfile {
  return {
    id: 'p1',
    type: 'text',
    label: 'test',
    apiKey: 'sk-test',
    useRelay: false,
    provider,
    model: 'test-model',
    ...extra,
  };
}

interface Call {
  url: string;
  init: RequestInit;
  headers: Headers;
  body: Record<string, unknown> | undefined;
}

let calls: Call[];
let replies: (() => Response | Promise<Response>)[];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function queue(...rs: (Response | (() => Response | Promise<Response>))[]) {
  for (const r of rs) replies.push(typeof r === 'function' ? r : () => r);
}

function openaiReply(content: string | null, finish = 'stop', extra: Record<string, unknown> = {}) {
  return json({
    model: 'served-model',
    choices: [{ message: { role: 'assistant', content }, finish_reason: finish }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
    ...extra,
  });
}

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({
        url,
        init,
        headers: new Headers(init.headers),
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
      });
      const next = replies.shift();
      if (!next) throw new Error('unexpected fetch');
      return next();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const msgs: ChatMessage[] = [
  { role: 'system', content: 'SYS' },
  { role: 'user', content: 'hi' },
];

describe('chatComplete request shape', () => {
  it('openai: max_completion_tokens, json mode, bearer', async () => {
    queue(openaiReply('hello'));
    const r = await chatComplete(profile('openai', { maxTokens: 100, temperature: 0.5 }), msgs, { json: true });
    const c = calls[0]!;
    expect(c.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(c.init.method).toBe('POST');
    expect(c.headers.get('authorization')).toBe('Bearer sk-test');
    expect(c.body).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'hi' },
      ],
      max_completion_tokens: 100,
      temperature: 0.5,
      response_format: { type: 'json_object' },
    });
    expect(r).toEqual({ text: 'hello', model: 'served-model', usage: { inputTokens: 11, outputTokens: 7 } });
  });

  it('openrouter: referer/title headers, max_tokens, json mode', async () => {
    queue(openaiReply('x'));
    await chatComplete(profile('openrouter'), msgs, { json: true, maxTokens: 50 });
    const c = calls[0]!;
    expect(c.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(c.headers.get('HTTP-Referer')).toBeTruthy();
    expect(c.headers.get('X-Title')).toBe('my-gacha');
    expect(c.body?.max_tokens).toBe(50);
    expect(c.body?.response_format).toEqual({ type: 'json_object' });
  });

  it('nanogpt: no response_format even with json', async () => {
    queue(openaiReply('x'));
    await chatComplete(profile('nanogpt'), msgs, { json: true, maxTokens: 10 });
    expect(calls[0]!.url).toBe('https://nano-gpt.com/api/v1/chat/completions');
    expect(calls[0]!.body?.response_format).toBeUndefined();
    expect(calls[0]!.body?.max_tokens).toBe(10);
  });

  it('openai-compatible: requires baseUrl and strips trailing slash', async () => {
    await expect(chatComplete(profile('openai-compatible'), msgs)).rejects.toThrow(/baseUrl/);
    queue(openaiReply('x'));
    await chatComplete(profile('openai-compatible', { baseUrl: 'http://localhost:1234/v1/' }), msgs, { json: true });
    expect(calls[0]!.url).toBe('http://localhost:1234/v1/chat/completions');
    expect(calls[0]!.body?.response_format).toBeUndefined();
    expect(calls[0]!.body && 'max_tokens' in calls[0]!.body).toBe(false);
  });

  it('anthropic: headers, top-level system, default max_tokens, clamped temperature', async () => {
    queue(
      json({
        model: 'claude-x',
        content: [
          { type: 'thinking', thinking: '...' },
          { type: 'text', text: 'Hel' },
          { type: 'text', text: 'lo' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    );
    const r = await chatComplete(
      profile('anthropic', { temperature: 1.5 }),
      [
        { role: 'system', content: 'A' },
        { role: 'system', content: 'B' },
        { role: 'user', content: 'u1' },
        { role: 'user', content: 'u2' },
      ],
      { json: true },
    );
    const c = calls[0]!;
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.headers.get('x-api-key')).toBe('sk-test');
    expect(c.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(c.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(c.headers.get('authorization')).toBeNull();
    expect(c.body).toEqual({
      model: 'test-model',
      max_tokens: 8192,
      system: 'A\n\nB',
      messages: [{ role: 'user', content: 'u1\n\nu2' }],
      temperature: 1,
    });
    expect(r).toEqual({ text: 'Hello', model: 'claude-x', usage: { inputTokens: 5, outputTokens: 3 } });
  });

  it('gemini: native generateContent mapping', async () => {
    queue(
      json({
        modelVersion: 'gemini-x',
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'thinking...', thought: true }, { text: '{"a":1}' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 10 },
      }),
    );
    const r = await chatComplete(
      profile('gemini', { model: 'models/gemini-2.5-flash', maxTokens: 64, temperature: 0.3 }),
      [...msgs, { role: 'assistant', content: 'prev' }, { role: 'user', content: 'again' }],
      { json: true },
    );
    const c = calls[0]!;
    expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(c.headers.get('x-goog-api-key')).toBe('sk-test');
    expect(c.body).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'prev' }] },
        { role: 'user', parts: [{ text: 'again' }] },
      ],
      systemInstruction: { parts: [{ text: 'SYS' }] },
      generationConfig: { maxOutputTokens: 64, temperature: 0.3, responseMimeType: 'application/json' },
    });
    expect(r).toEqual({ text: '{"a":1}', model: 'gemini-x', usage: { inputTokens: 4, outputTokens: 12 } });
  });

  it('baseUrl override and relay', async () => {
    queue(openaiReply('x'));
    await chatComplete(profile('openai', { baseUrl: 'https://proxy.example/v1', useRelay: true }), msgs);
    expect(calls[0]!.url).toBe('/api/relay');
    expect(calls[0]!.headers.get('X-Relay-Target')).toBe('https://proxy.example/v1/chat/completions');
  });

  it('passes the abort signal through', async () => {
    const ac = new AbortController();
    queue(openaiReply('x'));
    await chatComplete(profile('openai'), msgs, { signal: ac.signal });
    expect(calls[0]!.init.signal).toBe(ac.signal);
  });
});

describe('chatComplete responses', () => {
  it('length with empty content → truncated error', async () => {
    queue(openaiReply('', 'length'));
    await expect(chatComplete(profile('openrouter'), msgs)).rejects.toBeInstanceOf(TextTruncatedError);
    queue(json({ content: [], stop_reason: 'max_tokens' }));
    await expect(chatComplete(profile('anthropic'), msgs)).rejects.toThrow(/maxTokens/);
    queue(json({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }));
    await expect(chatComplete(profile('gemini'), msgs)).rejects.toBeInstanceOf(TextTruncatedError);
  });

  it('length with content → truncated flag', async () => {
    queue(openaiReply('partial', 'length'));
    const r = await chatComplete(profile('openai'), msgs);
    expect(r.truncated).toBe(true);
    expect(r.text).toBe('partial');
  });

  it('HTTP errors become ApiError with status', async () => {
    queue(json({ error: { message: 'bad key' } }, 401));
    const err = await chatComplete(profile('openai'), msgs).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it('200 with error object (openrouter) throws', async () => {
    queue(json({ error: { message: 'upstream failed', code: 502 } }));
    await expect(chatComplete(profile('openrouter'), msgs)).rejects.toThrow(/upstream failed/);
  });

  it('retries without temperature when the model rejects it', async () => {
    queue(
      json({ error: { message: "Unsupported value: 'temperature' does not support 0.5 with this model. Only the default (1) value is supported." } }, 400),
      openaiReply('ok'),
    );
    const r = await chatComplete(profile('openai', { temperature: 0.5 }), msgs);
    expect(r.text).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body && 'temperature' in calls[1]!.body).toBe(false);
  });

  it('switches to max_completion_tokens when asked', async () => {
    queue(
      json({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }, 400),
      openaiReply('ok'),
    );
    await chatComplete(profile('openai-compatible', { baseUrl: 'https://x.example/v1', maxTokens: 9 }), msgs);
    expect(calls[1]!.body?.max_completion_tokens).toBe(9);
    expect(calls[1]!.body && 'max_tokens' in calls[1]!.body).toBe(false);
  });

  it('gemini safety block throws', async () => {
    queue(json({ promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(chatComplete(profile('gemini'), msgs)).rejects.toThrow(/SAFETY/);
  });

  it('openai content arrays are joined', async () => {
    queue(json({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, finish_reason: 'stop' }] }));
    const r = await chatComplete(profile('openai-compatible', { baseUrl: 'https://x.example' }), msgs);
    expect(r.text).toBe('ab');
    expect(r.model).toBe('test-model');
    expect(r.usage).toBeUndefined();
  });
});

describe('generateJson', () => {
  const schema = z.object({ name: z.string(), stars: z.number().int().min(3).max(6) });

  it('parses fenced JSON on the first try', async () => {
    queue(openaiReply('Sure!\n```json\n{"name":"A","stars":5}\n```\nEnjoy'));
    const r = await generateJson(profile('openai'), msgs, schema);
    expect(r).toEqual({ value: { name: 'A', stars: 5 }, raw: expect.any(String), attempts: 1 });
    expect(calls[0]!.body?.response_format).toEqual({ type: 'json_object' });
  });

  it('retries with schema feedback and lower temperature', async () => {
    queue(openaiReply('{"name":"A","stars":9}'), openaiReply('{"name":"A","stars":6}'));
    const r = await generateJson(profile('openrouter', { temperature: 1.2 }), msgs, schema);
    expect(r.attempts).toBe(2);
    expect(r.value.stars).toBe(6);
    const second = calls[1]!.body!;
    expect(second.temperature).toBe(0.7);
    expect(calls[0]!.body!.temperature).toBe(1.2);
    const sent = second.messages as ChatMessage[];
    expect(sent).toHaveLength(4);
    expect(sent[2]).toEqual({ role: 'assistant', content: '{"name":"A","stars":9}' });
    expect(sent[3]!.role).toBe('user');
    expect(sent[3]!.content).toMatch(/- stars: Number must be less than or equal to 6/);
  });

  it('retries on unparseable JSON then throws descriptive error', async () => {
    queue(openaiReply('no json here'), openaiReply('{"name": "A", "stars": '), openaiReply('still nothing'));
    const err = await generateJson(profile('openai'), msgs, schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonGenerationError);
    expect((err as JsonGenerationError).attempts).toBe(3);
    expect((err as Error).message).toMatch(/3번 시도/);
    expect(calls).toHaveLength(3);
    const third = calls[2]!.body!.messages as ChatMessage[];
    expect(third[3]!.content).toMatch(/could not be parsed as JSON/);
    expect(third[5]!.content).toMatch(/incomplete/);
  });

  it('respects retries: 0', async () => {
    queue(openaiReply('{"name":1}'));
    await expect(generateJson(profile('openai'), msgs, schema, { retries: 0 })).rejects.toThrow(/name/);
    expect(calls).toHaveLength(1);
  });

  it('anthropic retry keeps alternation and system on top', async () => {
    const reply = (t: string) => json({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
    queue(reply('{"name":"A"}'), reply('{"name":"A","stars":4}'));
    const r = await generateJson(profile('anthropic'), msgs, schema);
    expect(r.value).toEqual({ name: 'A', stars: 4 });
    const b = calls[1]!.body!;
    expect(b.system).toBe('SYS');
    expect((b.messages as ChatMessage[]).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});

describe('testTextConnection', () => {
  it('ok', async () => {
    queue(openaiReply('ok'));
    const r = await testTextConnection(profile('openai'));
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/연결 성공/);
    expect(calls[0]!.body?.max_completion_tokens).toBe(16);
  });

  it('reasoning model that runs out of tokens still counts as connected', async () => {
    queue(openaiReply(null, 'length'));
    const r = await testTextConnection(profile('openrouter'));
    expect(r.ok).toBe(true);
  });

  it.each([
    [401, /API 키/],
    [403, /API 키/],
    [404, /모델 또는 주소/],
    [429, /너무 많/],
    [500, /서비스 쪽/],
  ])('HTTP %i', async (status, re) => {
    queue(json({ error: 'x' }, status));
    const r = await testTextConnection(profile('openai'));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(re);
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('gemini 400 API_KEY_INVALID is a key problem', async () => {
    queue(json({ error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }, 400));
    const r = await testTextConnection(profile('gemini'));
    expect(r.message).toMatch(/API 키/);
  });

  it('network/CORS failure suggests the relay', async () => {
    queue(() => {
      throw new TypeError('Failed to fetch');
    });
    const r = await testTextConnection(profile('nanogpt'));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/중계기 사용/);
  });

  it('describeTextError handles abort', () => {
    expect(describeTextError(new DOMException('aborted', 'AbortError'))).toMatch(/취소/);
  });
});

describe('listModels', () => {
  it('openai-like: GET /models sorted', async () => {
    queue(json({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] }));
    expect(await listModels(profile('openrouter'))).toEqual(['a', 'b']);
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/models');
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer sk-test');
  });

  it('anthropic', async () => {
    queue(json({ data: [{ id: 'claude-b' }, { id: 'claude-a' }], has_more: false }));
    expect(await listModels(profile('anthropic'))).toEqual(['claude-a', 'claude-b']);
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(calls[0]!.headers.get('x-api-key')).toBe('sk-test');
  });

  it('gemini filters non-generateContent models', async () => {
    queue(
      json({
        models: [
          { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    );
    expect(await listModels(profile('gemini'))).toEqual(['gemini-2.5-pro']);
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
  });

  it('returns [] on failure', async () => {
    queue(json({}, 500));
    expect(await listModels(profile('openai'))).toEqual([]);
    queue(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await listModels(profile('openai'))).toEqual([]);
  });
});
