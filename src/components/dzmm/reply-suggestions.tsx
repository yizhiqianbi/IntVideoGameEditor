"use client";

import { useEffect, useRef, useState } from "react";
import type { DzmmReplySuggestion } from "../../lib/dzmm-reply-suggestions";
import { splitXumengSpeech } from "../../lib/xumeng-message-presentation";
import { readDzmmSuggestionCache, writeDzmmSuggestionCache, type DzmmSuggestionCacheEntry } from "../../lib/dzmm-reply-suggestions-cache";
import Icon from "./icons";
import s from "./reply-suggestions.module.css";

type Props = {
  contextKey: string; accountId: string; automatic: boolean; label: string; disabled: boolean; historical: boolean;
  onAutomaticStart: () => void;
  onGenerate: (signal: AbortSignal) => Promise<DzmmReplySuggestion[]>;
  onChoose: (reply: string) => boolean | Promise<boolean>;
};
type Result = { key: string; options?: DzmmReplySuggestion[]; error?: string; pending?: boolean; dismissed?: boolean };

export default function ReplySuggestions({ contextKey, accountId, automatic, label, disabled, historical, onAutomaticStart, onGenerate, onChoose }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cached = result?.key === contextKey ? null : readDzmmSuggestionCache(accountId, contextKey);
  const current: Result | null = result?.key === contextKey ? result : cached ? {
    key: contextKey, dismissed: cached.dismissed, options: cached.dismissed ? undefined : cached.options,
    error: cached.dismissed ? undefined : cached.status === "pending" ? "上次没生成完，请重试。" : cached.error,
  } : null;
  const visible = expanded ?? Boolean(current?.options);
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
      const network = failure instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(failure.message);
      const error = failure instanceof Error && failure.name === "AbortError"
        ? "已停止。" : network ? "建议服务暂时无法连接，请稍后重试。" : failure instanceof Error ? failure.message : "建议生成失败，请重试。";
      save({ status: "error", error }); setResult({ key: contextKey, error });
    } finally { if (request.current === abort) request.current = null; }
  }
  const generateRef = useRef(generate); generateRef.current = generate;
  const suggestionCount = current?.options?.length ?? 0;
  const suggestionPending = Boolean(current?.pending);
  const suggestionError = current?.error ?? "";
  useEffect(() => {
    const panel = panelRef.current;
    if (!visible || !panel || (!suggestionCount && !suggestionPending && !suggestionError)) return;
    const frame = requestAnimationFrame(() => {
      const scroller = panel.closest("[data-message-scroll]");
      if (!(scroller instanceof HTMLElement)) return;
      const extra = panel.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 16;
      if (extra > 1) scroller.scrollBy({ top: extra, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, suggestionCount, suggestionPending, suggestionError]);
  // Only successful new replies are eligible. Deferring one tick avoids StrictMode's
  // rehearsal creating and then aborting an actual paid request.
  useEffect(() => {
    if (!automatic || disabled) return;
    const timer = setTimeout(() => void generateRef.current(true), 0);
    return () => clearTimeout(timer);
  }, [automatic, contextKey, disabled]);
  async function choose(reply: string) {
    if (disabled || current?.pending || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const sent = await onChoose(reply);
      if (!sent) {
        setResult(previous => ({ ...(previous?.key === contextKey ? previous : current), key: contextKey, error: "这条建议没有发出去，请重试。" }));
        return;
      }
      writeDzmmSuggestionCache(accountId, { key: contextKey, status: "ready", dismissed: true, updatedAt: Date.now() });
      setExpanded(false);
      setResult({ key: contextKey, dismissed: true });
    } catch (failure) {
      setResult(previous => ({ ...(previous?.key === contextKey ? previous : current), key: contextKey,
        error: failure instanceof Error ? failure.message : "这条建议没有发出去，请重试。" }));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  if (historical) return null;
  return <section className={s.root} aria-label={`${label}的行动建议`}>
    <button type="button" className={s.trigger} aria-label={`${label}帮我想想，按聊天费率结算`} disabled={disabled || current?.pending || sending}
      aria-expanded={visible && Boolean(current)} onClick={() => { if (current?.options) setExpanded(!visible); else void generate(); }}>
      <Icon name="sparkles" size={13} />{current?.pending ? "正在想下一步…" : "帮我想想"}
    </button>
    {visible && current && <div ref={panelRef} className={s.panel} aria-busy={Boolean(current.pending)}>
      <header><span>选择一句回复</span>{current.options && <button type="button" disabled={disabled || sending} onClick={() => void generate()}>换一组</button>}</header>
      {current.options && <div className={s.options}>{current.options.map((option, index) => <button type="button" key={`${index}:${option.direction}`}
        className={s.option} disabled={disabled || sending} aria-label={`${option.direction}：${option.reply}`} onClick={() => { void choose(option.reply); }}>
        {splitXumengSpeech(option.reply).map((part, j) => <span key={j} className={part.speech ? s.speech : s.action}>{part.text}</span>)}
      </button>)}</div>}
      {current.error && <p className={s.error} role="alert">{current.error}{!current.options && <button type="button" disabled={disabled} onClick={() => void generate()}>重试</button>}</p>}
    </div>}
  </section>;
}
