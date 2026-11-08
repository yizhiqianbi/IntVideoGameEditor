import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { generateViduCharacterVoice } from "../src/vidu-character-voice";
const key = "isolated-test-key-not-real";
const mp3 = new Uint8Array([73,68,51,4,0,0,0,0,0,0,255,251,12,0]);
test("Vidu TTS uses exact voice ID, no clone/pitch trick and never forwards key to media download", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const upstream = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return calls.length === 1 ? Response.json({ task_id: "original-voice", state: "success", file_url: "https://scene.vidu.zone/media-asset/original.mp3", credits: 10, secret: key }) : new Response(mp3);
  }) as typeof fetch;
  const output = await generateViduCharacterVoice({ VIDU_API_KEY: key, VIDU_REGION: "global" }, { text: "海图已经整理好了。", voiceId: "female-yujie" }, upstream);
  assert.equal(calls[0].url, "https://api.vidu.com/ent/v2/audio-tts");
  assert.deepEqual(JSON.parse(calls[0].init!.body as string), { text: "海图已经整理好了。", voice_setting_voice_id: "female-yujie", voice_setting_speed: 1, voice_setting_pitch: 0 });
  assert.equal(new Headers(calls[0].init!.headers).get("Authorization"), `Token ${key}`);
  assert.equal(new Headers(calls[1].init!.headers).has("Authorization"), false);
  assert.equal(calls[1].init?.redirect, "manual");
  assert.deepEqual(new Uint8Array(output.bytes), mp3); assert.equal(output.providerCredits, 10); assert.equal(output.mimeType, "audio/mpeg");
  assert.equal(JSON.stringify(output).includes(key), false);
});
test("invalid voice, extra fields and missing config never invoke provider", async () => {
  let calls = 0; const upstream = (async () => { calls++; return new Response(); }) as typeof fetch;
  for (const input of [null, {}, { text: "你好", voiceId: "Katerina" }, { text: "你好", voiceId: "melotts" }, { text: "你好", voiceId: "female-yujie", apiKey: key }, { text: "字".repeat(801), voiceId: "female-yujie" }]) await assert.rejects(generateViduCharacterVoice({ VIDU_API_KEY: key }, input, upstream));
  await assert.rejects(generateViduCharacterVoice({}, { text: "你好", voiceId: "female-yujie" }, upstream)); assert.equal(calls, 0);
});
test("provider failures, invalid states, unsafe URLs, oversized or non-audio output are rejected with a safe message", async () => {
  for (const mutation of [{ state: "queueing" }, { state: "failed", error: key }, { credits: "10" }, { credits: -1 }, { task_id: "" },
    ...["http://scene.vidu.zone/a", "https://127.0.0.1/a", "https://localhost/a", "https://private.internal/a", "https://user:pass@scene.vidu.zone/a", "https://scene.vidu.zone:1234/a"].map(file_url => ({ file_url }))]) {
    let calls = 0;
    const upstream = (async () => { calls++; return Response.json({ state: "success", task_id: "a", credits: 10, file_url: "https://scene.vidu.zone/a", ...mutation }); }) as typeof fetch;
    await assert.rejects(generateViduCharacterVoice({ VIDU_API_KEY: key }, { text: "你好", voiceId: "female-yujie" }, upstream), /角色音色生成失败/); assert.equal(calls, 1);
  }
  for (const audio of [new Response("<html>failed</html>"), new Response(mp3, { headers: { "Content-Length": String(9 * 1024 * 1024) } }), new Response(null, { status: 302, headers: { Location: "https://other.example/a" } }), new Response("failed", { status: 502 })]) {
    let calls = 0; const upstream = (async () => ++calls === 1 ? Response.json({ state: "success", task_id: "a", credits: 10, file_url: "https://scene.vidu.zone/a" }) : audio) as typeof fetch;
    await assert.rejects(generateViduCharacterVoice({ VIDU_API_KEY: key }, { text: "你好", voiceId: "female-yujie" }, upstream), /角色音色生成失败/); assert.equal(calls, 2);
  }
});
test("real workerd named RPC keeps the provider key private and transports audio bytes", async () => {
  const bundle = await build({ entryPoints: [new URL("../src/vidu-voice-service.ts", import.meta.url).pathname], bundle: true, platform: "browser", format: "esm", external: ["cloudflare:workers"], write: false, target: "es2023" });
  let providerCalls = 0; const observed: unknown[] = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: "voice-service", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-10-02", bindings: { VIDU_API_KEY: key, VIDU_REGION: "global" }, outboundService: async request => {
      providerCalls++; observed.push({url:request.url,method:request.method,auth:request.headers.has("Authorization")});
      if (request.url.startsWith("https://api.vidu.com/")) { assert.equal(request.headers.get("Authorization"), `Token ${key}`); return Response.json({ task_id: "isolated-rpc-voice", state: "success", file_url: "https://scene.vidu.zone/a", credits: 10 }); }
      assert.equal(request.headers.has("Authorization"), false); return new Response(mp3);
    } },
    { name: "voice-caller", modules: true, script: `export default {async fetch(request,env){ if(new URL(request.url).pathname==='/private')return env.VOICE.fetch(request);if(new URL(request.url).pathname==='/configured')return Response.json({configured:await env.VOICE.configured()});const value=await env.VOICE.generate({text:'地图已经准备好了。',voiceId:'female-yujie'}); return new Response(value.bytes,{headers:{'Content-Type':value.mimeType}})}}`, compatibilityDate: "2026-10-02", serviceBindings: { VOICE: { name: "voice-service", entrypoint: "ViduVoiceService" } } },
  ] }));
  try {
    const caller = await mf.getWorker("voice-caller");
    assert.equal((await caller.fetch("https://caller/private")).status, 404);
    assert.deepEqual(await (await caller.fetch("https://caller/configured")).json(), { configured: true });
    const response = await caller.fetch("https://caller/generate"); assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), mp3); assert.equal(providerCalls, 2);
  } catch(error) { console.log(JSON.stringify({observed})); throw error; } finally { await mf.dispose(); }
});
