"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./html-sandbox.module.css";

type Status = "idle" | "running" | "finished" | "error";

export type SandboxFinishPayload = {
  score?: number;
  summary?: string;
};

export type SandboxEventPayload = {
  name: string;
  data?: unknown;
};

export function HtmlSandbox({
  html,
  autoRun = true,
  onFinish,
  onEvent,
  onError,
  reloadKey,
}: {
  html: string;
  autoRun?: boolean;
  onFinish?: (payload: SandboxFinishPayload) => void;
  onEvent?: (payload: SandboxEventPayload) => void;
  onError?: (message: string) => void;
  reloadKey?: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<Status>(autoRun ? "running" : "idle");
  const [lastEvent, setLastEvent] = useState<string>("准备就绪");
  const [internalReloadKey, setInternalReloadKey] = useState(0);

  const effectiveReloadKey = (reloadKey ?? 0) + internalReloadKey;

  useEffect(() => {
    setStatus(autoRun ? "running" : "idle");
    setLastEvent("重载中…");
  }, [effectiveReloadKey, autoRun]);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!iframeRef.current) return;
      if (e.source !== iframeRef.current.contentWindow) return;

      const data = e.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "finish") {
        setStatus("finished");
        setLastEvent(
          typeof data.score === "number" ? `结束 · ${data.score} 分` : "游戏结束",
        );
        onFinish?.({ score: data.score, summary: data.summary });
      } else if (data.type === "error") {
        setStatus("error");
        setLastEvent(String(data.message || "Runtime error"));
        onError?.(String(data.message || "Runtime error"));
      } else if (data.type === "event") {
        setLastEvent(
          data.name + (data.data?.score != null ? ` · ${data.data.score}` : ""),
        );
        onEvent?.({ name: String(data.name), data: data.data });
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onFinish, onEvent, onError]);

  function reload() {
    setInternalReloadKey((k) => k + 1);
  }

  if (!html || html.trim().length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🎮</span>
          <p>还没有可运行的游戏 — 用左侧 AI 助手描述你想做的玩法</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={reload}
          title="重载"
          aria-label="重载"
        >
          ⟳
        </button>
      </div>
      <iframe
        ref={iframeRef}
        key={effectiveReloadKey}
        className={styles.frame}
        srcDoc={html}
        sandbox="allow-scripts allow-pointer-lock"
        title="H5 Game Preview"
      />
      <div
        className={`${styles.statusBar} ${status === "error" ? styles.error : ""}`}
      >
        <span className={styles.statusDot}>
          <span
            className={`${styles.dot} ${
              status === "idle"
                ? styles.idle
                : status === "error"
                  ? styles.errorDot
                  : status === "finished"
                    ? styles.finished
                    : ""
            }`}
          />
          {status === "running"
            ? "运行中"
            : status === "finished"
              ? "已结束"
              : status === "error"
                ? "错误"
                : "待机"}
        </span>
        <span style={{ opacity: 0.7 }}>{lastEvent}</span>
      </div>
    </div>
  );
}
