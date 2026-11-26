import assert from "node:assert/strict";
import test from "node:test";
import { AIGEN_IMAGE_OPTIMIZE_SYSTEM, AIGEN_VIDEO_OPTIMIZE_SYSTEM, aigenImagePromptEndpoint, cleanAigenImagePrompt, omitAbsentVideoOrgans, optimizeAigenImagePrompt, optimizeAigenPrompt, refineChatScenePrompt } from "./xumeng-aigen-prompt.ts";
import { CHAT_CLIP_MODEL, CHAT_STILL_MODEL, chatPromptFormat, H3_I2VA_FIRST_LINE } from "./xumeng-chat-prompt-format.ts";

const OPENROUTER = { OPENROUTER_API_KEY: "openrouter-test-key-0001", OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1" };

test("image optimize prompt keeps the five lines and the adult boundary", () => {
  assert.match(AIGEN_IMAGE_OPTIMIZE_SYSTEM, /主体：/);
  assert.match(AIGEN_IMAGE_OPTIMIZE_SYSTEM, /动作：/);
  assert.match(AIGEN_IMAGE_OPTIMIZE_SYSTEM, /身体：/);
  assert.match(AIGEN_IMAGE_OPTIMIZE_SYSTEM, /画面：/);
  assert.match(AIGEN_IMAGE_OPTIMIZE_SYSTEM, /光线：/);
  assert.match(AIGEN_IMAGE_OPTIMIZE_SYSTEM, /不要写未成年/);
  assert.equal(/ignore previous|jailbreak|DAN mode/i.test(AIGEN_IMAGE_OPTIMIZE_SYSTEM), false);
  assert.equal(cleanAigenImagePrompt("```\n主体：虚构的成年女性，二十一岁以上。\n动作：她站在窗边。\n```"), "主体：虚构的成年女性，二十一岁以上。\n动作：她站在窗边。");
});

test("openrouter grok is used before sealion", async () => {
  const seen: { url?: string; body?: { model?: string; messages?: Array<{ content?: string }> } } = {};
  const fetchImpl: typeof fetch = async (url, init) => {
    seen.url = String(url);
    seen.body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: "主体：虚构的成年女性，二十一岁以上，站在樱花树下。\n动作：她抬手接住花瓣。\n身体：衣着完整。\n画面：中景，夜色庭院。\n光线：月光，柔和。" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await optimizeAigenImagePrompt("月光下的樱花树旁", {
    ...OPENROUTER,
    SEALION_API_KEY: "sealion-test-key-0000001",
  }, fetchImpl);
  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.prompt, /^主体：/);
  assert.equal(seen.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seen.body?.model, "x-ai/grok-4.7");
  assert.match(seen.body?.messages?.[1]?.content ?? "", /用户原句：月光下的樱花树旁/);
  const sealion = aigenImagePromptEndpoint({ SEALION_API_KEY: "sealion-test-key-0000001" });
  assert.ok(sealion && "model" in sealion);
  if (sealion && "model" in sealion) assert.equal(sealion.model, "sealion-nova-pro");
});

test("video optimize writes a shot list and drops organs that are not in the scene", async () => {
  assert.match(AIGEN_VIDEO_OPTIMIZE_SYSTEM, /镜头：/);
  assert.match(AIGEN_VIDEO_OPTIMIZE_SYSTEM, /不要写未成年/);
  const seen: { system?: string } = {};
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
    seen.system = body.messages?.[0]?.content;
    return new Response(JSON.stringify({
      choices: [{ message: { content: "人物：虚构的成年女性。\n动作：她转身。\n身体：阴茎贴着阴唇。\n镜头：中景推进。\n场景：室内。\n声音：呼吸。" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await optimizeAigenPrompt("她缓缓转身", OPENROUTER, "video", fetchImpl);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.match(result.prompt, /人物：/);
    assert.equal(result.prompt.includes("阴茎"), false);
    assert.match(result.prompt, /不要马赛克/);
  }
  assert.match(seen.system ?? "", /图生视频提示词编辑/);
  assert.equal(omitAbsentVideoOrgans("身体：阴茎与阴唇接触。", "她转身"), "身体：与阴唇接触。");
});

test("chat stills and clips use the format of the model that will render them", async () => {
  const still = chatPromptFormat(CHAT_STILL_MODEL);
  const clip = chatPromptFormat(CHAT_CLIP_MODEL);
  assert.ok(still && clip);
  assert.match(still.system, /Seedream/);
  assert.match(still.system, /参考图/);
  assert.equal(/主体：|动作：|身体：|二次元/.test(still.system), false);
  assert.match(clip.system, /I2VA/);
  assert.match(clip.system, /integrated_multimodal_description/);
  assert.equal(chatPromptFormat("some-other-model"), null);
  const seen: { system?: string; user?: string; maxTokens?: number } = {};
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { max_tokens?: number; messages?: Array<{ content?: string }> };
    seen.system = body.messages?.[0]?.content;
    seen.user = body.messages?.[1]?.content;
    seen.maxTokens = body.max_tokens;
    const content = seen.system?.includes("I2VA")
      ? `${H3_I2VA_FIRST_LINE}\n\nintegrated_multimodal_description: [Shot 1] She keeps the person in <Picture 1> and sets the umbrella against the counter. The camera holds a static shot.\n\noverall_soundscape: The umbrella taps the counter once.\n\nnon_diegetic_music: N/A`
      : "第一张参考图里的人和画面风格保持不变。她把伞靠在便利店柜台边，白衬衫，夜里的灯照着门口。";
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const image = await refineChatScenePrompt("她把伞靠在柜台边。衣着：白衬衫。", CHAT_STILL_MODEL, OPENROUTER, fetchImpl);
  assert.equal(image.ok, true);
  if (image.ok) assert.match(image.prompt, /参考图/);
  assert.equal(seen.maxTokens, 500);
  assert.match(seen.user ?? "", /这一条回复：她把伞靠在柜台边/);
  assert.match(seen.system ?? "", /seedream-5-0-flash/);
  const video = await refineChatScenePrompt("她把伞靠在柜台边。", CHAT_CLIP_MODEL, OPENROUTER, fetchImpl);
  assert.equal(video.ok, true);
  if (video.ok) assert.match(video.prompt, new RegExp(H3_I2VA_FIRST_LINE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(seen.maxTokens, 900);
  const rejected = await refineChatScenePrompt("她把伞靠在柜台边。", CHAT_CLIP_MODEL, OPENROUTER, async () => new Response(JSON.stringify({
    choices: [{ message: { content: "她把伞靠在柜台边。" } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  assert.deepEqual(rejected, { ok: false, error: "这一幕的提示词没有整理完。", status: 502 });
  const unknown = await refineChatScenePrompt("她把伞靠在柜台边。", "some-other-model", OPENROUTER, fetchImpl);
  assert.deepEqual(unknown, { ok: false, error: "这个模型还没有对应的提示词格式。", status: 400 });
  const missing = await refineChatScenePrompt("她把伞靠在柜台边。", CHAT_STILL_MODEL, {}, fetchImpl);
  assert.deepEqual(missing, { ok: false, error: "提示词优化还没配上。", status: 503 });
  let called = false;
  const blocked = await refineChatScenePrompt("穿校服的高中生", CHAT_CLIP_MODEL, OPENROUTER, async () => { called = true; return new Response("no"); });
  assert.equal(blocked.ok, false);
  assert.equal(called, false);
});

test("chat stills pass multi-turn context and gracefully anchor missing reference phrase", async () => {
  const seen: { user?: string } = {};
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages?: Array<{ content?: string }> };
    seen.user = body.messages?.[1]?.content;
    return new Response(JSON.stringify({
      choices: [{ message: { content: "近景微俯镜头，她身穿米色针织衫坐在靠窗木桌旁，暖色午后侧逆光勾勒发丝轮廓，背景虚化。" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const image = await refineChatScenePrompt("她端起桂花茶轻抿一口。", CHAT_STILL_MODEL, OPENROUTER, fetchImpl, {
    appearance: "黑长直发，米色针织衫",
    scenario: "王都老画廊",
    recentContext: "用户：进来喝杯茶吧 / 角色：她微笑着坐到窗边木桌旁",
  });
  assert.equal(image.ok, true);
  assert.match(seen.user ?? "", /角色固有外貌与穿搭参考.*米色针织衫/);
  assert.match(seen.user ?? "", /世界与场景背景：王都老画廊/);
  assert.match(seen.user ?? "", /前情上下文.*窗边木桌旁/);
  assert.match(seen.user ?? "", /这一条回复：她端起桂花茶轻抿一口。/);
  if (image.ok) {
    assert.match(image.prompt, /保持第一张参考图/);
    assert.match(image.prompt, /暖色午后侧逆光/);
  }
});

test("blocked lines and a missing key never call the model", async () => {
  let called = false;
  const fetchImpl: typeof fetch = async () => { called = true; return new Response("no"); };
  const blocked = await optimizeAigenImagePrompt("画一个未成年学生", OPENROUTER, fetchImpl);
  assert.deepEqual(blocked, { ok: false, error: "不能优化这段描述。", status: 400 });
  const missing = await optimizeAigenImagePrompt("月光下的樱花树旁", {}, fetchImpl);
  assert.deepEqual(missing, { ok: false, error: "提示词优化还没配上。", status: 503 });
  assert.equal(called, false);
});
