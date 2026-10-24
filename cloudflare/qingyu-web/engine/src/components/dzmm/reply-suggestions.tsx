"use client";

import { useEffect, useRef, useState } from "react";
import type { DzmmReplySuggestion } from "../../lib/dzmm-reply-suggestions";
import { readDzmmSuggestionCache, writeDzmmSuggestionCache, type DzmmSuggestionCacheEntry } from "../../lib/dzmm-reply-suggestions-cache";
import Icon from "./icons";
import s from "./reply-suggestions.module.css";

type Props = {
  contextKey: string; accountId: string; automatic: boolean; label: string; disabled: boolean; billed: boolean; historical: boolean;
  onAutomaticStart: () => void;
  onGenerate: (signal: AbortSignal) => Promise<DzmmReplySuggestion[]>;
  onChoose: (reply: string) => void;
};
type Result = { key: string; options?: DzmmReplySuggestion[]; error?: string; pending?: boolean };

export default function ReplySuggestions({ contextKey, accountId, automatic, label, disabled, billed, historical, onAutomaticStart, onGenerate, onChoose }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const request = useRef<AbortController | null>(null);
  const cached = result?.key === contextKey ? null : readDzmmSuggestionCache(accountId, contextKey);
  const current: Result | null = result?.key === contextKey ? result : cached ? {
    key: contextKey, options: cached.options, error: cached.status === "pending"
      ? "上次建议未完成，可重试；聊天原文已保留。" : cached.error,
  } : null;
  const visible = expanded ?? (Boolean(current?.options) || !historical);
  useEffect(() => () => { const abort = request.current; request.current = null; abort?.abort(); }, [contextKey]);
  async function generate(auto = false) {
    if (disabled || request.current || (auto && readDzmmSuggestionCache(accountId, contextKey))) return;
    const abort = new AbortController(); request.current = abort;
    const save = (value: Omit<DzmmSuggestionCacheEntry, "key" | "updatedAt">) =>
      writeDzmmSuggestionCache(accountId, { ...value, key: contextKey, updatedAt: Date.now() });
    save({ status: "pending" });
    onAutomaticStart();
    setExpanded(true); setResult({ key: contextKey, pending: true });
    try {
      const options = await onGenerate(abort.signal);
      if (request.current !== abort || abort.signal.aborted) return;
      save({ status: "ready", options }); setResult({ key: contextKey, options });
    } catch (failure) {
      if (request.current !== abort) return;
      const error = failure instanceof Error && failure.name === "AbortError"
        ? "已停止生成建议，聊天和输入文字已保留。" : failure instanceof Error ? failure.message : "建议生成失败，请重试。";
      save({ status: "error", error }); setResult({ key: contextKey, error });
    } finally { if (request.current === abort) request.current = null; }
  }
  const generateRef = useRef(generate); generateRef.current = generate;
  // Only successful new replies are eligible. Deferring one tick avoids StrictMode's
  // rehearsal creating and then aborting an actual paid request.
  useEffect(() => {
    if (!automatic || disabled) return;
    const timer = setTimeout(() => void generateRef.current(true), 0);
    return () => clearTimeout(timer);
  }, [automatic, contextKey, disabled]);
  function choose(reply: string) {
    if (disabled || current?.pending) return;
    try {
      onChoose(reply);
      setResult(previous => ({ ...(previous?.key === contextKey ? previous : current), key: contextKey, error: undefined }));
    }
    catch (failure) { setResult(previous => ({ ...(previous?.key === contextKey ? previous : current), key: contextKey,
      error: failure instanceof Error ? failure.message : "无法填入建议，请重试。" })); }
  }
  return <section className={s.root} aria-label={`${label}的行动建议`}>
    <button type="button" className={s.trigger} aria-label={`${label}帮我想想`} disabled={disabled || current?.pending}
      aria-expanded={visible && Boolean(current)} onClick={() => { if (current?.options) setExpanded(!visible); else void generate(); }}>
      <Icon name="sparkles" size={13} />{current?.pending ? "正在想下一步…" : "帮我想想"}
    </button>
    {visible && current && <div className={s.panel} aria-busy={Boolean(current.pending)}>
      <header><strong>下一步，选你想走的方向</strong>{current.options && <button type="button" disabled={disabled} onClick={() => void generate()}>换一组</button>}</header>
      {current.pending && <p className={s.note} role="status">正在根据这段剧情生成三个不同方向，你可以继续输入…</p>}
      {current.options && <div className={s.options}>{current.options.map(option => <button type="button" key={option.direction}
        className={s.option} disabled={disabled} aria-label={`${option.direction}：${option.title}`} onClick={() => choose(option.reply)}>
        <span className={s.direction}>{option.direction}</span><strong>{option.title}</strong><span className={s.reply}>{option.reply}</span>
      </button>)}</div>}
      {current.error && <p className={s.error} role="alert">{current.error}{!current.options && <button type="button" disabled={disabled} onClick={() => void generate()}>重试</button>}</p>}
      <p className={s.note}>{historical ? "选择后从这条回复开启新分支，原会话保留。" : "点击填入输入框，可修改后发送；已有文字会保留。"}{billed && " 生成建议使用 Credit。"}</p>
    </div>}
  </section>;
}
