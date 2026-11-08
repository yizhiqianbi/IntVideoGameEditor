"use client";
import type { Alignment, CanvasCard } from "@/lib/drama-canvas-geometry";
import { canvasCoordinate } from "@/lib/drama-canvas-geometry";
import styles from "./studio.module.css";

export const ALIGNMENTS: { id: Alignment; label: string }[] = [
  { id: "left", label: "左对齐" }, { id: "center", label: "水平居中" }, { id: "right", label: "右对齐" },
  { id: "top", label: "顶对齐" }, { id: "middle", label: "垂直居中" }, { id: "bottom", label: "底对齐" },
  { id: "horizontal", label: "水平分布" }, { id: "vertical", label: "垂直分布" },
];
export function ObjectProperties({ cards, disabled, onPosition, onLock, onAlign, onMenu }: {
  cards: CanvasCard[]; disabled: boolean;
  onPosition: (id: string, position: { x: number; y: number }) => void;
  onLock: (locked: boolean) => void;
  onAlign: (alignment: Alignment) => void;
  onMenu: (point: { x: number; y: number }) => void;
}) {
  if (!cards.length) return null;
  const single = cards.length === 1 ? cards[0] : null;
  const locked = cards.every(c => c.positionLocked);
  const anyLocked = cards.some(c => c.positionLocked);
  return <section className={styles.objectProperties} aria-label="对象属性">
    <div className={styles.propertyHeading}><strong>{single ? "对象属性" : `已选择 ${cards.length} 个对象`}</strong><button aria-label="对象操作" onClick={e => { const bounds = e.currentTarget.getBoundingClientRect(); onMenu({ x: bounds.left, y: bounds.bottom + 4 }); }}>···</button></div>
    {single && <><div className={styles.propertyType}>{"kind" in single ? single.kind === "scene" ? "场景卡" : "角色参考卡" : `镜头 · ${single.mode.toUpperCase()}`}</div>
      <div className={styles.positionFields}>{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input key={`${single.id}-${axis}-${single.position[axis]}`} aria-label={`对象位置 ${axis.toUpperCase()}`} type="number" step="1" min="-100000" max="100000" defaultValue={Math.round(single.position[axis])} disabled={disabled || anyLocked} onBlur={e => {
        const next = e.currentTarget.value.trim() ? canvasCoordinate(Number(e.currentTarget.value)) : null;
        if (next !== null && next !== single.position[axis]) onPosition(single.id, { ...single.position, [axis]: next });
        else e.currentTarget.value = String(single.position[axis]);
      }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === "Escape") { e.currentTarget.value = String(single.position[axis]); e.stopPropagation(); e.currentTarget.blur(); } }} /></label>)}</div></>}
    <label className={styles.positionLock}><input type="checkbox" checked={locked} ref={input => { if (input) input.indeterminate = anyLocked && !locked; }} disabled={disabled} onChange={e => onLock(e.target.checked)} />锁定位置</label>
    {cards.length > 1 && <div className={styles.alignmentTools}>{ALIGNMENTS.map(a => <button key={a.id} disabled={disabled || anyLocked || ((a.id === "horizontal" || a.id === "vertical") && cards.length < 3)} onClick={() => onAlign(a.id)}>{a.label}</button>)}</div>}
  </section>;
}
