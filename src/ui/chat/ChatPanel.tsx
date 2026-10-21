import { EmptyState } from '../common';
import { Panel } from '../panel/Panel';

export function ChatPanel(_props: { characterId?: string }) {
  return <Panel name="chat" code="TALK" title="대화" left={<EmptyState title="준비 중" />} right={null} />;
}
