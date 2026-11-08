import type { DzmmStoryState } from "./dzmm-story-memory";
import type { DzmmWorldState, DzmmWorldClockMode } from "./dzmm-world-state";
import type { XumengStatusBar } from "./dzmm-character-context";
import { parseXumengStatusContent, peelXumengLabeledStatusTail, splitXumengMessagePresentation } from "./xumeng-message-presentation";

/** A read-only projection for the status panel and the next model turn. */
export type XumengStatusMode = "tavern" | "companion";

export type XumengStatusCharacter = {
  name: string;
  occupation?: string;
  tags?: readonly string[];
  description?: string;
  personality?: string;
  scenario?: string;
  introduction?: string;
  creatorNotes?: string;
  systemPrompt?: string;
};

export type XumengCharacterStatus = {
  mode: XumengStatusMode;
  modeLabel: string;
  characterName: string;
  occupation: string | null;
  timeLabel: string;
  dayLabel: string | null;
  location: string;
  scene: string;
  activity: string;
  event: string;
  people: string[];
  privateState: {
    temperature: string;
    fluid: string;
    arousal: string;
  } | null;
};

export type XumengStatusInput = {
  character: XumengStatusCharacter;
  world?: DzmmWorldState;
  clockMode?: DzmmWorldClockMode;
  memory?: DzmmStoryState;
  messages?: readonly { role: "user" | "assistant"; content: string }[];
  now?: number;
};

const COMPANION_MARKERS = /女友|男友|女朋友|男朋友|恋人|伴侣|情侣|恋爱|陪伴|约会|暧昧|陪聊/u;
const OCCUPATION_PATTERNS = [
  /职业\s*[:：]\s*([^。\n，,；;]{1,24})/u,
  /(?:是一名|是一位|是个|担任|从事)\s*([^。\n，,；;]{1,24})/u,
];

function sourceText(character: XumengStatusCharacter): string {
  return [character.tags?.join(" "), character.name, character.occupation, character.description, character.personality,
    character.scenario, character.introduction, character.creatorNotes, character.systemPrompt].filter(Boolean).join("\n");
}

export function inferXumengStatusMode(character: XumengStatusCharacter): XumengStatusMode {
  const text = sourceText(character);
  return (character.tags?.some(tag => COMPANION_MARKERS.test(tag)) || COMPANION_MARKERS.test(text)) ? "companion" : "tavern";
}

export function extractXumengOccupation(character: XumengStatusCharacter): string | null {
  if (character.occupation?.trim()) return character.occupation.trim().slice(0, 24);
  const text = sourceText(character);
  for (const pattern of OCCUPATION_PATTERNS) {
    const match = pattern.exec(text)?.[1]?.trim();
    if (match && match.length <= 24) return match.replace(/[，,；;。].*$/u, "").trim();
  }
  const exactName = ["教师", "老师", "医生", "护士", "程序员", "工程师", "设计师", "记者", "律师", "警察", "店员", "咖啡师", "厨师", "主播", "编辑", "研究员", "摄影师", "作家", "秘书", "职员"]
    .find(keyword => character.name.trim() === keyword);
  return exactName ?? null;
}

function clockMinute(world: DzmmWorldState | undefined): number | null {
  if (world?.clock.minuteOfDay !== null && world?.clock.minuteOfDay !== undefined) return world.clock.minuteOfDay;
  return null;
}

function dayLabel(world: DzmmWorldState | undefined, now: number, mode: DzmmWorldClockMode): string | null {
  const label = world?.clock.calendarLabel?.trim();
  if (label && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/u.test(label)) {
    const date = new Date(label.replace(/\//g, "-") + "T12:00:00+08:00");
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "long" }).format(date);
  }
  if (mode === "realtime") return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "long" }).format(new Date(now));
  return null;
}

function routineActivity(minute: number | null, day: string | null, occupation: string | null): string {
  if (minute === null) return "日常安排未记录";
  const hour = minute / 60;
  const weekend = day === "星期六" || day === "星期日";
  if (weekend) {
    if (hour < 8) return "休息中";
    if (hour < 12) return "周末个人安排";
    if (hour < 14) return "午休 / 用餐";
    if (hour < 18) return "周末活动";
    if (hour < 23) return "晚间休闲或社交";
    return "休息中";
  }
  if (hour < 7) return "休息中";
  if (hour < 9) return occupation ? "准备出门或通勤" : "处理日常";
  if (hour < 12) return occupation ? `工作中（${occupation}）` : "上午安排";
  if (hour < 14) return "午休 / 用餐";
  if (hour < 18) return occupation ? `工作中（${occupation}）` : "下午安排";
  if (hour < 20) return occupation ? "下班或通勤" : "傍晚安排";
  if (hour < 23) return "晚间个人时间";
  return "休息中";
}

