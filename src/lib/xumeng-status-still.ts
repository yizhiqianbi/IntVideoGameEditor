import { cleanStatusText } from "./xumeng-status-display";
import { peelXumengLabeledStatusTail, splitXumengMessagePresentation, type XumengVisibleStatusField } from "./xumeng-message-presentation";

const MINOR_SCENE = /校服|小学生|中学生|高中生|初中生|幼女|幼男|萝莉|正太|未成年|儿童|underage|\bloli\b|\bshota\b/i;
const BLANK = /^(?:未记录|未知|无|没有|暂无|空|——+|--+|\/+|n\/a)$/iu;
const INSTRUCTION = /忽略之前|系统提示|提示词|\bignore previous\b|\bsystem prompt\b/i;
const FIELD = /^\s*(?:[-*•·]\s*)?([^：:\n。！？!?，,“”"「」]{1,16}?)\s*[：:]\s*(.+?)\s*$/u;
const VISUAL = /衣|裸|胸|乳|穴|腿|腰|臀|唇|吻|湿|液|跪|躺|抱|贴|磨|插|吮|肩带|汗|尾|身体|涨|抵|分开|张口/;

function clip(value: string, maximum: number): string {
  const text = Array.from(value);
  return text.length <= maximum ? value : text.slice(0, maximum).join("").replace(/[\ud800-\udbff]$/, "");
}

function usable(fields: readonly XumengVisibleStatusField[]): XumengVisibleStatusField[] {
  const seen = new Set<string>();
  const kept: XumengVisibleStatusField[] = [];
  for (const field of fields) {
    const label = field.label.trim();
    const value = field.value.trim();
    if (!label || !value || BLANK.test(value) || seen.has(label)) continue;
    seen.add(label);
    kept.push({ label, value: clip(value, 80) });
  }
  return kept.slice(0, 16);
}

function trailingStatus(text: string): { body: string; fields: XumengVisibleStatusField[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let cursor = lines.length;
  while (cursor > 0 && !lines[cursor - 1].trim()) cursor -= 1;
  const taken: number[] = [];
  while (cursor > 0) {
    const line = lines[cursor - 1].trim();
    if (!line) {
      if (!taken.length) break;
      cursor -= 1;
      continue;
    }
    const field = FIELD.exec(line);
    const label = field?.[1]?.trim() ?? "";
    if (!field || !label) break;
    taken.push(cursor - 1);
    cursor -= 1;
  }
  if (taken.length < 3) return { body: text, fields: [] };
  const fields = taken.reverse().map(index => {
    const field = FIELD.exec(lines[index].trim());
    return { label: field?.[1]?.trim() ?? "", value: cleanStatusText(field?.[2] ?? "") };
  });
  const body = lines.filter((_, index) => !taken.includes(index)).join("\n").trim();
  return { body, fields };
}

function supplement(body: string): string {
  const cleaned = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const sentences = cleaned.split(/(?<=[。！？.!?])\s*/u).map(part => part.trim()).filter(part => part && !INSTRUCTION.test(part));
  const visual = sentences.filter(part => VISUAL.test(part));
  return clip((visual.length ? visual : sentences).slice(-2).join(""), 220);
}

/** Status fields lead. A short slice of the same reply only fills in what the fields do not say. */
export function statusStillScene(content: string, labels: readonly string[] = []): { scene: string } | { blocked: true } | null {
  const presentation = splitXumengMessagePresentation(content);
  const marked = presentation.status?.fields ?? [];
  const peeled = marked.length ? { body: presentation.body, fields: marked } : peelXumengLabeledStatusTail(presentation.body, labels);
  const tail = peeled.fields.length ? peeled : trailingStatus(presentation.body);
  const fields = usable(tail.fields.map(field => ({ ...field, value: cleanStatusText(field.value) })));
  if (!fields.length) return null;
  const status = fields.map(field => `${field.label}：${field.value}`).join("。");
  const extra = supplement(tail.body);
  const scene = `按这些词条把衣着、身体、姿势和接触画出来，不要改成穿戴整齐的远景或肖像。${status}${extra ? `。正在发生：${extra}` : ""}`;
  if (MINOR_SCENE.test(scene)) return { blocked: true };
  return { scene: clip(scene, 700) };
}

export default { statusStillScene };
