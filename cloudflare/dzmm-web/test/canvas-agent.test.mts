import assert from "node:assert/strict";
import test from "node:test";
import { agentEndpoint, endpoint, writeCanvasAgent } from "../src/canvas-agent";

const env = { DZMM_API_KEY: "k".repeat(24), DZMM_BASE_URL: "https://openrouter.ai/api/v1" };
const nodes = [{ id: "pic-1", type: "image", name: "窗边", hasMedia: true }];
const tools = {
  tools: '- storyboard {"shots":[]}：排分镜\n- generate {"ids":[]}：生成\n- ask {"prompt":"","options":[]}：提问',
  toolNames: ["storyboard", "generate", "ask", "import_image", "BAD NAME"],
};
const reply = (content: unknown) => async () =>
  Response.json({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });

test("canvas agent renders the tools and keeps only listed tool calls", async () => {
  const calls: { url: string; body: { model?: string; max_tokens?: number; tools?: unknown; messages: { content: string }[] } }[] = [];
  const response = await writeCanvasAgent(env, "排三个镜头", "导演执导", nodes, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${"k".repeat(24)}`);
    return Response.json({
      choices: [{ message: { annotations: [
        { type: "url_citation", url_citation: { url: "https://example.com/meme", title: "梗图合集" } },
        { type: "url_citation", url_citation: { url: "https://example.com/meme", title: "重复" } },
        { type: "url_citation", url_citation: { url: "javascript:alert(1)", title: "丢掉" } },
      ], content: '好的：```json\n{"text":"先排分镜。","calls":[{"tool":"storyboard","args":{"shots":[{"frame":"窗边"}]}},{"tool":"shell","args":{}},{"tool":"generate","args":[]},{"tool":"ask","prompt":"几镜？","options":["3","4"]},{"tool":"import_image","args":{"url":"https://example.com/a.png"}}],"done":false}\n```' } }],
    });
  }, { ...tools, edges: [{ source: "pic-1", target: "ghost" }] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    text: "先排分镜。",
    calls: [
      { tool: "storyboard", args: { shots: [{ frame: "窗边" }] } },
      { tool: "generate", args: {} },
      { tool: "ask", args: { prompt: "几镜？", options: ["3", "4"] } },
      { tool: "import_image", args: { url: "https://example.com/a.png" } },
    ],
    done: false,
    sources: [{ url: "https://example.com/meme", title: "梗图合集" }],
  });
  assert.deepEqual(calls[0].body.tools, [{ type: "openrouter:web_search", parameters: { max_results: 5, max_uses: 2 } }]);
  const prompt = calls[0].body.messages[0].content;
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].body.model, "x-ai/grok-4.7");
  assert.equal(calls[0].body.max_tokens, 2400);
  assert.match(prompt, /- storyboard \{"shots":\[\]\}：排分镜/);
  assert.match(prompt, /pic-1 窗边 image 已有素材/);
  assert.match(prompt, /（没有连线）/);
  assert.doesNotMatch(JSON.stringify(calls[0].body), /k{24}/);
});

test("plain text becomes a finished chat, and missing key or tools never call upstream", async () => {
  const response = await writeCanvasAgent(env, "打个招呼", "全能创作", [], reply("你好，想先写剧本还是排分镜？"), tools);
  assert.deepEqual(await response.json(), { text: "你好，想先写剧本还是排分镜？", calls: [], done: true, sources: [] });
  let called = false;
  const spy = async () => {
    called = true;
    return new Response("");
  };
  assert.equal((await writeCanvasAgent({}, "打个招呼", "全能创作", [], spy, tools)).status, 503);
  assert.equal((await writeCanvasAgent(env, "打个招呼", "全能创作", [], spy, {})).status, 400);
  assert.equal(called, false);
});

test("a later step sees the session and the previous results", async () => {
  const response = await writeCanvasAgent(env, "排三个镜头", "全能创作", nodes, async (_url, init) => {
    const messages = JSON.parse(String(init?.body)).messages as { role: string; content: string }[];
    const prompt = messages[0].content;
    assert.equal(messages[0].role, "system");
    assert.equal(messages.at(-1)?.content, "排三个镜头");
    assert.match(messages.map((item) => item.content).join("\n"), /先选题材/);
    assert.doesNotMatch(prompt, /丢掉/);
    assert.match(prompt, /这是第 2 步/);
    assert.match(prompt, /雨夜重逢/);
    assert.match(prompt, /完成 storyboard：第 1 镜 抬头/);
    assert.match(prompt, /手动生成/);
    return reply({ text: "", calls: [{ tool: "generate", args: { ids: ["$shot1"] } }] })();
  }, {
    ...tools,
    session: [{ role: "user", text: "先选题材" }, { role: "nope", text: "丢掉" }],
    memory: "题材是雨夜重逢。",
    observations: [{ tool: "storyboard", ok: true, note: "第 1 镜 抬头" }, { tool: "BAD", ok: true, note: "x" }],
    step: 1,
    dryRun: true,
  });
  assert.deepEqual(await response.json(), {
    text: "我先在画布上动手。",
    calls: [{ tool: "generate", args: { ids: ["$shot1"] } }],
    done: true,
    sources: [],
  });
});

test("the canvas agent can use the WhatsToken GLM without sending OpenRouter tools", async () => {
  const whats = {
    CANVAS_AGENT_API_KEY: "s".repeat(40),
    CANVAS_AGENT_BASE_URL: "https://www.whatstoken.ai/v1",
    CANVAS_AGENT_MODEL: "glm-5.3-selfhost-p",
    DZMM_API_KEY: "k".repeat(24),
    DZMM_BASE_URL: "https://openrouter.ai/api/v1",
  };
  const calls: { url: string; body: { model?: string; max_tokens?: number; tools?: unknown; reasoning?: unknown } }[] = [];
  const response = await writeCanvasAgent(whats, "打个招呼", "全能创作", [], async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${"s".repeat(40)}`);
    return Response.json({ choices: [{ message: { content: "你好" } }] });
  }, tools);
  assert.deepEqual(await response.json(), { text: "你好", calls: [], done: true, sources: [] });
  assert.equal(calls[0].url, "https://www.whatstoken.ai/v1/chat/completions");
  assert.equal(calls[0].body.model, "glm-5.3-selfhost-p");
  assert.equal(calls[0].body.max_tokens, 6000);
  assert.equal(calls[0].body.tools, undefined);
  assert.equal(calls[0].body.reasoning, undefined);
  assert.equal(endpoint(whats)?.model, "x-ai/grok-4.7");
  assert.equal(endpoint(whats)?.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(endpoint(whats)?.key, "k".repeat(24));
  assert.equal(agentEndpoint({ CANVAS_AGENT_BASE_URL: "https://www.whatstoken.ai/v1", CANVAS_AGENT_MODEL: "glm-5.3-selfhost-p", DZMM_API_KEY: "k".repeat(24) }), null);
  const grok = agentEndpoint({
    CANVAS_AGENT_API_KEY: "s".repeat(40),
    CANVAS_AGENT_BASE_URL: "https://openrouter.ai/api/v1",
    CANVAS_AGENT_MODEL: "x-ai/grok-4.7",
    DZMM_API_KEY: "k".repeat(24),
  });
  assert.equal(grok?.model, "x-ai/grok-4.7");
  assert.equal(grok?.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(grok?.key, "k".repeat(24));
  assert.equal(grok?.openRouter, true);
});

