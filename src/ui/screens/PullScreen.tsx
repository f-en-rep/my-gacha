import { useEffect, useMemo, useRef, useState } from "react";
import { exchangeSpark, pull, type PullOutcome } from "../../core/gacha";
import { now } from "../../core/id";
import { paintPortrait } from "../../game/portraits";
import {
  commitPull,
  putSave,
  rulesFor,
  useActiveGame,
  useBanners,
  useCast,
  usePullHistory,
} from "../../game/store";
import type { Character, Id, Save } from "../../types";
import { EmptyState } from "../common";
import { useSettings } from "../hooks";
import { PageHint, Panel } from "../panel/Panel";
import { navigate, paths } from "../router";
import { BannerDetail } from "../pull/BannerDetail";
import { BannerEditor } from "../pull/BannerEditor";
import { BannerList } from "../pull/BannerList";
import { PullHistory } from "../pull/PullHistory";
import { Reveal } from "../pull/Reveal";
import "../pull/pull.css";

const SELECTED_KEY = "my-gacha:pull-banner";

function readSelected(): Id | undefined {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSelected(id: Id): void {
  try {
    localStorage.setItem(SELECTED_KEY, id);
  } catch {
    /* 저장 못 해도 상관없음 */
  }
}

interface RevealState {
  outcomes: PullOutcome[];
  title: string;
}

function NoWorld({ draft }: { draft: boolean }) {
  return (
    <EmptyState
      title={
        draft
          ? "월드가 아직 준비되지 않았습니다"
          : "플레이 중인 월드가 없습니다"
      }
      badge="NO WORLD"
    >
      <p>
        {draft
          ? "월드 생성을 마치면 상시 배너가 열립니다."
          : "월드를 만들거나 가져오면 배너가 열립니다."}
      </p>
      <p style={{ marginTop: 12 }}>
        <a className="btn btn-primary" href={"#" + paths.world}>
          월드로 가기
        </a>
      </p>
    </EmptyState>
  );
}

export function PullPanel({
  banner: editing,
}: { banner?: "new" | { edit: Id } } = {}) {
  const { loading, world, save } = useActiveGame();
  const ready = !!world && world.status === "ready" && !!save;
  const banners = useBanners(ready ? world.id : undefined);
  const cast = useCast(ready ? world.id : undefined);
  const history = usePullHistory(ready ? save.id : undefined, 500);
  const settings = useSettings();
  const rules = useMemo(() => rulesFor(world), [world]);

  const [selectedId, setSelectedId] = useState<Id | undefined>(readSelected);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [reveal, setReveal] = useState<RevealState>();
  const lock = useRef(false);
  /** 방금 저장한 세이브. liveQuery가 따라오기 전에 다시 뽑아도 옛 세이브로 계산하지 않게 */
  const committed = useRef<Save | undefined>(undefined);

  const banner = banners?.find((b) => b.id === selectedId) ?? banners?.[0];

  useEffect(() => {
    setMessage(undefined);
  }, [banner?.id]);

  if (loading)
    return (
      <Panel
        name="pull"
        code="HEADHUNT"
        title="뽑기"
        left={null}
        right={null}
      />
    );

  if (!world || !save || world.status !== "ready") {
    return (
      <Panel
        name="pull"
        code="HEADHUNT"
        title="뽑기"
        focus="left"
        left={<NoWorld draft={!!world && world.status !== "ready"} />}
        right={<PageHint>배너가 열리면 여기에서 뽑을 수 있습니다.</PageHint>}
      />
    );
  }

  const latestSave = (): Save => {
    const c = committed.current;
    return c && c.id === save.id && c.updatedAt > save.updatedAt ? c : save;
  };

  const paintNew = (outcomes: PullOutcome[]) => {
    const seen = new Set<Id>();
    for (const o of outcomes) {
      const c: Character =
        cast?.find((x) => x.id === o.character.id) ?? o.character;
      if (!o.isNew || c.portraitId || seen.has(c.id)) continue;
      if (c.rarity <= 4 && !settings.autoPaintLowRarity) continue;
      seen.add(c.id);
      paintPortrait(c.id, { priority: "background" }).catch((e: unknown) =>
        console.warn("초상화 그리기 실패", c.id, e),
      );
    }
  };

  const onPull = async (count: 1 | 10) => {
    if (lock.current || !banner || !cast) return;
    lock.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const res = pull({
        save: latestSave(),
        banner,
        cast,
        rules,
        count,
        now: now(),
      });
      if (!res.ok) {
        setMessage(
          res.error === "insufficient-funds"
            ? `${world.currency.pull || "재화"}이(가) 부족합니다.`
            : "이 배너에서 나올 캐릭터가 없습니다.",
        );
        return;
      }
      await commitPull(res.save, res.records);
      committed.current = res.save;
      setPage(0);
      setReveal({
        outcomes: res.results,
        title: `${banner.name} · ${count}회`,
      });
      paintNew(res.results);
    } catch (e) {
      console.error(e);
      setMessage("저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const onSpark = async (characterId: Id) => {
    if (lock.current || !banner || !cast) return;
    lock.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const res = exchangeSpark({
        save: latestSave(),
        banner,
        cast,
        rules,
        characterId,
        now: now(),
      });
      if (!res.ok) {
        setMessage(
          res.error === "insufficient-points"
            ? "교환 포인트가 부족합니다."
            : "교환할 수 없는 캐릭터입니다.",
        );
        return;
      }
      await putSave(res.save);
      committed.current = res.save;
      setReveal({ outcomes: [res.outcome], title: `${banner.name} · 교환` });
      paintNew([res.outcome]);
    } catch (e) {
      console.error(e);
      setMessage("저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const select = (id: Id) => {
    setSelectedId(id);
    writeSelected(id);
  };

  const historyProps = {
    records: history,
    cast: cast ?? [],
    banners: banners ?? [],
    page,
    onPage: setPage,
  };
  const shownSave = latestSave();

  return (
    <>
      <Panel
        name="pull"
        code="HEADHUNT"
        title="뽑기"
        left={
          <div className="pl-left">
            {save.freeMode && (
              <span className="pl-free pl-free-top">자유 모드</span>
            )}
            {banners && banners.length > 0 ? (
              <BannerList
                banners={banners}
                selectedId={
                  editing && editing !== "new"
                    ? editing.edit
                    : editing === "new"
                      ? undefined
                      : banner?.id
                }
                onSelect={(id) => {
                  select(id);
                  if (editing) navigate(paths.pull);
                }}
                editable
                creating={editing === "new"}
              />
            ) : banners ? (
              <EmptyState title="열린 배너가 없습니다">
                <p>
                  <a href={"#" + paths.newBanner}>새 배너 만들기</a>로 배너를
                  추가하세요.
                </p>
              </EmptyState>
            ) : null}
            <PullHistory
              {...historyProps}
              className="pl-history-wide"
              idSuffix="wide"
            />
          </div>
        }
        focus={editing ? "right" : "both"}
        back={editing ? paths.pull : undefined}
        right={
          editing ? (
            banners && cast ? (
              <BannerEditor
                world={world}
                banners={banners}
                cast={cast}
                mode={editing}
                onSaved={select}
              />
            ) : null
          ) : (
            <div className="pl-right">
              {banner && cast ? (
                <BannerDetail
                  world={world}
                  save={shownSave}
                  banner={banner}
                  cast={cast}
                  rules={rules}
                  busy={busy || !!reveal}
                  message={message}
                  onPull={(n) => void onPull(n)}
                  onSpark={(id) => void onSpark(id)}
                />
              ) : null}
              <PullHistory
                {...historyProps}
                className="pl-history-narrow"
                idSuffix="narrow"
              />
            </div>
          )
        }
      />
      {reveal && (
        <Reveal
          outcomes={reveal.outcomes}
          cast={cast}
          title={reveal.title}
          shopName={world.currency.shop || "상점 재화"}
          onClose={() => setReveal(undefined)}
        />
      )}
    </>
  );
}
