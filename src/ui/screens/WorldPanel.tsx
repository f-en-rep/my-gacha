import { Icon } from '../Icon';
import { useSetupSteps } from '../setup';
import { Panel, PageHint } from '../panel/Panel';
import { useActiveGame, useWorlds } from '../../game/store';
import type { World } from '../../types';
import { WorldList } from '../world/WorldList';
import { WorldWizard } from '../world/WorldWizard';
import { WorldProgress } from '../world/WorldProgress';
import { WorldInfo } from '../world/WorldInfo';
import { isRunning, useRunnerVersion } from '../world/runner';
import { useWorldSub, worldPaths, type WorldSub } from '../world/shared';
import '../world/world.css';

export function WorldPanel() {
  const sub = useWorldSub();
  const worlds = useWorlds();
  const game = useActiveGame();
  const selectedId = sub.kind === 'world' ? sub.id : undefined;

  return (
    <Panel
      name="world"
      code="WORLD"
      title="월드"
      focus={sub.kind === 'none' ? 'left' : 'right'}
      back={worldPaths.root}
      left={
        <div className="stack">
          <WorldList worlds={worlds} activeId={game.world?.id} selectedId={selectedId ?? (sub.kind === 'none' ? game.world?.id : undefined)} />
          <SetupChecklist />
        </div>
      }
      right={<Right sub={sub} worlds={worlds} game={game} />}
    />
  );
}

function Right({ sub, worlds, game }: { sub: WorldSub; worlds: World[] | undefined; game: ReturnType<typeof useActiveGame> }) {
  useRunnerVersion();
  if (sub.kind === 'new') return <WorldWizard />;
  if (!worlds || game.loading) return null;

  let world: World | undefined;
  if (sub.kind === 'world') {
    world = worlds.find((w) => w.id === sub.id);
    if (!world) return <PageHint>월드를 찾을 수 없습니다. 지워졌을 수 있습니다.</PageHint>;
  } else {
    // 넓은 화면 기본: 플레이 중인 월드, 없으면 이 탭에서 만들고 있는 월드
    world = game.world ?? worlds.find((w) => w.status !== 'ready' && isRunning(w.id));
    if (!world) return <PageHint>새 월드를 만들거나, 친구에게 받은 월드 팩을 열어 보세요.</PageHint>;
  }

  if (world.status !== 'ready') return <WorldProgress key={world.id} world={world} />;
  const active = world.id === game.world?.id;
  return <WorldInfo key={world.id} world={world} save={active ? game.save : undefined} active={active} />;
}

function SetupChecklist() {
  const steps = useSetupSteps();
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  return (
    <div>
      <div className="page-section-head">
        <h2>시작 전에</h2>
        <span className="mono muted">
          {done}/{required.length}
        </span>
      </div>
      <ol className="checklist">
        {steps.map((s) => (
          <li key={s.label}>
            <a href={'#' + s.href} className={s.done ? 'done' : ''}>
              <span className="check" aria-hidden="true">
                {s.done ? '✓' : ''}
              </span>
              <span className="checklist-text">
                <strong>
                  {s.label}
                  {s.optional && <span className="tag-optional">선택</span>}
                </strong>
                <small>{s.hint}</small>
              </span>
              <Icon name="chevron" size={18} />
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
