import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanOptimizedPrompt, omitAbsentOrgans, optimizePrompt, optimizeVideoPrompt } from "./prompt-optimize.mjs";

test("optimized prompts keep the five lines", () => {
  const prompt = cleanOptimizedPrompt("```\n人物：虚构的成年女性，二十一岁以上。\n动作：她解开上衣。\n```");
  assert.match(prompt, /^人物：/);
  assert.match(prompt, /动作：/);
  assert.equal(prompt.includes("```"), false);
});

test("sealion rewrites a video line and refuses a blocked line", async () => {
  const seen = {};
  const fetchImpl = async (url, init) => {
    seen.url = String(url);
    seen.body = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "人物：虚构的成年女性，二十一岁以上，只穿着衬衫。\n动作：她坐到对方腿上接吻。\n镜头：中景推近。\n场景：卧室，暖光。\n声音：呼吸和衣料。" } }] }),
    };
  };
  const result = await optimizeVideoPrompt("她坐到他腿上接吻。", {
    env: { SEALION_API_KEY: "test-key", SEALION_BASE_URL: "https://open-sealion.aiaigirl.com/v1" },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.match(result.prompt, /镜头：/);
  assert.match(result.prompt, /不要马赛克/);
  assert.equal(seen.url, "https://open-sealion.aiaigirl.com/v1/chat/completions");
  assert.equal(seen.body.model, "sealion-nova-pro");
  assert.match(seen.body.messages[0].content, /阴茎/);
  assert.match(seen.body.messages[0].content, /阴道/);
  assert.match(seen.body.messages[0].content, /不要写阴蒂/);
  const blocked = await optimizeVideoPrompt("未成年角色。", {
    env: { SEALION_API_KEY: "test-key" },
    fetchImpl,
  });
  assert.equal(blocked.ok, false);
});

test("a woman-only scene drops male anatomy", () => {
  const prompt = omitAbsentOrgans("人物：虚构的成年女性。\n身体：露出阴道，含住阴茎。", "她脱掉裙子。");
  assert.match(prompt, /阴道/);
  assert.equal(prompt.includes("阴茎"), false);
  const both = omitAbsentOrgans("身体：阴蒂和阴茎接触。", "她和他。");
  assert.match(both, /阴茎/);
  assert.equal(both.includes("阴蒂"), false);
});

test("character optimization stays a character sheet", async () => {
  const seen = {};
  const fetchImpl = async (url, init) => {
    seen.body = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "身份：林晚，虚构的成年人，二十八岁。\n外貌：身形匀称。\n性格：话少。\n关系：对旅人有意。" } }] }),
    };
  };
  const result = await optimizePrompt("林晚，二十八岁，书店店主。", {
    kind: "character",
    env: { SEALION_API_KEY: "test-key", SEALION_BASE_URL: "https://open-sealion.aiaigirl.com/v1" },
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.match(result.prompt, /身份：/);
  assert.equal(result.prompt.includes("不要马赛克"), false);
  assert.match(seen.body.messages[0].content, /人物设定/);
});
