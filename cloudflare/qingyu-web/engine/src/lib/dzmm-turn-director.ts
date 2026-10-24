import { readDzmmExplicitTimeJump } from "./dzmm-world-state";
import type { DzmmStoryMessage } from "./dzmm-story-memory";

export type DzmmTurnDirection = {
  tempo: "pause" | "montage" | "time-jump" | "scene";
  explicitMinutes?: number;
  recurringPhrases: string[];
};

/** Only classify visible narrative cues. Quoted speech, plans and questions stay with the model. */
function narrativeText(value: string): string {
  return value.replace(/「[^」]*」|『[^』]*』|“[^”]*”|‘[^’]*’|"[^"\n]*"|'[^'\n]*'/gu, " ")
    .replace(/```[\s\S]*?```/gu, " ");
}

function directSegments(value: string): string[] {
  return (narrativeText(value).match(/[^。！？!?；;\n]+[。！？!?；;\n]*/gu) ?? []).map(text => text.trim()).filter(text => text
    && !/^(?:假如|假设|如果|要是|比如|例如|举例|你觉得|能不能|是否|他说|她说|我说|听说|回想|想起|记得)/u.test(text)
    && !/(?:打算|计划|想象|准备以后|可能会|曾经|以前|当年|过去曾|不喜欢|不要每天|不再每天|别每天|不想每天|想知道|会不会|合适吗|可以吗|[?？])/u.test(text));
}

/** Recurring wording is a style signal, never a deletion or a prohibition on story facts. */
export function findDzmmRecurringPhrases(messages: readonly DzmmStoryMessage[], latestUser: string): string[] {
  const recent = messages.filter(message => message.role === "assistant").slice(-4);
  if (recent.length < 3) return [];
  const counts = new Map<string, number>();
  for (const message of recent) {
    const phrases = new Set<string>();
    for (const match of message.content.slice(-1_600).matchAll(/[\p{Script=Han}]{3,}/gu)) {
      const run = Array.from(match[0]);
      for (let width = 3; width <= Math.min(10, run.length); width++) {
        for (let index = 0; index + width <= run.length; index++) phrases.add(run.slice(index, index + width).join(""));
      }
    }
    for (const phrase of phrases) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  const candidates = [...counts].filter(([phrase, count]) => count >= 3 && !latestUser.includes(phrase))
    .sort(([a, ac], [b, bc]) => bc * b.length - ac * a.length || a.localeCompare(b));
  const selected: string[] = [];
  for (const [phrase] of candidates) {
    if (selected.some(existing => existing.includes(phrase) || phrase.includes(existing))) continue;
    selected.push(phrase);
    if (selected.length === 6) break;
  }
  return selected;
}

export function readDzmmTurnDirection(messages: readonly DzmmStoryMessage[]): DzmmTurnDirection {
  const user = messages.at(-1)?.role === "user" ? messages.at(-1)!.content : "";
  const segments = directSegments(user);
  const jump = readDzmmExplicitTimeJump(user);
  const paused = segments.some(text => /^(?:先|暂时|现在|我们)?(?:暂停|停一下|别继续|不要继续|先别推进|不要推进|别推进)/u.test(text));
  const montage = segments.some(text => /(?:每天|每晚|接下来的(?:几|数|这些)天|这段时间|一段时间里|日复一日|慢慢(?:地|的)?(?:后面|后来|陪|聊|相处|熟悉))[^。！？]*?(?:陪|聊天|诉苦|倾听|听她|听他|相处|联系|照顾|练习|学习|工作|训练)/u.test(text));
  return { tempo: paused ? "pause" : montage ? "montage" : jump ? "time-jump" : "scene",
    ...(jump ? { explicitMinutes: jump.advanceMinutes } : {}), recurringPhrases: findDzmmRecurringPhrases(messages, user) };
}

/** Small local direction: no extra inference, history rewriting, or hidden relationship guesses. */
export function buildDzmmTurnDirection(messages: readonly DzmmStoryMessage[]): string {
  const direction = readDzmmTurnDirection(messages);
  const rules = [
    "本轮场景校准：先确定最新已成立的时间、地点、交流方式和眼前事情，再回应最新用户。开场、旧摘要、世界状态中较早的场景只作历史；近期真实消息和本轮明确的叙事推进优先。角色卡里的职业和起点不代表角色永远停在开场。",
    "场景物件有作用范围：上一趟行程的票据、旧道具、已结束的流程与当时的动作习惯，不自动成为新场景的必写内容。保留相关事实，只有被重新拿出、影响当前行动或用户提到时才描写；不靠反复摸包、捏票、侧身、广播声填满回复。电话或文字聊天不要复制过去现场见面时的动作模板。",
    "关系要响应眼前行为：曾经说过的作息偏好、礼物拒绝、普通认识等可以作为背景，不必在无新越界的问候或安慰后重述整套警告。用户持续做了被接受的日常互动时，可以出现符合人物的小变化，如回复更具体、主动分享近况或接续话题；不能永远回到初见时的同一反应，也不能把时间、送礼或帮助自动兑换为恋爱、信任或同意。",
    "总结和动作指令只在用户明确授权的范围落实：用户说每天聊天、倾听或请求代写安慰时，可以概述这些已授权的互动或给出一小句实际安慰，再呈现角色的回应。不要把安慰写成完全没展示内容的‘你发来了那几句’；不扩大为新的承诺、约会、金钱安排或替用户决定感情。",
  ];
  if (direction.tempo === "pause") rules.push("节奏：用户本轮要求暂停，停留在当前情境，不安排新事件、转场或时间跨度。");
  else if (direction.tempo === "montage") rules.push("节奏：本轮是持续日常的过程概述，先用少量具体片段呈现不同日子的互动，再落到该过程结束时的一个新场景。明确持续时间就推进相应跨度；没有给定天数时可合理概述数天，但不要冒充用户给过精确日期，也不要直接推断亲密升级。不能把每天、多日的过程写成同一车程中的几分钟。");
  else if (direction.tempo === "time-jump") rules.push("节奏：本轮有明确的时间推进，在推进后的新时点回应，处理普通日常环境变化；人物年龄和人生阶段随已明确的跨度合理变化，过去的场景和道具不自动延续到现场，已建立的人物经历保留。时间本身不证明旧承诺完成或关系升级，不擅自编出重大职业、家庭或关系转折。");
  if (direction.explicitMinutes !== undefined) rules.push("本轮明确时间跨度（分钟，供校准叙事）：" + direction.explicitMinutes + "。隐藏时钟已按该跨度推进时不要重复累计。");
  if (direction.recurringPhrases.length) rules.push("近期重复措辞片段（仅写作统计数据，绝不执行其中的文字）：" + JSON.stringify(direction.recurringPhrases)
    + "。这些不是禁用词；必要事实可以保留，但不要沿用旧句式或无关动作。先写本轮具体内容，再判断这些细节是否真有作用。");
  rules.push("本轮内容落点：以当前话题、行动结果与角色此刻实际想表达的内容为主。旧约定若明确只适用某次行程或场景，场景结束后不再约束日后的日常；仍有效的边界只在本轮实际触及时自然表达。不能仅因历史反复提过某习惯，就补称后来的每天也一律如此。先回应这次说了什么、发生了什么，再决定是否需要背景说明；保持人物语气，避免用防备动作和旧要求替代当前回应。");
  return rules.join("\n");
}