function privateProjection(messages: readonly { role: "user" | "assistant"; content: string }[]): XumengCharacterStatus["privateState"] {
  // Only the latest visible assistant turn can update this projection. User
  // quotes, old turns and negated descriptions must not become current facts.
  const lastUser = messages.map(message => message.role).lastIndexOf("user");
  const text = lastUser >= 0
    ? [...messages.slice(lastUser + 1)].reverse().find(message => message.role === "assistant")?.content ?? ""
    : "";
  const positive = (pattern: RegExp, negative: RegExp) => pattern.test(text) && !negative.test(text);
  const temperature = positive(/滚烫|发烫|灼热/u, /(?:没有|未见|不再|并未)[^。！？\n]{0,8}(?:滚烫|发烫|灼热)/u)
    ? "发烫" : positive(/发热|温热/u, /(?:没有|未见|不再|并未)[^。！？\n]{0,8}(?:发热|温热)/u) ? "发热" : "未记录";
  const fluid = positive(/流水|流出|湿透|湿润|潮湿|体液/u, /(?:没有|未见|不再|并未)[^。！？\n]{0,8}(?:流水|流出|湿透|湿润|潮湿|体液)/u) ? "有体液记录" : "未记录";
  const arousal = positive(/高潮|战栗|颤抖|喘息|欲望|兴奋/u, /(?:没有|未见|不再|并未)[^。！？\n]{0,8}(?:高潮|战栗|颤抖|喘息|欲望|兴奋)/u)
    ? "明显唤起" : positive(/平静|冷静/u, /(?:没有|未见|不再|并未)[^。！？\n]{0,8}(?:平静|冷静)/u) ? "平静" : "未记录";
  return { temperature, fluid, arousal };
}

