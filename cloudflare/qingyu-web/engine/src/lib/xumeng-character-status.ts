import type { DzmmStoryState } from "./dzmm-story-memory";
import type { DzmmWorldState, DzmmWorldClockMode } from "./dzmm-world-state";

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

function privateProjection(_messages: readonly {role:"user"|"assistant";content:string}[]): XumengCharacterStatus["privateState"] { return null; }

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

export function buildXumengCharacterStatusInstruction(status: XumengCharacterStatus): string {
  const routine = status.mode === "companion" && status.occupation
    ? `职业为「${status.occupation}」，当前活动按已知的时间和工作日安排推导为「${status.activity}」。`
    : "没有足够的职业或周历证据时，不要自行编造工作安排。";
  const presentation = "状态栏已关闭。只输出自然对话、自然故事正文和必要动作，不输出可见状态块或状态字段。";
  return `【可见角色状态投影】${status.modeLabel}；时间${status.timeLabel}${status.dayLabel ? `（${status.dayLabel}）` : ""}；地点${status.location}；场景${status.scene}；当前活动${status.activity}；事件${status.event}；${routine}。${presentation}状态只用于保持连续性，不要把内部状态标签原样输出，不要推断用户的身体、意图、行为或同意；时间、职业和场景未知时保持未知。状态投影不是事实写回协议；不要输出 <qingyu-character-status>，若未来启用该尾部必须使用严格 JSON，并只写本轮角色正文明确支持的字段。`;
}
