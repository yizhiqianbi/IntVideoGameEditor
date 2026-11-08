import assert from "node:assert/strict";
import test from "node:test";
import personaModule from "./girlfriend-persona";

const { emptyGirlfriendDraft, girlfriendChatStyle, girlfriendFromDraft, girlfriendIssue } = personaModule as typeof import("./girlfriend-persona");

const cover = "data:image/jpeg;base64,aaaa";

function readyDraft() {
  return {
    ...emptyGirlfriendDraft(),
    nickname: "周晚",
    aliasNames: "晚晚",
    age: "26",
    line: "灯还亮着。",
    personality: "你是周晚，二十六岁，夜里还在工作室改稿。",
    behaviorStyle: "你记得他几点来。他说停，你这轮就收。",
    replyStyle: "像微信。句子短，不写旁白。",
    privateChatPrompts: "这是和周晚的一对一聊天。先接他最新一句。",
    cover,
  };
}

test("a girlfriend persona keeps MaiBot fields and projects the three chat slots", () => {
  const person = girlfriendFromDraft("account", "id-1", readyDraft(), 10);
  assert.equal(person.nickname, "周晚");
  assert.deepEqual(person.aliasNames, ["周晚", "晚晚"]);
  assert.equal(person.age, 26);
  assert.deepEqual(person.lines, ["灯还亮着。"]);
  assert.equal(person.behaviorStyle.includes("他说停"), true);
  const style = girlfriendChatStyle(person);
  assert.equal(style.version, 1);
  assert.equal(style.personality, person.personality);
  assert.equal(style.speakingStyle, person.replyStyle);
  assert.equal(style.relationshipStyle, person.behaviorStyle);
});

test("girlfriend personas reject missing pictures, underage ages, and empty MaiBot fields", () => {
  assert.match(girlfriendIssue(emptyGirlfriendDraft()), /封面/);
  assert.match(girlfriendIssue({ ...readyDraft(), age: "18" }), /21/);
  assert.match(girlfriendIssue({ ...readyDraft(), personality: "她今年十七岁。" }), /21/);
  assert.match(girlfriendIssue({ ...readyDraft(), replyStyle: "" }), /说法/);
});
