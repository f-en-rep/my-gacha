// 프롬프트 틀과 사용자가 고친 글. 고친 글은 설정(AppSettings.prompts)에 이 브라우저에만 저장된다.
import { getSettings } from '../../db';
import { promptTemplate, type PromptId } from './registry';
import { cleanOverrides, type PromptCtx } from './template';

export { PROMPT_TEMPLATES, promptTemplate, type PromptId, type PromptOverrides } from './registry';
export { cleanOverrides, fill, isOverride, type PromptCtx, type PromptSection, type PromptTemplate, type SectionOverrides, type TraceEntry } from './template';

/** 생성할 때 쓸 고친 글. 없으면 빈 ctx (기본 프롬프트) */
export async function promptCtx(id: PromptId): Promise<PromptCtx> {
  const overrides = cleanOverrides(promptTemplate(id), (await getSettings()).prompts?.[id]);
  return overrides ? { overrides } : {};
}
