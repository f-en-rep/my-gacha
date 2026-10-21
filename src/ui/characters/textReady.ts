// 구조화 작업(JSON)에 글 연결이 지정되어 있는지. 캐릭터 편집·카드 가져오기가 같이 쓴다
import { useProfiles, useSettings } from '../hooks';

export function useTextReady(): { ready: boolean; hasProfile: boolean } | undefined {
  const profiles = useProfiles();
  const settings = useSettings();
  if (!profiles) return undefined;
  const id = settings.routing.structured;
  return {
    ready: !!id && profiles.some((p) => p.id === id && p.type === 'text'),
    hasProfile: profiles.some((p) => p.type === 'text'),
  };
}
