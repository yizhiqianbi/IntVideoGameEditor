import assert from "node:assert/strict";
import test from "node:test";
import { assembleSillyTavernImagePrompt, combineSillyTavernPrefixes, processSillyTavernReply, SILLYTAVERN_DEFAULT_PREFIX, SILLYTAVERN_IMAGE_MODE, sillyTavernQuietMessages, sillyTavernQuietPrompt } from "./sd-prompt.ts";

test("last message mode asks the chat model for visible keywords only", () => {
  const quiet = sillyTavernQuietPrompt(SILLYTAVERN_IMAGE_MODE.now, { char: "苏沛真", user: "你" });
  assert.match(quiet, /comma-delimited list/);
  assert.match(quiet, /苏沛真/);
  assert.match(quiet, /spoken dialog/);
  assert.equal(quiet.includes("{{char}}"), false);
  const messages = sillyTavernQuietMessages(
    [{ role: "assistant", content: "筷子停住。她看了你一眼。" }],
    quiet,
  );
  assert.equal(messages.at(-1)?.content, quiet);
  assert.match(messages[0].content, /筷子停住/);
});

test("english replies become tags and chinese replies keep their words", () => {
  assert.equal(processSillyTavernReply('Here is the prompt:\n"1 woman", moonlight.'), "Here is the prompt:, 1 woman, moonlight.");
  assert.equal(processSillyTavernReply("她靠在柜台边，白衬衫。"), "她靠在柜台边，白衬衫。");
});

test("the final prompt is the common prefix plus the scene, with a separate negative", () => {
  const assembled = assembleSillyTavernImagePrompt({ scene: "1 woman, nude, moonlight on the woods", char: "苏沛真", user: "你" });
  assert.equal(assembled.positive, `${combineSillyTavernPrefixes(SILLYTAVERN_DEFAULT_PREFIX, "1 woman, nude, moonlight on the woods")}`);
  assert.match(assembled.positive, /^best quality, absurdres, aesthetic, 1 woman, nude/);
  assert.match(assembled.negative, /bad hands/);
  assert.equal(assembled.positive.includes("bad hands"), false);
});
