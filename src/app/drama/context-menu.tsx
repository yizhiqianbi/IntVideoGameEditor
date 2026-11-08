"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./studio.module.css";

export type CanvasContext = {
  kind: "pane" | "node" | "edge";
  screen: { x: number; y: number };
  flow: { x: number; y: number };
  id?: string;
  source?: string;
  target?: string;
};
export type MenuItem = { id: string; label: string; action: () => void; disabled?: boolean; shortcut?: string; danger?: boolean; checked?: boolean; separator?: boolean };

export function CanvasContextMenu({ point, title, items, onClose }: { point: { x: number; y: number }; title: string; items: MenuItem[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(point);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const menu = root.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(point.x, window.innerWidth - bounds.width - 8)), y: Math.max(8, Math.min(point.y, window.innerHeight - bounds.height - 8)) });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) onClose(); };
    const resize = () => onClose();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); onClose(); previous?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", resize); document.removeEventListener("keydown", escape, true); };
  }, [point.x, point.y, onClose]);
  return createPortal(<div ref={root} role="menu" aria-label={title} className={styles.contextMenu} style={{ left: position.x, top: position.y }} onContextMenu={e => e.preventDefault()} onKeyDown={event => {
    if (event.key === "Tab") { onClose(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index].focus();
  }}>
    <div className={styles.contextTitle}>{title}</div>
    {items.map(item => <button key={item.id} role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={item.checked} disabled={item.disabled} data-danger={item.danger} data-separator={item.separator} onClick={() => { onClose(); item.action(); }}>
      <span>{item.checked !== undefined ? `${item.checked ? "✓ " : ""}${item.label}` : item.label}</span><kbd>{item.shortcut}</kbd>
    </button>)}
  </div>, document.body);
}
