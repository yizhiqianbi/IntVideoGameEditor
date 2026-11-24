/** Hidden per-turn status. Readers see the card, never the JSON tail. */

export const FOLIO_MOMENT_OPEN = "<folio-moment>";
export const FOLIO_MOMENT_CLOSE = "</folio-moment>";

export type FolioMomentStatus = {
  affection: number;
  mood: string;
  scene: string;
  intimacy: string;
  clothing: string;
  secret: string;
  need: string;
  bond: number;
  bondLabel: string;
};

const TEXT_KEYS = ["mood", "scene", "intimacy", "clothing", "secret", "need", "bondLabel"] as const;
const LIMIT = 80;

export function blankFolioMomentStatus(): FolioMomentStatus {
  return { affection: 0, mood: "未知", scene: "未知", intimacy: "未知", clothing: "未知", secret: "未知", need: "未知", bond: 0, bondLabel: "未知" };
}

function meter(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[^\d.-]/g, "")) : NaN;
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : null;
}

function phrase(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMIT);
  return cleaned || null;
}

export function readFolioMomentStatus(raw: string): Partial<FolioMomentStatus> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const status: Partial<FolioMomentStatus> = {};
  const affection = meter(source.affection);
  const bond = meter(source.bond);
  if (affection !== null) status.affection = affection;
  if (bond !== null) status.bond = bond;
  for (const key of TEXT_KEYS) {
    const value = phrase(source[key]);
    if (value) status[key] = value;
  }
  return Object.keys(status).length ? status : null;
}

export function splitFolioMomentTail(content: string): { body: string; snapshot: Partial<FolioMomentStatus> | null } {
  const start = content.indexOf(FOLIO_MOMENT_OPEN);
  if (start < 0) {
    for (let length = FOLIO_MOMENT_OPEN.length - 1; length > 0; length--) {
      if (content.endsWith(FOLIO_MOMENT_OPEN.slice(0, length))) return { body: content.slice(0, -length).trimEnd(), snapshot: null };
    }
    return { body: content, snapshot: null };
  }
  const close = content.indexOf(FOLIO_MOMENT_CLOSE, start);
  const raw = content.slice(start + FOLIO_MOMENT_OPEN.length, close < 0 ? undefined : close);
  const after = close < 0 ? "" : content.slice(close + FOLIO_MOMENT_CLOSE.length);
  return { body: `${content.slice(0, start)}${after}`.trimEnd(), snapshot: close >= 0 ? readFolioMomentStatus(raw) : null };
}

export function stripFolioMomentTails(content: string): string {
  return content.replace(/<folio-moment>[\s\S]*?(?:<\/folio-moment>|$)/g, "").trimEnd();
}

export function currentFolioMomentStatus(messages: readonly { role: string; content: string }[]): { status: FolioMomentStatus; reported: boolean } {
  let status = blankFolioMomentStatus();
  let reported = false;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const { snapshot } = splitFolioMomentTail(message.content);
    if (!snapshot) continue;
    reported = true;
    status = { ...status, ...snapshot };
  }
  return { status, reported };
}

export function buildFolioMomentInstruction(current: FolioMomentStatus): string {
  const example = JSON.stringify({
    affection: current.affection, mood: current.mood, scene: current.scene, intimacy: current.intimacy,
    clothing: current.clothing, secret: current.secret, need: current.need, bond: current.bond, bondLabel: current.bondLabel,
  });
  return [
    "【此刻状态】每轮故事正文写完后，另起一行，并且只追加一个隐藏尾部：",
    `${FOLIO_MOMENT_OPEN}${example}${FOLIO_MOMENT_CLOSE}`,
    "尾部是严格 JSON，键名保持上面这些。affection 和 bond 是 0–100 的整数，单轮变化不超过 10。其余字段是不超过 80 字的短句。只根据本轮正文已经发生的事更新，没有变化就沿用当前值；正文没写到的衣着、秘密和需求保持「未知」，不要猜测。人物按 21 岁以上的成年人理解，不要把角色写成未成年人或在读学生，也不要用衣装暗示年龄。不要在正文里写出字段名、数值或这段 JSON。读者看到的是单独的状态卡片。若这张卡还有互动面板，此刻状态放在面板尾部之前。",
  ].join("\n");
}
