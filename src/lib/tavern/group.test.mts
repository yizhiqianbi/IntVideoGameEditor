import test from "node:test";
import assert from "node:assert/strict";
import groupModule from "./group";
import worldbookModule from "./worldbook";

const { buildTavernGroupPrompt, parseTavernGroupMembers, selectTavernGroupSpeaker } = groupModule as typeof import("./group");
const { parseTavernWorldbook } = worldbookModule as typeof import("./worldbook");

const members = [
  { characterId: "c1", name: "裴聿", description: "大理寺少卿，冷静克制。", personality: "寡言" },
  { characterId: "c2", name: "唐团团", description: "面包店老板娘，活泼。", characterBook: parseTavernWorldbook({ entries: [{ keys: ["面包"], content: "TANG_LORE：团团每天四点起床烤面包。" }] }) },
  { characterId: "c3", name: "沈砚", description: "资本合伙人。" },
];

test("group members are validated", () => {
  assert.equal(parseTavernGroupMembers(members).length, 3);
  assert.throws(() => parseTavernGroupMembers([members[0]]), /2 至 4 人/u);
  assert.throws(() => parseTavernGroupMembers([members[0], { characterId: "c1", name: "另一个人" }]), /角色无效或重复/u);
  assert.throws(() => parseTavernGroupMembers([members[0], { characterId: "c9", name: "裴聿" }]), /名称无效或重复/u);
});

test("speaker selection honours explicit choice, mentions and rotation", () => {
  assert.equal(selectTavernGroupSpeaker(members, [], "唐团团").name, "唐团团");
  assert.equal(selectTavernGroupSpeaker(members, [], "c3").name, "沈砚");
  assert.equal(selectTavernGroupSpeaker(members, [{ role: "user", content: "裴聿，你怎么看？" }]).name, "裴聿");
  assert.equal(selectTavernGroupSpeaker(members, [
    { role: "assistant", content: "上一轮", speaker: "裴聿" },
    { role: "user", content: "继续" },
  ]).name !== "裴聿", true, "rotation avoids repeating the previous speaker");
  assert.throws(() => selectTavernGroupSpeaker(members, [], "不存在的人"), /没有名为/u);
});

test("group prompt lists every member and writes as the active speaker", () => {
  const { speaker, plan } = buildTavernGroupPrompt({
    members,
    messages: [{ role: "user", content: "裴聿，说说案卷。记得面包的事。" }],
    userName: "楚曦",
    persona: "现代旅人",
    jailbreak: "JAILBREAK_RULES",
    memory: "MEMORY_BLOCK",
  });
  assert.equal(speaker.name, "裴聿");
  const contents = plan.messages.map(message => message.content).join("\n");
  for (const member of members) assert.match(contents, new RegExp(member.name, "u"));
  assert.match(contents, /本轮由「裴聿」回应/u);
  assert.match(contents, /大理寺少卿/u);
  assert.match(contents, /TANG_LORE/u, "other members' world books are merged");
  assert.match(contents, /JAILBREAK_RULES/u);
  assert.match(contents, /MEMORY_BLOCK/u);
});

test("history assistant turns are labelled with the member who spoke", () => {
  const { plan } = buildTavernGroupPrompt({
    members,
    messages: [
      { role: "user", content: "大家晚上好" },
      { role: "assistant", content: "晚上好。", speaker: "裴聿" },
      { role: "assistant", content: "晚上好呀。", speaker: "唐团团" },
      { role: "user", content: "唐团团，面包还有吗" },
    ],
    userName: "楚曦",
  });
  const contents = plan.messages.map(message => message.content).join("\n");
  assert.match(contents, /【裴聿】晚上好。/u);
  assert.match(contents, /【唐团团】晚上好呀。/u);
});

test("openings survive group assembly", () => {
  const { plan } = buildTavernGroupPrompt({
    members,
    messages: [{ role: "user", content: "继续" }],
    userName: "楚曦",
    opening: [{ role: "assistant", content: "GROUP_OPENING" }],
  });
  assert.ok(plan.messages.some(message => message.content.includes("GROUP_OPENING")));
});
