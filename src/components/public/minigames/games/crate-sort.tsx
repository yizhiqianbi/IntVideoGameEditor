"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../shared.module.css";
import type { MiniGameRenderProps } from "../types";

type ZoneId = "red" | "blue" | "green" | "amber";

type SortZone = {
  id: ZoneId;
  name: string;
  color: string;
  accent: string;
  marker: string;
  hint: string;
};

type Crate = {
  id: string;
  code: string;
  zoneId: ZoneId;
  color: string;
  marker: string;
};

const GAME_DURATION = 35;

const ZONES: SortZone[] = [
  {
    id: "red",
    name: "红区",
    color: "#ff6b6b",
    accent: "#ffd0d0",
    marker: "▲",
    hint: "接收红色三角标记的货箱",
  },
  {
    id: "blue",
    name: "蓝区",
    color: "#4dabf7",
    accent: "#c9e4ff",
    marker: "●",
    hint: "接收蓝色圆形标记的货箱",
  },
  {
    id: "green",
    name: "绿区",
    color: "#51cf66",
    accent: "#d4f8da",
    marker: "■",
    hint: "接收绿色方形标记的货箱",
  },
  {
    id: "amber",
    name: "黄区",
    color: "#fcc419",
    accent: "#fff0b8",
    marker: "◆",
    hint: "接收黄色菱形标记的货箱",
  },
];

const CRATE_BLUEPRINTS: Array<Omit<Crate, "id">> = [
  { code: "A-01", zoneId: "red", color: "#ff6b6b", marker: "▲" },
  { code: "A-02", zoneId: "red", color: "#ff8787", marker: "▲" },
  { code: "A-03", zoneId: "red", color: "#ff922b", marker: "▲" },
  { code: "B-04", zoneId: "blue", color: "#4dabf7", marker: "●" },
  { code: "B-05", zoneId: "blue", color: "#74c0fc", marker: "●" },
  { code: "B-06", zoneId: "blue", color: "#339af0", marker: "●" },
  { code: "C-07", zoneId: "green", color: "#51cf66", marker: "■" },
  { code: "C-08", zoneId: "green", color: "#69db7c", marker: "■" },
  { code: "C-09", zoneId: "green", color: "#40c057", marker: "■" },
  { code: "D-10", zoneId: "amber", color: "#fcc419", marker: "◆" },
  { code: "D-11", zoneId: "amber", color: "#ffd43b", marker: "◆" },
  { code: "D-12", zoneId: "amber", color: "#fab005", marker: "◆" },
];

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function getZoneById(zoneId: ZoneId) {
  return ZONES.find((zone) => zone.id === zoneId)!;
}