export function deriveXumengCharacterStatus(input: XumengStatusInput): XumengCharacterStatus {
  const now = input.now ?? Date.now();
  const mode = inferXumengStatusMode(input.character);
  const occupation = mode === "companion" ? extractXumengOccupation(input.character) : null;
  const minute = clockMinute(input.world);
  const day = dayLabel(input.world, now, input.clockMode ?? "story");
  const hour = minute === null ? null : Math.floor(minute / 60);
  const timeLabel = minute === null ? "时间未设定" : `${String(hour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const scene = input.memory?.scene?.trim() || input.world?.location?.trim() || input.character.scenario?.trim() || "当前场景未记录";
  const event = input.world?.threads.find(thread => thread.status === "open")?.text
    || input.memory?.pending[0]
    || "暂无待处理事件";
  const people = [input.character.name, ...(input.world?.relationships.map(item => item.name) ?? [])].filter(Boolean).slice(0, 5);
  const activity = mode === "companion"
    ? routineActivity(minute, day, occupation)
    : (input.world?.threads.find(thread => thread.status === "open")?.text ? "围绕当前事件行动" : "按当前场景继续互动");
  return {
    mode,
    modeLabel: mode === "companion" ? "AI 女友" : "AI 酒馆",
    characterName: input.character.name,
    occupation,
    timeLabel,
    dayLabel: day,
    location: input.world?.location?.trim() || "地点未记录",
    scene,
    activity,
    event,
    people,
    privateState: mode === "tavern" ? privateProjection(input.messages ?? []) : null,
  };
}

export function xumengStatusBarLabels(bar: XumengStatusBar): string[] {
  const labels: string[] = [];
  for (const field of parseXumengStatusContent([bar.template, bar.initialState].filter(part => part.trim()).join("\n")).flatMap(section => section.fields)) {
    if (field.label && !labels.includes(field.label)) labels.push(field.label);
  }
  return labels;
}

function liveStatusValues(bar: XumengStatusBar, messages: readonly { role: string; content: string }[]): Map<string, string> {
  const labels = xumengStatusBarLabels(bar);
  const latest = [...messages].reverse().find(message => message.role === "assistant" && message.content.trim());
  const marked = latest ? splitXumengMessagePresentation(latest.content).status?.fields ?? [] : [];
  const trailing = latest && !marked.length ? peelXumengLabeledStatusTail(latest.content, labels).fields : [];
  const live = marked.length ? marked : trailing;
  const values = new Map<string, string>();
  for (const field of live) if (field.label) values.set(field.label, field.value);
  return values;
}

export type XumengStatusBarField = { key: string; label: string; type: "text"; value: string };
export type XumengStatusBarSection = { title: string; fields: XumengStatusBarField[] };

export function xumengStatusBarFields(bar: XumengStatusBar, messages: readonly { role: string; content: string }[] = []): XumengStatusBarField[] {
  const base = parseXumengStatusContent(bar.initialState || bar.template).flatMap(section => section.fields);
  const live = liveStatusValues(bar, messages);
  const order: string[] = [];
  const values = new Map<string, string>();
  for (const field of base) {
    if (!field.label) continue;
    if (!values.has(field.label)) order.push(field.label);
    values.set(field.label, live.get(field.label) ?? field.value);
  }
  for (const [label, value] of live) {
    if (values.has(label)) continue;
    order.push(label);
    values.set(label, value);
  }
  return order.slice(0, 40).map(label => ({ key: `status:${label}`, label, type: "text", value: values.get(label) || "未记录" }));
}

/** Keep the author's section titles, then overlay the latest reply's values. */
export function xumengStatusBarSections(bar: XumengStatusBar, messages: readonly { role: string; content: string }[] = []): XumengStatusBarSection[] {
  const base = parseXumengStatusContent(bar.initialState || bar.template);
  const live = liveStatusValues(bar, messages);
  const seen = new Set<string>();
  const sections = base.map(section => {
    const fields = section.fields.filter(field => field.label).map(field => {
      seen.add(field.label);
      return { key: `status:${field.label}`, label: field.label, type: "text" as const, value: live.get(field.label) ?? field.value };
    });
    return { title: section.title, fields };
  }).filter(section => section.fields.length);
  const extra = [...live].filter(([label]) => !seen.has(label)).map(([label, value]) => ({
    key: `status:${label}`, label, type: "text" as const, value,
  }));
  if (extra.length) {
    const last = sections.at(-1);
    if (last) last.fields.push(...extra);
    else sections.push({ title: "", fields: extra });
  }
  return sections.map(section => ({ ...section, fields: section.fields.slice(0, 40) })).filter(section => section.fields.length);
}

export function buildXumengStatusBarInstruction(bar: XumengStatusBar): string {
  return [
    "【角色状态栏】这张卡使用作者给定的状态栏。每轮正文写完后另起一段，按模板的原字段和原顺序输出状态栏，不要改名、不要省略。数值按更新规则随本轮剧情变化；还没发生的项保持初始状态。",
    bar.initialState.trim() ? `初始状态：\n${bar.initialState.trim()}` : "",
    bar.updateRules.trim() ? `更新规则：\n${bar.updateRules.trim()}` : "",
    bar.template.trim() ? `模板：\n${bar.template.trim()}` : "",
  ].filter(Boolean).join("\n");
}

export function buildXumengCharacterStatusInstruction(status: XumengCharacterStatus, panelTail = false): string {
  const routine = status.mode === "companion" && status.occupation
    ? `职业为「${status.occupation}」，当前活动按已知的时间和工作日安排推导为「${status.activity}」。`
    : "没有足够的职业或周历证据时，不要自行编造工作安排。";
  const panels = panelTail ? "作者开启的互动面板尾部照常按【互动面板协议】追加。"
    : status.mode === "companion" ? "不在正文中写状态块或状态字段。"
    : "这张卡没有互动面板。角色卡或作者设定自己写明了状态栏、属性、穿着、内心独白等输出格式时，按卡里的格式写在正文末尾；卡里没有写明时，不在正文中写状态块或状态字段。";
  return `【可见角色状态投影】${status.modeLabel}；时间${status.timeLabel}${status.dayLabel ? `（${status.dayLabel}）` : ""}；地点${status.location}；场景${status.scene}；当前活动${status.activity}；事件${status.event}；${routine}。只输出自然对话、故事和必要动作。${panels}状态只用于保持连续性，不要把内部状态标签原样输出，不要推断用户的身体、意图、行为或同意；时间、职业和场景未知时保持未知。状态投影不是事实写回协议；不要输出 <xumeng-character-status>。`;
}
