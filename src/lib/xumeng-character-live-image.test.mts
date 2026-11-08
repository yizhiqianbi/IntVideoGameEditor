import assert from "node:assert/strict";
import { test } from "node:test";
import liveModule from "./xumeng-live-client.ts";
const { readXumengCharacterLiveImage, XUMENG_LIVE_IMAGE_BYTES } = liveModule as typeof import("./xumeng-live-client.ts");
async function browserTest(run: () => Promise<void>, decode: () => Promise<void> = async () => {}) {
  const previous = { window: globalThis.window, fetch: globalThis.fetch, Image: globalThis.Image, FileReader: globalThis.FileReader };
  Object.assign(globalThis, { window: { location: { origin: "https://xumeng.test" } }, Image: class { width=256; height=256; src=""; decode=decode; }, FileReader: class { result="data:image/png;base64,YQ=="; onload?:()=>void; readAsDataURL(){queueMicrotask(()=>this.onload?.());} } });
  try { await run(); } finally { Object.assign(globalThis, previous); }
}
test("owned covers use same-origin cookies; external HTTPS images omit credentials", () => browserTest(async () => {
  const requests: { url:string; credentials: unknown; redirect:unknown }[] = [];
  globalThis.fetch = async (url, options) => { requests.push({url:String(url), credentials:options?.credentials, redirect:options?.redirect});return new Response(new Uint8Array([1]),{headers:{"Content-Type":"image/png"}}); };
  assert.match(await readXumengCharacterLiveImage("/api/backend/v1/media/owned"),/^data:image\/png/);
  await readXumengCharacterLiveImage("https://images.example.test/portrait.png");
  assert.deepEqual(requests.map(x=>x.credentials),["same-origin","omit"]); assert.ok(requests.every(x=>x.redirect==="error"));
}));
test("unsafe schemes and embedded credentials are rejected before fetching", () => browserTest(async () => {
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error("should not fetch");};
  for (const url of ["javascript:alert(1)", "http://other.test/a.png", "https://name:secret@example.test/a.png"]) await assert.rejects(readXumengCharacterLiveImage(url));
  assert.equal(calls,0);
}));
test("unsupported covers and oversized downloads never become live avatars", () => browserTest(async () => {
  globalThis.fetch=async()=>new Response("<svg/>",{headers:{"Content-Type":"image/svg+xml"}});
  await assert.rejects(readXumengCharacterLiveImage("/placeholder.svg"),/不适合直播/);
  let cancelled=false;globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(XUMENG_LIVE_IMAGE_BYTES+1));},cancel(){cancelled=true;}}),{headers:{"Content-Type":"image/png"}});
  await assert.rejects(readXumengCharacterLiveImage("/too-large.png"),/超过 5 MB/);assert.equal(cancelled,true);
}));
test("account cancellation also unlocks a stalled image decoder", () => browserTest(async () => {
  globalThis.fetch=async()=>new Response(new Uint8Array([1]),{headers:{"Content-Type":"image/png"}});
  const abort = new AbortController();const request = readXumengCharacterLiveImage("/avatar.png",abort.signal);
  setTimeout(()=>abort.abort(),10);await assert.rejects(request,/已取消/);
},()=>new Promise<void>(()=>{})));
