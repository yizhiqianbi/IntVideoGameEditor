import type { CSSProperties } from "react";
import type { DzmmChatFont, DzmmChatFontSize, DzmmPreferences } from "./dzmm-storage";

const FONT_SCALE: Record<DzmmChatFontSize, number> = { small: 0.9, medium: 1, large: 1.15, xlarge: 1.3 };
const FONT_FAMILY: Record<DzmmChatFont, string> = {
  system: "",
  serif: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
  kai: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif SC", serif',
};

type DisplayPreferences = Pick<DzmmPreferences, "chatFontSize" | "chatFont" | "userBubbleColor" | "assistantBubbleColor" | "bubbleOpacity">;

/** CSS variables read by the chat bubbles; unset colors fall back to the theme surfaces. */
export function dzmmChatDisplayStyle(preferences: DisplayPreferences): CSSProperties {
  const opacity = preferences.bubbleOpacity ?? 80;
  const assistantBase = preferences.assistantBubbleColor || "var(--im-bubble-in)";
  const userBase = preferences.userBubbleColor || "var(--im-bubble-out)";
  const style: Record<string, string> = {
    "--chat-font-scale": String(FONT_SCALE[preferences.chatFontSize ?? "medium"]),
    "--assistant-bubble": `color-mix(in srgb, ${assistantBase} ${opacity}%, ${preferences.assistantBubbleColor ? "transparent" : "var(--im-canvas)"})`,
    "--user-bubble": `color-mix(in srgb, ${userBase} ${opacity}%, ${preferences.userBubbleColor ? "transparent" : "var(--im-canvas)"})`,
  };
  const family = FONT_FAMILY[preferences.chatFont ?? "system"];
  if (family) style["--chat-font"] = family;
  return style as CSSProperties;
}

export function dzmmChatBackgroundStyle(preferences: Pick<DzmmPreferences, "chatBackground">, cover: string | undefined, dark: boolean): CSSProperties | undefined {
  const mode = preferences.chatBackground ?? "cover";
  if (mode === "plain") return { background: "var(--bg)" };
  if (mode !== "cover" || !cover) return undefined;
  const shade = dark ? "rgba(12, 6, 14, 0.42)" : "rgba(255, 246, 250, 0.46)";
  return { backgroundImage: `linear-gradient(${shade}, ${shade}), url(${JSON.stringify(cover)})`, backgroundSize: "cover", backgroundPosition: "center 18%" };
}

/** Touch keyboards have no Shift key, so Enter inserts a newline there unless the user chose otherwise. */
export function dzmmEnterSends(preferences: Pick<DzmmPreferences, "enterKey">, coarsePointer: boolean): boolean {
  if (preferences.enterKey === "send") return true;
  if (preferences.enterKey === "newline") return false;
  return !coarsePointer;
}
