// 시작 준비 단계. 로비 대사와 월드 패널이 같이 쓴다
import { useProfiles, useSettings } from './hooks';
import { paths } from './router';

export interface SetupStep {
  done: boolean;
  label: string;
  hint: string;
  href: string;
  /** 없어도 시작할 수 있는 단계 */
  optional?: boolean;
}

export function useSetupSteps(): SetupStep[] {
  const profiles = useProfiles() ?? [];
  const settings = useSettings();
  return [
    { done: profiles.some((p) => p.type === 'text'), label: '글 연결 추가', hint: 'OpenRouter, Claude, Gemini …', href: paths.connection('new-text') },
    { done: !!settings.routing.structured, label: '작업별 연결 지정', hint: '어떤 일에 어떤 모델을 쓸지', href: paths.routing },
    {
      done: profiles.some((p) => p.type === 'image'),
      label: '그림 연결 추가',
      hint: 'NovelAI, PixAI · 나중에 해도 됩니다',
      href: paths.connection('new-image'),
      optional: true,
    },
  ];
}

