import type { AssetCard } from "./drama-assets";
import type { Shot } from "./drama";

export type CanvasCard = Shot | AssetCard;
export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom" | "horizontal" | "vertical";
export type CardBounds = { width: number; height: number };

/** Clamp imported/typed coordinates before they reach the renderer. */
export function canvasCoordinate(value: number) {
  return Number.isFinite(value) ? Math.max(-100_000, Math.min(100_000, Math.round(value))) : null;
}

export function alignCards(cards: CanvasCard[], mode: Alignment, dimensions: Map<string, CardBounds> = new Map()) {
  if (cards.length < (mode === "horizontal" || mode === "vertical" ? 3 : 2) || cards.some(c => c.positionLocked)) return [];
  const measured = cards.map(c => ({ ...c, width: dimensions.get(c.id)?.width ?? 300, height: dimensions.get(c.id)?.height ?? 300 }));
  const left = Math.min(...measured.map(c => c.position.x));
  const right = Math.max(...measured.map(c => c.position.x + c.width));
  const top = Math.min(...measured.map(c => c.position.y));
  const bottom = Math.max(...measured.map(c => c.position.y + c.height));
  if (mode === "horizontal" || mode === "vertical") {
    const axis = mode === "horizontal" ? "x" : "y";
    const size = mode === "horizontal" ? "width" : "height";
    const ordered = [...measured].sort((a, b) => a.position[axis] - b.position[axis]);
    const first = ordered[0], last = ordered.at(-1)!;
    const gap = (last.position[axis] + last[size] - first.position[axis] - ordered.reduce((sum, c) => sum + c[size], 0)) / (ordered.length - 1);
    let cursor = first.position[axis];
    return ordered.map(c => {
      const position = { ...c.position, [axis]: canvasCoordinate(cursor)! };
      cursor += c[size] + gap;
      return { id: c.id, position };
    });
  }
  return measured.map(c => ({ id: c.id, position: {
    x: canvasCoordinate(mode === "left" ? left : mode === "right" ? right - c.width : mode === "center" ? (left + right - c.width) / 2 : c.position.x)!,
    y: canvasCoordinate(mode === "top" ? top : mode === "bottom" ? bottom - c.height : mode === "middle" ? (top + bottom - c.height) / 2 : c.position.y)!,
  } }));
}