test("uncensored canvas models stay on their own hosts and omit reasoning", async () => {
  const calls: { url: string; body: { model?: string; reasoning?: unknown; tools?: unknown }; agent: string | null }[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      agent: new Headers(init?.headers).get("User-Agent"),
    });
    return Response.json({ choices: [{ message: { content: "写完了" } }] });
  };
  const cydonia = await writeCanvasAgent(env, "写一段", "全能创作", [], fetchImpl, { ...tools, model: "cydonia" });
  assert.equal(cydonia.status, 200);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].body.model, "thedrummer/cydonia-24b-v4.1");
  assert.equal(calls[0].body.reasoning, undefined);
  assert.equal(calls[0].agent, null);
  const venice = await writeCanvasAgent({
    ...env,
    CANVAS_AGENT_BASE_URL: "https://www.whatstoken.ai/v1",
    CANVAS_AGENT_MODEL: "glm-5.3-selfhost-p",
  }, "写一段", "全能创作", [], fetchImpl, { ...tools, model: "venice" });
  assert.equal(venice.status, 200);
  assert.equal(calls[1].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[1].body.model, "cognitivecomputations/dolphin-mistral-24b-venice-edition");
  const sealion = {
    ...env,
    SEALION_API_KEY: "p".repeat(24),
  };
  const heretic = await writeCanvasAgent(sealion, "写一段", "全能创作", [], fetchImpl, { ...tools, model: "heretic" });
  assert.equal(heretic.status, 200);
  assert.equal(calls[2].url, "https://open-sealion.aiaigirl.com/v1/chat/completions");
  assert.equal(calls[2].body.model, "gemma4-26b-a4b-ultra-heretic");
  assert.equal(calls[2].body.tools, undefined);
  assert.equal(calls[2].body.reasoning, undefined);
  assert.match(calls[2].agent || "", /Chrome/);
  assert.equal((await writeCanvasAgent(env, "写一段", "全能创作", [], fetchImpl, { ...tools, model: "heretic" })).status, 503);
  const glm = await writeCanvasAgent({ ...env, GLM_API_KEY: "g".repeat(24) }, "写一段", "全能创作", [], fetchImpl, { ...tools, model: "glm" });
  assert.equal(glm.status, 200);
  assert.equal(calls[3].url, "https://8888ai.cc.cd/v1/chat/completions");
  assert.equal(calls[3].body.model, "glm-5.2");
  assert.equal(calls[3].body.tools, undefined);
  assert.equal(calls[3].body.reasoning, undefined);
  assert.match(calls[3].agent || "", /Chrome/);
  assert.equal((await writeCanvasAgent({ ...env, GLM_BASE_URL: "https://evil.example/v1", GLM_API_KEY: "g".repeat(24) }, "写一段", "全能创作", [], fetchImpl, { ...tools, model: "glm" })).status, 503);
  assert.equal(calls.length, 4);
});