export function CrateSortGame({ onFinish }: MiniGameRenderProps) {
  const crates = useMemo(
    () =>
      shuffle(
        CRATE_BLUEPRINTS.map((crate, index) => ({
          ...crate,
          id: `crate-${index}-${crate.code}`,
        })),
      ),
    [],
  );

  const crateById = useMemo(
    () => new Map(crates.map((crate) => [crate.id, crate])),
    [crates],
  );

  const [secondsLeft, setSecondsLeft] = useState(GAME_DURATION);
  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Record<string, ZoneId>>({});
  const [errors, setErrors] = useState(0);
  const [message, setMessage] = useState("先点选一个货箱，再点目标区，或直接拖拽到货区。");
  const [finished, setFinished] = useState(false);
  const finishGuard = useRef(false);

  const placedCount = Object.keys(placed).length;
  const remainingCount = crates.length - placedCount;

  const finishGame = useCallback(
    (reason: "completed" | "timeout") => {
      if (finishGuard.current) {
        return;
      }

      finishGuard.current = true;
      setFinished(true);

      const score =
        reason === "completed"
          ? Math.max(0, 100 + secondsLeft * 2 - errors * 5)
          : Math.max(0, placedCount * 8 - errors * 4);

      const summary =
        reason === "completed"
          ? `全部分拣完成，${placedCount}/${crates.length} 正确，错误 ${errors} 次，剩余 ${secondsLeft} 秒。`
          : `时间到，${placedCount}/${crates.length} 正确，错误 ${errors} 次。`;

      onFinish(score, summary);
    },
    [crates.length, errors, onFinish, placedCount, secondsLeft],
  );

  const handlePlace = (crateId: string, zoneId: ZoneId) => {
    if (finished) {
      return;
    }

    const crate = crateById.get(crateId);
    if (!crate || placed[crateId]) {
      return;
    }

    const targetZone = getZoneById(zoneId);
    const sourceZone = getZoneById(crate.zoneId);

    if (crate.zoneId === zoneId) {
      setPlaced((current) => {
        if (current[crateId]) {
          return current;
        }

        return { ...current, [crateId]: zoneId };
      });
      setSelectedCrateId(null);
      setMessage(`正确：${crate.code} 已送入 ${targetZone.name}。`);
      if (placedCount + 1 === crates.length) {
        finishGame("completed");
      }
      return;
    }

    setErrors((current) => current + 1);
    setMessage(`错误：${crate.code} 应该送入 ${sourceZone.name}，不是 ${targetZone.name}。`);
  };

  useEffect(() => {
    if (finished) {
      return;
    }

    const timer = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          finishGame("timeout");
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [finishGame, finished]);

  const progress = (placedCount / crates.length) * 100;

  return (
    <section className={styles.gameRoot}>
      <div className={styles.hud}>
        <div className={styles.stats}>
          <span className={styles.pill}>时间 {secondsLeft}s / {GAME_DURATION}s</span>
          <span className={styles.pill}>正确 {placedCount}</span>
          <span className={styles.pill}>错误 {errors}</span>
          <span className={styles.pill}>剩余 {remainingCount}</span>
        </div>
        <span className={styles.result}>{finished ? "本局已结束" : message}</span>
      </div>

      <div className={styles.board}>
        <div className={styles.panel}>
          <p className={styles.headline}>货箱分拣</p>
          <p className={styles.subheadline}>
            将货箱送到正确区域。移动端可直接点选货箱，再点目标区，不必依赖原生拖拽。
          </p>

          <div
            style={{
              marginTop: 12,
              height: 10,
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
            aria-hidden="true"
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                borderRadius: 999,
                background:
                  "linear-gradient(90deg, rgba(255,255,255,0.95), rgba(255,255,255,0.5))",
                transition: "width 180ms ease",
              }}
            />
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.grid2}>
            {ZONES.map((zone) => {
              const zoneCrates = crates.filter((crate) => placed[crate.id] === zone.id);
              const selectedHint =
                selectedCrateId && crateById.get(selectedCrateId)
                  ? `当前选中 ${crateById.get(selectedCrateId)?.code}`
                  : "先选一个货箱";

              return (
                <button
                  key={zone.id}
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => {
                    if (selectedCrateId) {
                      handlePlace(selectedCrateId, zone.id);
                      return;
                    }

                    setMessage(`${zone.name} 已就绪，${selectedHint}。`);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const crateId = event.dataTransfer.getData("text/plain");
                    if (crateId) {
                      handlePlace(crateId, zone.id);
                    }
                  }}
                  disabled={finished}
                  style={{
                    minHeight: 128,
                    textAlign: "left",
                    padding: 16,
                    borderColor:
                      selectedCrateId && crateById.get(selectedCrateId)?.zoneId === zone.id
                        ? zone.color
                        : "rgba(255,255,255,0.1)",
                    background: `linear-gradient(180deg, ${zone.color}18, rgba(255,255,255,0.04))`,
                    color: "rgba(255,255,255,0.95)",
                  }}
                  aria-label={`分拣到${zone.name}`}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          fontWeight: 800,
                          fontSize: 16,
                        }}
                      >
                        <span
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 12,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: zone.color,
                            color: "#081018",
                          }}
                        >
                          {zone.marker}
                        </span>
                        {zone.name}
                      </div>
                      <div style={{ marginTop: 8, color: "rgba(255,255,255,0.72)", fontSize: 13 }}>
                        {zone.hint}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", color: "rgba(255,255,255,0.72)", fontSize: 13 }}>
                      <div>已收 {zoneCrates.length}</div>
                      <div>目标 {ZONES.length === 1 ? "-" : "分区"}</div>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    {zoneCrates.length > 0 ? (
                      zoneCrates.map((crate) => (
                        <span
                          key={crate.id}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.08)",
                            fontSize: 12,
                          }}
                        >
                          {crate.code}
                        </span>
                      ))
                    ) : (
                      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
                        这里还没有货箱
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.hud} style={{ marginBottom: 12 }}>
            <div>
              <p className={styles.headline} style={{ fontSize: 18 }}>
                待分拣货箱
              </p>
              <p className={styles.subheadline}>点击选中，再点目标区；也可以直接拖到对应区域。</p>
            </div>
            {selectedCrateId ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setSelectedCrateId(null)}
                disabled={finished}
              >
                取消选中
              </button>
            ) : null}
          </div>

          <div className={styles.grid4}>
            {crates.map((crate) => {
              const placedZone = placed[crate.id] ? getZoneById(placed[crate.id]) : null;
              const selected = selectedCrateId === crate.id;
              const baseShadow = selected
                ? `0 0 0 2px ${crate.color}, 0 0 0 6px rgba(255,255,255,0.08)`
                : "none";

              return (
                <button
                  key={crate.id}
                  type="button"
                  className={styles.secondaryButton}
                  draggable={!finished && !placedZone}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", crate.id);
                    setSelectedCrateId(crate.id);
                  }}
                  onClick={() => {
                    if (finished || placedZone) {
                      return;
                    }

                    setSelectedCrateId((current) => (current === crate.id ? null : crate.id));
                    setMessage(
                      selected
                        ? "已取消选中。"
                        : `已选中 ${crate.code}，再点目标区即可分配。`,
                    );
                  }}
                  disabled={finished || Boolean(placedZone)}
                  aria-pressed={selected}
                  style={{
                    minHeight: 110,
                    padding: 14,
                    textAlign: "left",
                    borderColor: selected ? crate.color : "rgba(255,255,255,0.1)",
                    background: `linear-gradient(180deg, ${crate.color}24, rgba(255,255,255,0.04))`,
                    boxShadow: baseShadow,
                    opacity: placedZone ? 0.72 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 14,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#081018",
                        background: crate.color,
                        fontSize: 20,
                        fontWeight: 900,
                      }}
                    >
                      {crate.marker}
                    </div>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>
                      {placedZone ? `已入 ${placedZone.name}` : "未分配"}
                    </span>
                  </div>
                  <div style={{ marginTop: 12, fontWeight: 800, letterSpacing: 0.4 }}>{crate.code}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "rgba(255,255,255,0.68)" }}>
                    拖到正确货区，或点选后再点目标区
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
