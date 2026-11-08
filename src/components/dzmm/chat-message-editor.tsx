"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./icons";
import s from "./chat-message-media.module.css";

export default function ChatMessageEditor({ content, disabled, onSave, onClose }: {
  content: string; disabled: boolean; onSave: (content: string) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(content);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const current = dialog.current;
    current?.showModal(); input.current?.focus();
    return () => current?.close();
  }, []);
  return <dialog ref={dialog} className={s.editorDialog} aria-labelledby="message-editor-title" onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      if (disabled) return;
      if (!draft.trim()) { setError("消息不能为空。"); return; }
      if (draft.length > 12000) { setError("消息不能超过 12,000 字符。"); return; }
      try { onSave(draft); onClose(); } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请重试。"); }
    }}>
      <header><h2 id="message-editor-title">编辑消息</h2><button type="button" aria-label="关闭编辑消息" onClick={onClose}><Icon name="close" size={20} /></button></header>
      <p>保留后续聊天原文；受这次修改影响的剧情记忆会在后续对话中重新整理。</p>
      <textarea ref={input} aria-label="消息内容" value={draft} maxLength={12000} rows={10} disabled={disabled}
        onChange={event => { setDraft(event.target.value); setError(""); }} />
      <small>{draft.length.toLocaleString()} / 12,000</small>
      {error && <p className={s.error} role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>取消</button><button type="submit" className={s.editorSave} disabled={disabled || !draft.trim()}>保存修改</button></footer>
    </form>
  </dialog>;
}

export function ChatMessageTextSelection({ content, onCopy, onClose }: {
  content: string; onCopy: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const current = dialog.current;
    current?.showModal(); input.current?.focus(); input.current?.select();
    return () => current?.close();
  }, []);
  return <dialog ref={dialog} className={s.editorDialog} aria-label="选择消息文字" onClose={onClose}>
    <header><h2>选择消息文字</h2><button type="button" aria-label="关闭文字选择" onClick={onClose}><Icon name="close" size={20} /></button></header>
    <p>选取原文，保留格式标记、换行和空格。</p>
    <textarea ref={input} aria-label="消息原文" value={content} readOnly rows={10} />
    <footer><button type="button" onClick={onClose}>关闭</button><button type="button" className={s.editorSave} onClick={() => { onCopy(); onClose(); }}>复制原文</button></footer>
  </dialog>;
}
