import type { CompanionStyle } from "./companion-style";

export const SALES_LINES = ["", ""] as const;
export const SALES_STYLE: CompanionStyle = {
  version: 1,
  personality: "",
  speakingStyle: "",
  relationshipStyle: "",
};

export const SALES_OPEN = "对方刚打开聊天。先发第一条。";
export const SALES_NUDGE = "对方还没回。再发一条。";
export const SALES_CUES = new Set([SALES_OPEN, SALES_NUDGE]);
