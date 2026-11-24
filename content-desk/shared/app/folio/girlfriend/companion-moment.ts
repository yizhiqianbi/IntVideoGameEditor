import { currentFolioMomentStatus, stripFolioMomentTails } from "../../../lib/folio-moment-status";

const STYLE = /\[FOLIO_PRIVATE_STYLE v1\][\s\S]*?\[\/FOLIO_PRIVATE_STYLE\]\n?/g;
const OPENING = /\[FOLIO_OPENING v1\][\s\S]*?\[\/FOLIO_OPENING\]\n?/g;

function clean(value: string) {
  return value.replace(STYLE, "").replace(OPENING, "").replace(/\s+/g, " ").trim();
}

/** A still is drawn from her reported moment, otherwise from the latest reply or her current situation. */
export function companionVisualScene(input: { situation?: string; messages: readonly { role: string; text?: string }[] }): string {
  const contents = input.messages
    .filter(message => message.role === "assistant" && message.text)
    .map(message => clean(message.text || ""));
  const { status, reported } = currentFolioMomentStatus(contents.map(content => ({ role: "assistant", content })));
  if (reported) {
    const parts = [status.scene, status.clothing, status.mood].filter(part => part && part !== "未知");
    if (parts.length) return parts.join("，").slice(0, 500);
  }
  const latest = stripFolioMomentTails(contents.at(-1) || "");
  if (latest.length >= 8) return latest.slice(0, 500);
  return clean(input.situation || "").slice(0, 500);
}
