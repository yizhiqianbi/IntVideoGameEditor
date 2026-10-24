"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicContentEntry, PublicContentType } from "@/lib/public-catalog";
import {
  exitDocumentFullscreen,
  getFullscreenElement,
  isFullscreenSupported,
  requestElementFullscreen,
} from "./fullscreen";
import { PlayRuntimeStage } from "./play-runtime-stage";
import styles from "./detail-page.module.css";

type RuntimeStageShellProps = {
  entry: PublicContentEntry;
  type: PublicContentType;
  slug: string;
  isMiniGame: boolean;
};

function getRuntimeLabel(type: PublicContentType) {
  if (type === "video") return "视频播放区域";
  if (type === "film") return "互动影游运行区";
  return "小游戏运行区";
}

function getTypeLabel(type: PublicContentType) {
  if (type === "film") return "互动影游";
  if (type === "play") return "Play";
  return "视频";
}

export function RuntimeStageShell({
  entry,
  type,
  slug,
  isMiniGame,
}: RuntimeStageShellProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);

  const toneClassName = useMemo(() => {
    return styles[`tone${entry.coverTone[0].toUpperCase()}${entry.coverTone.slice(1)}`];
  }, [entry.coverTone]);

  useEffect(() => {
    const syncFullscreenState = () => {
      const fullscreenElement = getFullscreenElement(document);
      setIsFullscreen(Boolean(stageRef.current && fullscreenElement === stageRef.current));
    };

    setCanFullscreen(
      isFullscreenSupported(stageRef.current ?? document.documentElement),
    );
    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState as EventListener);

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState as EventListener);
    };
  }, []);

  const handleToggleFullscreen = async () => {
    if (!stageRef.current || !canFullscreen) {
      return;
    }

    try {
      if (isFullscreen) {
        await exitDocumentFullscreen(document);
      } else {
        await requestElementFullscreen(stageRef.current);
      }
    } catch {
      // Keep this silent for now; browser gesture/fullscreen support varies.
    }
  };

  return (
    <section className={styles.runtimeShell}>
      <div className={styles.runtimeTopBar}>
        <div className={styles.runtimeMeta}>
          <span className={styles.runtimePill}>{getTypeLabel(type)}</span>
          {entry.durationLabel ? (
            <span className={styles.runtimePill}>{entry.durationLabel}</span>
          ) : null}
        </div>
      </div>

      <div
        ref={stageRef}
        className={`${styles.runtimeStage} ${
          isMiniGame ? styles.runtimeStagePlay : toneClassName
        } ${isFullscreen ? styles.runtimeStageFullscreen : ""}`}
      >
        <button
          type="button"
          className={`${styles.fullscreenButton} ${
            canFullscreen ? "" : styles.fullscreenButtonHidden
          }`}
          onClick={handleToggleFullscreen}
          disabled={!canFullscreen}
          aria-hidden={!canFullscreen}
          tabIndex={canFullscreen ? 0 : -1}
        >
          {isFullscreen ? "退出全屏" : "全屏"}
        </button>

        {isMiniGame ? (
          <PlayRuntimeStage slug={slug} />
        ) : (
          <div className={styles.runtimeCenter}>
            <span className={styles.runtimeTitle}>{entry.title}</span>
            <span className={styles.runtimeLabel}>{getRuntimeLabel(type)}</span>
          </div>
        )}
      </div>
    </section>
  );
}
