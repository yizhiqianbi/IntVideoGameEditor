/**
 * Presentation-only parsing for visible story messages.
 *
 * A status snapshot is recognized only after an explicit marker. This keeps
 * ordinary prose, dialogue, and author text untouched and prevents arbitrary
 * `label: value` sentences from becoming application state.
 */
export type XumengVisibleStatusField = { label: string; value: string };

export type XumengMessagePresentation = {
  body: string;
  status: { title: string; fields: XumengVisibleStatusField[] } | null;
};

const STATUS_MARKER = /^\s*(?:点击查看状态栏|查看状态栏|【状态栏】|\[状态栏\])\s*$/u;
const STATUS_LABELS = new Set([
  "姓名", "性别", "年龄", "初始身份", "当前身份", "当前地点", "当前场景", "场景",
  "时间", "日期", "天气", "精力值", "健康值", "精神值", "体力值", "经验值",
  "内心描述", "肢体动作", "服饰状态", "道具装备", "装备", "物品", "当前事件",
  "关系", "好感度", "声望", "任务", "目标", "已完成", "待处理",
]);
const FIELD = /^\s*([^：:]{1,20})\s*[：:]\s*(.*?)\s*$/u;
const normalize = (value: string) => value.replace(/\r\n?/g, "\n");

/** Split a visible assistant message without rewriting its source content. */
export function splitXumengMessagePresentation(text: string): XumengMessagePresentation {
  const lines = normalize(text).split("\n");
  const markerIndex = lines.findIndex(line => STATUS_MARKER.test(line));
  if (markerIndex < 0) return { body: text, status: null };

  const fields: XumengVisibleStatusField[] = [];
  let cursor = markerIndex + 1;
  let seenField = false;
  for (; cursor < lines.length && fields.length < 24; cursor++) {
    const line = lines[cursor];
    if (!line.trim()) continue;
    const match = FIELD.exec(line);
    const rawLabel = match?.[1].trim() ?? "";
    const label = rawLabel.replace(/^你的/u, "").replace(/[（(][^）)]*[）)]$/u, "").trim();
    if (!match || !STATUS_LABELS.has(label)) break;
    seenField = true;
    fields.push({ label, value: match[2].trim() || "未记录" });
  }
  // A marker without a valid field block is ordinary authored text.
  if (!seenField || fields.length < 2) return { body: text, status: null };

  const before = lines.slice(0, markerIndex).join("\n").trimEnd();
  const after = lines.slice(cursor).join("\n").trim();
  const body = [before, after].filter(Boolean).join("\n\n");
  return { body, status: { title: "状态栏", fields } };
}

const xumengMessagePresentation = { splitXumengMessagePresentation };
export default xumengMessagePresentation;
