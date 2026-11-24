"use client";

import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CompanionThreadRow } from "./companion-thread-items";
import { buildCompanionThreadRows } from "./companion-thread-items";
import styles from "./companion.module.css";

export type CompanionTranscriptItem = {
  id: string;
  createdAt: string;
  kind: "message" | "photo";
  bubble: "user" | "assistant";
  pending?: boolean;
  content: ReactNode;
};

function ChatAvatar({ src, label }: { src: string; label: string }) {
  const [broken, setBroken] = useState(false);
  const initial = label.trim().slice(0, 1) || "她";
  if (broken || !src) return <span className={styles.avatarFallback}>{initial}</span>;
  return <img src={src} alt="" onError={() => setBroken(true)} />;
}

export const CompanionTranscript = memo(function CompanionTranscript({ items, name, avatarUrl, typing, stalled, emptyText, onNudge }: {
  items: readonly CompanionTranscriptItem[];
  name: string;
  avatarUrl: string;
  typing: boolean;
  stalled: boolean;
  emptyText: string;
  onNudge: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const scrollingRef = useRef(false);
  const byId = new Map(items.map(item => [item.id, item]));
  const rows = buildCompanionThreadRows(items.map(item => ({ id: item.id, createdAt: item.createdAt, kind: item.kind })), { typing, stalled });
  const empty = rows.length === 1 && rows[0]?.kind === "empty";
  useLayoutEffect(() => {
    const node = scrollerRef.current;
    const content = contentRef.current;
    if (!node || !content) return;
    const pin = () => {
      if (!stickRef.current) return;
      const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
      if (gap < 2) return;
      scrollingRef.current = true;
      node.scrollTop = node.scrollHeight;
      scrollingRef.current = false;
    };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    return () => observer.disconnect();
  }, [rows]);
  if (empty) return <div className={styles.thread}><p className={styles.startNote}>{emptyText}</p></div>;
  return <div className={styles.thread}>
    <div
      className={styles.timeline}
      ref={scrollerRef}
      role="log"
      aria-label={`与${name}的聊天记录`}
      onScroll={() => {
        const node = scrollerRef.current;
        if (!node || scrollingRef.current) return;
        stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }}
    >
      <div ref={contentRef}>
        {rows.map(row => threadNode(row, byId, name, avatarUrl, onNudge))}
      </div>
    </div>
  </div>;
});

function threadNode(
  row: CompanionThreadRow,
  byId: ReadonlyMap<string, CompanionTranscriptItem>,
  name: string,
  avatarUrl: string,
  onNudge: () => void,
): ReactNode {
  switch (row.kind) {
    case "time":
      return <div key={row.id} className={styles.stamp}>{row.label}</div>;
    case "empty":
      return null;
    case "typing":
      return <div key={row.id} className={`${styles.message} ${styles.hers}`}>
        <span className={styles.smallAvatar}><ChatAvatar src={avatarUrl} label={name} /></span>
        <div><p className={styles.typingBubble} aria-label="对方正在输入"><span /><span /><span /></p></div>
      </div>;
    case "stalled":
      return <div key={row.id} className={styles.startNote}>这句已经送出去了，她还没接上。<button type="button" onClick={onNudge}>让她接一句</button></div>;
    case "message":
    case "photo": {
      const item = byId.get(row.id);
      if (!item) return null;
      const incoming = item.bubble === "assistant";
      return <div key={row.id} className={`${styles.message} ${incoming ? styles.hers : styles.mine} ${item.pending ? styles.pending : ""}`}>
        {incoming ? <span className={styles.smallAvatar}><ChatAvatar src={avatarUrl} label={name} /></span> : null}
        <div>{item.content}</div>
      </div>;
    }
    default: {
      const unexpected: never = row;
      return unexpected;
    }
  }
}

export type CompanionSenderHandle = { focus: () => void };

function fitComposer(element: HTMLTextAreaElement) {
  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
}

export const CompanionSender = forwardRef<CompanionSenderHandle, {
  value: string;
  placeholder: string;
  disabled: boolean;
  login: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onFocus?: () => void;
  onLogin?: () => void;
}>(function CompanionSender({ value, placeholder, disabled, login, onChange, onSubmit, onFocus, onLogin }, ref) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);
  useLayoutEffect(() => {
    if (inputRef.current) fitComposer(inputRef.current);
  }, [value]);
  const plain = value.slice(0, 4000);
  return <div className={styles.composer}>
    <div className={styles.composerBox}>
      <textarea
        ref={inputRef}
        rows={1}
        value={plain}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={4000}
        onFocus={onFocus}
        onChange={event => onChange(event.target.value.slice(0, 4000))}
        onKeyDown={event => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          const next = plain.trim();
          if (!login && !disabled && next) onSubmit(next);
        }}
      />
      {login
        ? <button type="button" className={styles.send} onClick={onLogin}>登录</button>
        : <button type="button" className={styles.send} disabled={disabled || !plain.trim()} onClick={() => { const next = plain.trim(); if (next) onSubmit(next); }}>发送</button>}
    </div>
  </div>;
});
