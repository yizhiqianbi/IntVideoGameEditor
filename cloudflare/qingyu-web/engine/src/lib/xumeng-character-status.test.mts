import test from "node:test";
import assert from "node:assert/strict";
import statusModule from "./xumeng-character-status";

const {
  inferXumengStatusMode,
  extractXumengOccupation,
  deriveXumengCharacterStatus,
  buildXumengCharacterStatusInstruction,
} = statusModule as typeof import("./xumeng-character-status");

const worldAt = (minuteOfDay: number | null, calendarLabel = "") => ({
  clock: { elapsedMinutes: 0, day: 4, minuteOfDay, calendarLabel, remainderMs: 0 },
  location: "办公室", relationships: [], threads: [], facts: [],
});

test("mode is explicit from companion markers and defaults to tavern", () => {
  assert.equal(inferXumengStatusMode({ name: "酒馆角色", tags: ["剧情"] }), "tavern");
  assert.equal(inferXumengStatusMode({ name: "她", tags: ["AI女友"] }), "companion");
});

test("tavern private state does not invent values when there is no current evidence", () => {
  const status = deriveXumengCharacterStatus({ character: { name: "酒馆角色", tags: ["剧情"] }, world: worldAt(720), messages: [] });
  assert.equal(status.mode, "tavern");
  assert.deepEqual(status.privateState, { temperature: "未记录", fluid: "未记录", arousal: "未记录" });
});

test("opening text is not treated as a current private state before the first user turn", () => {
  const status = deriveXumengCharacterStatus({
    character: { name: "酒馆角色", tags: ["剧情"] }, world: worldAt(720),
    messages: [{ role: "assistant", content: "开场写到她的身体发烫并有流水。" }],
  });
  assert.deepEqual(status.privateState, { temperature: "未记录", fluid: "未记录", arousal: "未记录" });
});

test("opening assistant prose is not a current private state before user interaction", () => {
  const status = deriveXumengCharacterStatus({
    character: { name: "酒馆角色", tags: ["剧情"] }, world: worldAt(720),
    messages: [{ role: "assistant", content: "她发烫，湿润的痕迹顺着肌肤流出。" }],
  });
  assert.equal(status.privateState?.temperature, "未记录");
  assert.equal(status.privateState?.fluid, "未记录");
});

test("latest visible assistant turn can project explicit private cues", () => {
  const status = deriveXumengCharacterStatus({
    character: { name: "酒馆角色", tags: ["剧情"] }, world: worldAt(720),
    messages: [
      { role: "user", content: "我确认我们都是成年人，并明确同意继续。" },
      { role: "assistant", content: "她的体温发烫，湿润的痕迹顺着肌肤流出，喘息。" },
    ],
  });
  assert.equal(status.privateState?.temperature, "发烫");
  assert.equal(status.privateState?.fluid, "有体液记录");
  assert.equal(status.privateState?.arousal, "明显唤起");
});

test("private regex must ignore stale history and negated/quoted text", () => {
  const status = deriveXumengCharacterStatus({
    character: { name: "酒馆角色", tags: ["剧情"] }, world: worldAt(720),
    messages: [
      { role: "assistant", content: "上一幕她发烫并有流水。" },
      { role: "user", content: "不要把‘发烫’当作现在的状态，我只是引用旧话。" },
      { role: "assistant", content: "她停在门口，等待你说明。" },
    ],
  });
  assert.equal(status.privateState?.temperature, "未记录");
  assert.equal(status.privateState?.fluid, "未记录");
  assert.equal(status.privateState?.arousal, "未记录");
});

test("occupation comes from an explicit field/phrase, not arbitrary personality keywords", () => {
  assert.equal(extractXumengOccupation({ name: "她", occupation: undefined, personality: "她很像医生一样细心。" }), null);
  assert.equal(extractXumengOccupation({ name: "她", description: "职业：图书馆馆员。" }), "图书馆馆员");
  assert.equal(extractXumengOccupation({ name: "医生", tags: ["AI女友"] }), "医生");
});

test("companion schedule has lunch at 12:00 and afternoon work at 14:00", () => {
  const character = { name: "林医生", tags: ["AI女友"], description: "职业：医生。" };
  const noon = deriveXumengCharacterStatus({ character, world: worldAt(720), clockMode: "story" });
  assert.equal(noon.mode, "companion");
  assert.equal(noon.occupation, "医生");
  assert.match(noon.activity, /午休/);
  const afternoon = deriveXumengCharacterStatus({ character, world: worldAt(840), clockMode: "story" });
  assert.match(afternoon.activity, /工作中/);
});

test("unknown story weekday does not get guessed as weekend and unknown time stays unknown", () => {
  const character = { name: "她", tags: ["AI女友"], description: "职业：工程师。" };
  const unknown = deriveXumengCharacterStatus({ character, world: worldAt(null), clockMode: "story" });
  assert.equal(unknown.dayLabel, null);
  assert.equal(unknown.activity, "日常安排未记录");
});

test("status prompt keeps the projection internal and disables visible status output", () => {
  const status = deriveXumengCharacterStatus({ character: { name: "她", tags: ["酒馆"] }, world: worldAt(720), messages: [] });
  const prompt = buildXumengCharacterStatusInstruction(status);
  assert.match(prompt, /不要推断用户的身体/);
  assert.match(prompt, /xumeng-character-status|严格 JSON/);
  assert.match(prompt, /状态栏已关闭/);
  assert.doesNotMatch(prompt, /点击查看状态栏/);
});

test("companion prompt keeps the tavern status block out of direct dialogue", () => {
  const status = deriveXumengCharacterStatus({ character: { name: "她", tags: ["AI女友"] }, world: worldAt(720), messages: [] });
  assert.match(buildXumengCharacterStatusInstruction(status), /只输出自然对话/);
});
