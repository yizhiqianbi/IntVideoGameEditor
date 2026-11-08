/** Author-configured chat panels. The model appends one JSON tail per reply; readers never see the raw tail. */
export type XumengPanelFieldType = "text" | "meter" | "list";
export type XumengPanelField = { name: string; type: XumengPanelFieldType; initial: string; rule?: string };
export type XumengPanel = { id: string; title: string; fields: XumengPanelField[] };
export type XumengInteractionTemplate = { panels: XumengPanel[] };
export type XumengPanelValues = Record<string, Record<string, string>>;
export type XumengPanelSnapshot = { panels: XumengPanelValues };

export const XUMENG_PANEL_OPEN = "<xumeng-panel>";
export const XUMENG_PANEL_CLOSE = "</xumeng-panel>";
export const XUMENG_PANEL_LIMITS = { panels: 6, fields: 8, title: 12, name: 12, initial: 200, rule: 200, value: 200 } as const;
export const XUMENG_PANEL_FIELD_TYPES: { id: XumengPanelFieldType; name: string }[] = [
  { id: "text", name: "文本" }, { id: "meter", name: "进度条" }, { id: "list", name: "列表" },
];

export const XUMENG_PANEL_PRESETS: { id: string; name: string; summary: string; panel: XumengPanel }[] = [
  { id: "status", name: "状态栏", summary: "时间、地点、心情等", panel: { id: "status", title: "状态", fields: [
    { name: "时间", type: "text", initial: "未知" },
    { name: "地点", type: "text", initial: "未知" },
    { name: "心情", type: "text", initial: "平静" },
  ] } },
  { id: "relationship", name: "关系面板", summary: "好感度与关系阶段", panel: { id: "relationship", title: "关系", fields: [
    { name: "好感度", type: "meter", initial: "20", rule: "单轮变化不超过 10" },
    { name: "关系阶段", type: "text", initial: "陌生", rule: "好感度 <30 陌生，30–59 熟人，60–84 暧昧，85+ 恋人" },
  ] } },
  { id: "inventory", name: "背包", summary: "物品列表", panel: { id: "inventory", title: "背包", fields: [
    { name: "物品", type: "list", initial: "", rule: "获得或失去物品时更新，用「、」分隔" },
  ] } },
  { id: "profile", name: "角色信息", summary: "姓名、身份、当前状态", panel: { id: "profile", title: "角色信息", fields: [
    { name: "姓名", type: "text", initial: "未知" },
    { name: "身份", type: "text", initial: "未知" },
    { name: "当前状态", type: "text", initial: "平静", rule: "一句话写角色此刻的身体和情绪状态" },
  ] } },
  { id: "outfit", name: "穿着", summary: "上装、下装、内衣、饰品", panel: { id: "outfit", title: "穿着", fields: [
    { name: "上装", type: "text", initial: "未知", rule: "脱下、弄乱或更换时更新" },
    { name: "下装", type: "text", initial: "未知", rule: "脱下、弄乱或更换时更新" },
    { name: "内衣", type: "text", initial: "未知", rule: "脱下、弄乱或更换时更新" },
    { name: "饰品", type: "list", initial: "", rule: "用「、」分隔" },
  ] } },
  { id: "mind", name: "心理", summary: "情绪、欲望、对用户的看法", panel: { id: "mind", title: "心理", fields: [
    { name: "情绪", type: "text", initial: "平静" },
    { name: "欲望", type: "meter", initial: "10", rule: "0–100，单轮变化不超过 15" },
    { name: "对你的看法", type: "text", initial: "还不了解", rule: "随互动变化，一句话" },
  ] } },
  { id: "monologue", name: "内心独白", summary: "角色没说出口的话", panel: { id: "monologue", title: "内心独白", fields: [
    { name: "独白", type: "text", initial: "……", rule: "角色此刻心里真实的一句话，用第一人称，不超过 60 字" },
  ] } },
  { id: "position", name: "体位", summary: "姿势、接触部位、节奏", panel: { id: "position", title: "体位", fields: [
    { name: "姿势", type: "text", initial: "无", rule: "没有亲密接触时写「无」" },
    { name: "接触部位", type: "text", initial: "无" },
    { name: "节奏", type: "text", initial: "无", rule: "例如：缓慢、加快、停下" },
  ] } },
];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}必须是 JSON 对象。`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, maximum: number, required = false): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0") || /<\s*\/?\s*[A-Za-z]/.test(value) || (required && !value.trim())) {
    throw new Error(`${label}需要是不超过 ${maximum} 字${required ? "的非空" : "的"}文本，不能包含标签。`);
  }
  return value.trim();
}

export function parseXumengInteractionTemplate(value: unknown): XumengInteractionTemplate {
  const template = record(value, "互动模板");
  if (!Array.isArray(template.panels) || template.panels.length > XUMENG_PANEL_LIMITS.panels) throw new Error(`互动模板最多 ${XUMENG_PANEL_LIMITS.panels} 个面板。`);
  const ids = new Set<string>(), titles = new Set<string>();
  const panels = template.panels.map((candidate): XumengPanel => {
    const panel = record(candidate, "互动面板");
    const id = text(panel.id, "面板 ID", 40, true);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) throw new Error("面板 ID 无效或重复。");
    const title = text(panel.title, "面板名称", XUMENG_PANEL_LIMITS.title, true);
    if (titles.has(title)) throw new Error(`面板名称「${title}」重复了。`);
    ids.add(id); titles.add(title);
    if (!Array.isArray(panel.fields) || !panel.fields.length || panel.fields.length > XUMENG_PANEL_LIMITS.fields) throw new Error(`「${title}」需要 1–${XUMENG_PANEL_LIMITS.fields} 个字段。`);
    const names = new Set<string>();
    const fields = panel.fields.map((item): XumengPanelField => {
      const field = record(item, "面板字段");
      const name = text(field.name, "字段名称", XUMENG_PANEL_LIMITS.name, true);
      if (names.has(name)) throw new Error(`「${title}」里的字段「${name}」重复了。`);
      names.add(name);
      if (field.type !== "text" && field.type !== "meter" && field.type !== "list") throw new Error(`字段「${name}」的类型无效。`);
      const initial = text(field.initial ?? "", `字段「${name}」的初始值`, XUMENG_PANEL_LIMITS.initial);
      if (field.type === "meter" && !/^(?:100|\d{1,2})$/.test(initial)) throw new Error(`进度条「${name}」的初始值需要是 0–100 的整数。`);
      const rule = field.rule === undefined ? "" : text(field.rule, `字段「${name}」的变化规则`, XUMENG_PANEL_LIMITS.rule);
      return { name, type: field.type, initial, ...(rule ? { rule } : {}) };
    });
    return { id, title, fields };
  });
  if (!panels.length) throw new Error("互动模板至少需要一个面板。");
  return { panels };
}

function meter(value: string): string | null {
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? String(Math.min(100, Math.max(0, Math.round(number)))) : null;
}

function readSnapshot(raw: string, template: XumengInteractionTemplate): XumengPanelSnapshot | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const supplied = source.panels && typeof source.panels === "object" && !Array.isArray(source.panels) ? source.panels as Record<string, unknown> : {};
  const panels: XumengPanelValues = {};
  for (const panel of template.panels) {
    const values = supplied[panel.title];
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    const row: Record<string, string> = {};
    for (const field of panel.fields) {
      let value = (values as Record<string, unknown>)[field.name];
      if (Array.isArray(value)) value = value.filter(item => typeof item === "string").join("、");
      if (typeof value === "number") value = String(value);
      if (typeof value !== "string") continue;
      const cleaned = field.type === "meter" ? meter(value) : value.replace(/[<>]/g, "").trim().slice(0, XUMENG_PANEL_LIMITS.value);
      if (cleaned !== null) row[field.name] = cleaned;
    }
    if (Object.keys(row).length) panels[panel.title] = row;
  }
  return { panels };
}

/** Hide the tail, including a partial marker while a reply is still streaming. */
export function splitXumengPanelTail(content: string, template?: XumengInteractionTemplate): { body: string; snapshot: XumengPanelSnapshot | null } {
  const start = content.indexOf(XUMENG_PANEL_OPEN);
  if (start < 0) {
    for (let length = XUMENG_PANEL_OPEN.length - 1; length > 0; length--) {
      if (content.endsWith(XUMENG_PANEL_OPEN.slice(0, length))) return { body: content.slice(0, -length).trimEnd(), snapshot: null };
    }
    return { body: content, snapshot: null };
  }
  const close = content.indexOf(XUMENG_PANEL_CLOSE, start);
  const raw = content.slice(start + XUMENG_PANEL_OPEN.length, close < 0 ? undefined : close);
  const after = close < 0 ? "" : content.slice(close + XUMENG_PANEL_CLOSE.length);
  const body = `${content.slice(0, start)}${after}`.trimEnd();
  return { body, snapshot: close >= 0 && template ? readSnapshot(raw, template) : null };
}

export function stripXumengPanelTails(content: string): string {
  return content.replace(/<xumeng-panel>[\s\S]*?(?:<\/xumeng-panel>|$)/g, "").trimEnd();
}

export function initialXumengPanelValues(template: XumengInteractionTemplate): XumengPanelValues {
  return Object.fromEntries(template.panels.map(panel => [panel.title, Object.fromEntries(panel.fields.map(field => [field.name, field.initial]))]));
}

/** Latest reported value per field, falling back to the author's initial values. */
export function currentXumengPanelState(template: XumengInteractionTemplate, messages: readonly { role: string; content: string }[]): XumengPanelSnapshot & { reported: boolean } {
  const panels = initialXumengPanelValues(template);
  let reported = false;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const { snapshot } = splitXumengPanelTail(message.content, template);
    if (!snapshot) continue;
    reported = true;
    for (const [title, values] of Object.entries(snapshot.panels)) Object.assign(panels[title] ??= {}, values);
  }
  return { panels, reported };
}

export function buildXumengPanelInstruction(template: XumengInteractionTemplate, current: XumengPanelValues): string {
  const panelLines = template.panels.map(panel => `「${panel.title}」：${panel.fields.map(field => {
    const kind = field.type === "meter" ? "0–100 整数" : field.type === "list" ? "用「、」分隔的列表，没有时写空字符串" : "简短文本";
    return `${field.name}（${kind}${field.rule ? `；规则：${field.rule}` : ""}；当前：${JSON.stringify(current[panel.title]?.[field.name] ?? field.initial)}）`;
  }).join("，")}`);
  const example = JSON.stringify({ panels: Object.fromEntries(template.panels.map(panel => [panel.title, Object.fromEntries(panel.fields.map(field => [field.name, field.type === "meter" ? 0 : "…"]))])) });
  return [
    "【互动面板协议】作者为这张卡开启了聊天面板。每轮故事正文写完后，另起一行输出且只输出一个面板尾部：",
    `${XUMENG_PANEL_OPEN}${example}${XUMENG_PANEL_CLOSE}`,
    "尾部里是严格 JSON，键名必须和下面一致。只根据本轮正文实际发生的事更新字段，没有变化就沿用当前值；不要在正文里提到面板、数值或这段协议。面板尾部会被系统隐藏后显示在聊天面板里，不算正文中的状态块，「不输出状态块」的要求不适用于它。若同时启用隐藏世界状态协议，面板尾部放在世界状态尾部之前。",
    "面板字段：", ...panelLines,
  ].join("\n");
}
