"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./composer-quick-insert.module.css";

/** `text` is inserted at the caret; the caret lands at `caret` characters into it. */
const SNIPPETS: { label: string; hint: string; text: string; caret?: number }[] = [
  { label: "（）", hint: "括号", text: "（）", caret: 1 },
  { label: "旁白", hint: "旁白，角色听不到", text: "（旁白：）", caret: 4 },
  { label: "OOC", hint: "戏外指令，不属于剧情", text: "（OOC：）", caret: 5 },
  { label: "内心", hint: "没说出口，别人听不到", text: "（内心：）", caret: 4 },
  { label: "摄像机视角", hint: "只描述画面，不代表角色已知", text: "（摄像机视角：）", caret: 7 },
  { label: "描写画面", hint: "描写当前画面", text: "（描写画面）" },
  { label: "详细描写", hint: "把这一段写细", text: "（详细描写）" },
  { label: "继续", hint: "接着写", text: "（继续）" },
  { label: "推进剧情", hint: "推进到下一个场景", text: "（推进剧情到下一个场景）" },
  { label: "时间流逝", hint: "跳过一段时间", text: "（时间流逝——）", caret: 6 },
  { label: "加快节奏", hint: "加快节奏", text: "（加快节奏）" },
  { label: "♡", hint: "爱心", text: "♡" },
];

export function ComposerQuickInsert({ disabled, onInsert }: { disabled: boolean; onInsert: (text: string, caret: number) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return <div ref={root} className={styles.root}>
    <button type="button" className={styles.toggle} aria-label="快捷插入" aria-expanded={open} title="快捷插入旁白、OOC、内心等标记"
      disabled={disabled} onClick={() => setOpen(value => !value)}>{"{ }"}</button>
    {open && <div className={styles.menu} role="menu" aria-label="快捷插入">
      {SNIPPETS.map(snippet => <button type="button" role="menuitem" key={snippet.label}
        onClick={() => { onInsert(snippet.text, snippet.caret ?? snippet.text.length); setOpen(false); }}>
        <strong>{snippet.label}</strong><small>{snippet.hint}</small>
      </button>)}
    </div>}
  </div>;
}
