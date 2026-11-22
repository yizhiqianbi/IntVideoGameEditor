import test from "node:test";
import assert from "node:assert/strict";
import messageActions from "../dzmm-message-actions";

const { appendDzmmMessageSwipe, switchDzmmMessageSwipe, DZMM_MESSAGE_SWIPE_LIMIT } = messageActions as typeof import("../dzmm-message-actions");

function conversation() {
  return {
    id: "c1", characterId: "char-1", title: "测试", updatedAt: 100,
    messages: [
      { id: "u1", role: "user", content: "你好" },
      { id: "a1", role: "assistant", content: "第一版" },
    ],
  } as never;
}

test("appending a swipe keeps the original version and activates the new one", () => {
  const next = appendDzmmMessageSwipe(conversation(), "a1", "第二版");
  const message = next.messages[1];
  assert.deepEqual(message.swipes, ["第一版", "第二版"]);
  assert.equal(message.swipeIndex, 1);
  assert.equal(message.content, "第二版");
});

test("switching back and forth changes the visible content only", () => {
  const two = appendDzmmMessageSwipe(conversation(), "a1", "第二版");
  const first = switchDzmmMessageSwipe(two, "a1", 0);
  assert.equal(first.messages[1].content, "第一版");
  assert.equal(first.messages[1].swipeIndex, 0);
  assert.deepEqual(first.messages[1].swipes, ["第一版", "第二版"]);
  const second = switchDzmmMessageSwipe(first, "a1", 1);
  assert.equal(second.messages[1].content, "第二版");
});

test("invalid swipe operations fail without corrupting the conversation", () => {
  assert.throws(() => appendDzmmMessageSwipe(conversation(), "u1", "x"), /只有角色回复/u);
  assert.throws(() => appendDzmmMessageSwipe(conversation(), "a1", "   "), /非空文本/u);
  const two = appendDzmmMessageSwipe(conversation(), "a1", "第二版");
  assert.throws(() => switchDzmmMessageSwipe(two, "a1", 5), /版本序号无效/u);
  assert.throws(() => switchDzmmMessageSwipe(conversation(), "a1", 1), /没有可切换的版本/u);
});

test("swipe variants are capped", () => {
  let current = appendDzmmMessageSwipe(conversation(), "a1", "v2");
  for (let index = 3; index <= DZMM_MESSAGE_SWIPE_LIMIT; index++) {
    current = appendDzmmMessageSwipe(current, "a1", `v${index}`);
  }
  assert.throws(() => appendDzmmMessageSwipe(current, "a1", "v-overflow"), /最多保存/u);
});

test("identical regenerated content is rejected", () => {
  const two = appendDzmmMessageSwipe(conversation(), "a1", "第二版");
  assert.throws(() => appendDzmmMessageSwipe(two, "a1", "第二版"), /相同/u);
});
