import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import voiceModule from "./xumeng-character-voice";
const { parseXumengCharacterVoiceAsset, parseXumengCharacterVoiceOverview, fingerprintXumengCharacterVoice, generateXumengCharacterVoice, fetchXumengCharacterVoice } = voiceModule as typeof import("./xumeng-character-voice");
const model = "@cf/myshell-ai/melotts";
const overview = { accountId: "account-1", vip: { active: true, expiresAt: 9_000, adminPreview: false, unlimited: false }, quotaUnlimited: false,
  enabled: true, model, limits: { audio: 20, maxVoiceChars: 800 }, usage: { audio: 3 } };
const asset = { id: "asset-1", name: "林舟", sourceKey: "novel:work-1:cast-1", sourceHash: "ab".repeat(32), model,
  url: "/api/backend/v1/character-voice/assets/asset-1", createdAt: 1_000, mimeType: "audio/wav", audioTextChars: 8, totalTextChars: 8 };
test("legacy reading metadata preserves private typed assets and canonical default voice", () => {
  assert.deepEqual(parseXumengCharacterVoiceOverview(overview, "account-1"), {...overview,speechVoices:["melotts"]});
  assert.deepEqual(parseXumengCharacterVoiceAsset(asset), {...asset,voiceId:"melotts"});
  assert.throws(() => parseXumengCharacterVoiceOverview(overview, "account-2"));
  for (const change of [{ quotaUnlimited: true }, { model: "Tina" }, { usage: { audio: -1 } }, { limits: { audio: 20, maxVoiceChars: 3000 } }])
    assert.throws(() => parseXumengCharacterVoiceOverview({ ...overview, ...change }, "account-1"));
  for (const change of [{ url: "https://foreign.test/private.wav" }, { url: `${asset.url}?token=secret` }, { mimeType: "text/html" }, { sourceHash: "wrong" }, { model: "Doubao" }, { audioTextChars: 801 }, { totalTextChars: 4 }])
    assert.throws(() => parseXumengCharacterVoiceAsset({ ...asset, ...change }));
});
test("speech directory and asset parsing reject unknown duplicate or inconsistent voice metadata", () => {
  assert.deepEqual(parseXumengCharacterVoiceOverview({...overview,speechVoices:["melotts","female-yujie"]},"account-1").speechVoices,["melotts","female-yujie"]);
  assert.deepEqual(parseXumengCharacterVoiceOverview({...overview,enabled:false},"account-1").speechVoices,[]);
  assert.equal(parseXumengCharacterVoiceAsset({...asset,model:"vidu-tts",voiceId:"female-yujie"}).voiceId,"female-yujie");
  for(const speechVoices of [["unknown"],["melotts","melotts"],[null],[],"melotts"])
    assert.throws(()=>parseXumengCharacterVoiceOverview({...overview,speechVoices},"account-1"));
  for(const change of [{model:"vidu-tts"},{model:"vidu-tts",voiceId:"melotts"},{voiceId:"female-yujie"},{model:"vidu-tts",voiceId:"unknown"},{voiceId:null}])
    assert.throws(()=>parseXumengCharacterVoiceAsset({...asset,...change}));
});
test("reading source fingerprint matches server SHA256 and changes with actor source name or text", async () => {
  const text = "夜色里，我等你。🌧️";
  const raw = JSON.stringify({ name: asset.name, sourceKey: asset.sourceKey, text, model });
  const hash = await fingerprintXumengCharacterVoice(asset.name, asset.sourceKey, text);
  assert.equal(hash, createHash("sha256").update(raw).digest("hex"));
  assert.notEqual(hash, await fingerprintXumengCharacterVoice("另一位", asset.sourceKey, text));
  assert.notEqual(hash, await fingerprintXumengCharacterVoice(asset.name, "character:other", text));
  assert.notEqual(hash, await fingerprintXumengCharacterVoice(asset.name, asset.sourceKey, `${text}。`));
  assert.equal(hash, await fingerprintXumengCharacterVoice(asset.name, asset.sourceKey, text,"melotts"));
  const styled=await fingerprintXumengCharacterVoice(asset.name,asset.sourceKey,text,"female-yujie");
  assert.equal(styled,createHash("sha256").update(JSON.stringify({name:asset.name,sourceKey:asset.sourceKey,text,model:"vidu-tts",voiceId:"female-yujie"})).digest("hex"));
  assert.notEqual(styled,hash);assert.notEqual(styled,await fingerprintXumengCharacterVoice(asset.name,asset.sourceKey,text,"female-shaonv"));
});
test("Vidu generation sends the selected voice and rejects a response bound to another voice", async () => {
  const original=globalThis.fetch,text="今天一起去看海。",voiceId="female-yujie";
  try {
    const sourceHash=await fingerprintXumengCharacterVoice(asset.name,asset.sourceKey,text,voiceId);
    globalThis.fetch=async(url,init)=>{
      assert.equal(url,"/api/backend/v1/character-voice/generate");
      assert.deepEqual(JSON.parse(init?.body as string),{accountId:"account-1",name:asset.name,sourceKey:asset.sourceKey,text,voiceId});
      return Response.json({accountId:"account-1",asset:{...asset,sourceHash,model:"vidu-tts",voiceId}});
    };
    assert.equal((await generateXumengCharacterVoice("account-1",asset.name,asset.sourceKey,text,undefined,voiceId)).voiceId,voiceId);
    globalThis.fetch=async()=>Response.json({accountId:"account-1",asset:{...asset,sourceHash,model:"vidu-tts",voiceId:"female-shaonv"}});
    await assert.rejects(generateXumengCharacterVoice("account-1",asset.name,asset.sourceKey,text,undefined,voiceId));
    let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(overview);};
    await assert.rejects(generateXumengCharacterVoice("account-1",asset.name,asset.sourceKey,text,undefined,"unknown" as never),{status:400});
    assert.equal(calls,0);
  } finally {globalThis.fetch=original;}
});
test("generation transport is same-origin and binds success to submitted name source and text", async () => {
  const original = globalThis.fetch, text = "今天一起去看海。";
  try {
    const sourceHash = await fingerprintXumengCharacterVoice(asset.name, asset.sourceKey, text);
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/backend/v1/character-voice/generate"); assert.equal(init?.credentials, "same-origin"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
      assert.deepEqual(JSON.parse(init?.body as string), { accountId: "account-1", name: asset.name, sourceKey: asset.sourceKey, text });
      return Response.json({ accountId: "account-1", asset: { ...asset, sourceHash } });
    };
    assert.equal((await generateXumengCharacterVoice("account-1", asset.name, asset.sourceKey, text)).sourceHash, sourceHash);
    globalThis.fetch = async () => Response.json({ accountId: "account-2", asset: { ...asset, sourceHash } });
    await assert.rejects(generateXumengCharacterVoice("account-1", asset.name, asset.sourceKey, text));
    globalThis.fetch = async () => Response.json({ accountId: "account-1", asset });
    await assert.rejects(generateXumengCharacterVoice("account-1", asset.name, asset.sourceKey, text));
  } finally { globalThis.fetch = original; }
});
test("account aborts prevent requests and HTTP failures expose only bounded public messages", async () => {
  const original = globalThis.fetch;
  try {
    const abort = new AbortController(); abort.abort();
    let calls = 0; globalThis.fetch = async () => { calls++; return Response.json(overview); };
    await assert.rejects(generateXumengCharacterVoice("account-1", asset.name, asset.sourceKey, "你好", abort.signal), { name: "AbortError" }); assert.equal(calls, 0);
    globalThis.fetch = async () => Response.json({ error: "今日语音额度已用完。", code: "voice_daily_quota" }, { status: 429 });
    await assert.rejects(fetchXumengCharacterVoice("account-1"), { status: 429, code: "voice_daily_quota", message: "今日语音额度已用完。" });
  } finally { globalThis.fetch = original; }
});
