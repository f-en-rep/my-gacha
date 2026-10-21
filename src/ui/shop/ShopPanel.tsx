import { EmptyState } from '../common';
import { Panel } from '../panel/Panel';

export function ShopPanel() {
  return <Panel name="shop" code="SHOP" title="상점" left={<EmptyState title="준비 중" />} right={null} />;
}
