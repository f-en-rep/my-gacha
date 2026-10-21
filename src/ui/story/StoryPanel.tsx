import { EmptyState } from '../common';
import { Panel } from '../panel/Panel';

export function StoryPanel(_props: { chapterId?: string; read?: boolean }) {
  return <Panel name="story" code="STORY" title="스토리" left={<EmptyState title="준비 중" />} right={null} />;
}
