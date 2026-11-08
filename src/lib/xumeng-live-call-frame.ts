import type { XumengLiveScene } from "./xumeng-live-scene";
import { buildXumengLiveScenePrompt } from "./xumeng-live-scene";

/** What the call should look like the moment it connects. */
export type XumengLiveCallFrame = { time: string; place: string; clothing: string };

const MINOR = /校服|小学生|中学生|高中生|初中生|幼女|幼男|萝莉|正太|未成年|儿童|underage|\bloli\b|\bshota\b/i;
const FIELD = 40;

function clip(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, FIELD).replace(/[\uD800-\uDBFF]$/, "");
}

export function buildXumengLiveCallSummaryInput(name: string, scene: XumengLiveScene): string {
  return [`人物：${name.slice(0, 40)}`, buildXumengLiveScenePrompt(scene)].join("\n\n").slice(0, 3500);
}

export function parseXumengLiveCallFrame(raw: string): XumengLiveCallFrame | null {
  const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try { value = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const time = typeof row.time === "string" ? clip(row.time) : "";
  const place = typeof row.place === "string" ? clip(row.place) : "";
  const clothing = typeof row.clothing === "string" ? clip(row.clothing) : "";
  if (!time || !place || !clothing) return null;
  if ([time, place, clothing].some(item => MINOR.test(item) || item.includes("\0"))) return null;
  return { time, place, clothing };
}

/** Still prompt for the frame shown as the call connects. Null means do not generate. */
export function buildXumengLiveCallImagePrompt(name: string, frame: XumengLiveCallFrame): string | null {
  const current = parseXumengLiveCallFrame(JSON.stringify(frame));
  if (!current || MINOR.test(name)) return null;
  return [
    "参考图中的同一名自愿成年人，年满二十一岁。脸、发型和肤色保持不变。单人半身，看向镜头，适合视频通话。",
    `时间：${current.time}。`,
    `地点：${current.place}。`,
    `穿着：${current.clothing}。衣着完整。`,
    "无文字、无水印、无未成年人、无幼态面孔、无校服。",
  ].join("");
}
