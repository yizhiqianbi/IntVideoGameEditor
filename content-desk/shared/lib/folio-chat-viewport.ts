/** Pixels of overlap treated as a soft keyboard rather than a browser toolbar. */
const KEYBOARD_GAP = 80;

export type ChatViewportSnapshot = {
  layoutHeight: number;
  visualHeight: number;
  offsetTop: number;
  /** Layout height learned while the keyboard was closed. 0 before the first settled sample. */
  fullHeight: number;
  keyboardHeight: number;
};

export type ChatViewportFrame = {
  height: number;
  keyboardOpen: boolean;
};

function roundLength(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** True when the viewport numbers still describe the unobstructed screen. */
export function chatViewportSettled(snapshot: ChatViewportSnapshot): boolean {
  const layout = roundLength(snapshot.layoutHeight);
  const visual = roundLength(snapshot.visualHeight);
  const full = roundLength(snapshot.fullHeight);
  const quiet = snapshot.keyboardHeight < 20
    && Math.abs(snapshot.offsetTop) < 20
    && (visual === 0 || Math.abs(visual - layout) < 20);
  // A window already shorter than the learned screen is the keyboard, not a new baseline.
  return quiet && full <= layout + KEYBOARD_GAP;
}

/**
 * Height of the chat shell inside the current layout viewport.
 * Once the window itself has already shrunk, that height is used as-is so a
 * second visual-viewport or keyboard inset cannot open a gap above the keyboard.
 */
export function chatViewportFrame(snapshot: ChatViewportSnapshot): ChatViewportFrame {
  const layout = roundLength(snapshot.layoutHeight);
  const visual = roundLength(snapshot.visualHeight);
  const full = roundLength(snapshot.fullHeight);
  const keyboard = roundLength(snapshot.keyboardHeight);
  if (layout === 0) return { height: 0, keyboardOpen: false };

  if (full > layout + KEYBOARD_GAP) {
    return { height: layout, keyboardOpen: true };
  }
  if (keyboard > 0) {
    return {
      height: Math.max(0, layout - keyboard),
      keyboardOpen: keyboard > KEYBOARD_GAP,
    };
  }
  const visible = visual > 0 ? Math.min(layout, visual) : layout;
  return {
    height: visible,
    keyboardOpen: layout - visible > KEYBOARD_GAP,
  };
}

/** Style top that places the shell's top edge on the visual viewport's top edge. */
export function chatViewportAnchorTop(styleTop: number, visualTop: number, layoutHeight: number): number {
  const current = Number.isFinite(styleTop) ? styleTop : 0;
  const visual = Number.isFinite(visualTop) ? visualTop : 0;
  const layout = roundLength(layoutHeight);
  return Math.max(-80, Math.min(Math.round(current - visual), layout));
}
