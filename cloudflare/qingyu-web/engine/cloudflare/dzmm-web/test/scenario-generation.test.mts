import test from "node:test";
import assert from "node:assert/strict";
import { fetchRequest, type Env } from "../src/worker";
import { createXumengScenario, type XumengScenarioRoom } from "../../../src/lib/xumeng-scenarios";
import { scenarioGenerationPreparation } from "../../../src/lib/xumeng-scenario-handler";
import type { DzmmBillingFinalizeRpcInput, DzmmBillingReserveRpcInput } from "../../../src/lib/dzmm-generation-billing";
import { readDzmmProviderConfig } from "../../../src/lib/dzmm-chat";
const ORIGIN = "https://scenario.example.test", requestId = "12345678-1234-4321-8765-123456789abc";
function room(): XumengScenarioRoom { const snapshot=createXumengScenario(true); return {id:"room-1",code:"ABC123",title:snapshot.title,status:"active",version:2,stageIndex:1,memberCount:2,isHost:true,hostId:"owner",updatedAt:1,snapshot,members:[],events:[{id:"event-1",seq:1,userId:"p1",nickname:"玩家",roleId:"navigator",kind:"action",content:"检查灯塔测量记录。",stageIndex:1,createdAt:1}],hasOlderEvents:false}; }
function env(current: XumengScenarioRoom | null, status=200): Env { return {ASSETS:{fetch:async()=>new Response("SPA")}, BACKEND:{fetch:async request => new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url).pathname==="/v1/session" ? Response.json({user:{id:"owner",isGuest:false}}) : Response.json({accountId:"owner",room:current},{status})}, BILLING:{reserve:async()=>({enabled:false}),finalize:async()=>{throw new Error("billing disabled")}}, CHAT_RATE_LIMITER:{limit:async()=>({success:true})},DZMM_API_KEY:"private-isolated-key",DZMM_BASE_URL:"https://model.example/v1",DZMM_MODEL:"mock/model"}; }
function request(body: unknown={scenarioRoomId:"room-1",requestId},origin=ORIGIN) {return new Request(ORIGIN+"/api/dzmm/scenario",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json",Cookie:"dzmm_session=isolated"},body:JSON.stringify(body)});}
test("DM preparation uses current stage, actual events and host-only material without stale fixed opening",()=>{const value=scenarioGenerationPreparation(room())({},1);const text=value.plan.messages.map(m=>m.content).join("\n");assert.match(text,/检查灯塔测量记录/);assert.match(text,/旧灯塔/);assert.match(text,/主持笔记/);assert.equal(value.input.model,"grok");assert.equal(value.input.maxTokens,1200);});
test("server snapshot is streamed only for current host; default billing path reused",async()=>{let calls=0, sent="";const response=await fetchRequest(request(),env(room()),{providerFetch:async (_url,options)=>{calls++;sent=String(options?.body);return new Response(`data: ${JSON.stringify({choices:[{delta:{content:"灯塔的记录揭示一处新的暗礁。"}}]})}\n\ndata: [DONE]\n\n`,{headers:{"Content-Type":"text/event-stream"}});}});assert.equal(response.status,200);assert.match(await response.text(),/暗礁/);assert.match(sent,/检查灯塔测量记录/);assert.equal(response.headers.get("X-Xumeng-Request-Id"),requestId);assert.equal(calls,1);});
test("player, ended room and foreign origin never call provider",async()=>{let calls=0;const options={providerFetch:async()=>{calls++;throw new Error("denied");}};const player={...room(),isHost:false};assert.equal((await fetchRequest(request(),env(player),options)).status,403);assert.equal((await fetchRequest(request(),env({...room(),status:"ended"}),options)).status,409);assert.equal((await fetchRequest(request(undefined,"https://foreign.test"),env(room()),options)).status,403);assert.equal(calls,0);});
test("room private input, fake ID, redirect and unavailable backend are rejected before generation",async()=>{let calls=0;const options={providerFetch:async()=>{calls++;throw new Error("denied");}};for(const body of [{scenarioRoomId:"room-1",requestId,hostNotes:"injected"},{scenarioRoomId:"../other",requestId},{scenarioRoomId:"room-1",requestId:"bad"}]) assert.equal((await fetchRequest(request(body),env(room()),options)).status,400);for(const status of [401,404,302,503]) assert.equal((await fetchRequest(request(),env(null,status),options)).status,status===401||status===404?status:503);assert.equal(calls,0);});

const reservationId = "isolated-scenario-reservation", claimToken = "isolated-scenario-claim-0123456789";
function paidBinding() {
  const quotes: DzmmBillingReserveRpcInput[] = [], reserves: DzmmBillingReserveRpcInput[] = [];
  const finalizations: DzmmBillingFinalizeRpcInput[] = [], order: string[] = [];
  return { quotes, reserves, finalizations, order, service: {
    async quote(input: DzmmBillingReserveRpcInput) { quotes.push(input); order.push("quote"); return { enabled: true, maxOutputTokens: 512 }; },
    async reserve(input: DzmmBillingReserveRpcInput) { reserves.push(input); order.push("reserve"); return { enabled: true, created: true, receipt: { id: reservationId }, claimToken }; },
    async finalize(input: DzmmBillingFinalizeRpcInput) { finalizations.push(input); order.push("finalize"); return { receipt: { id: reservationId, status: input.hasValidOutput ? "settled" : "released" } }; },
  } };
}
function paidSse() {
  return new Response('data: {"id":"gen-isolated-scenario","choices":[{"delta":{"content":"灯塔记录与航海日志相互印证，主持人可以邀请玩家调查新的暗礁。"}}]}\n\n'
    + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":180,"completion_tokens":42,"completion_tokens_details":{"reasoning_tokens":9}}}\n\n'
    + 'data: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } });
}

test("scenario enabled billing rejects insufficient quote or reservation with 402 before any provider spend", async () => {
  for (const rejection of ["quote", "reserve"] as const) {
    const bill = paidBinding(), current = env(room()); let providers = 0;
    const insufficient = { error: { status: 402, message: "可用 Credit 不足本次预留。", code: "CREDIT_INSUFFICIENT" } };
    current.BILLING = { ...bill.service,
      async quote(input) { const quote = await bill.service.quote(input); return rejection === "quote" ? insufficient : quote; },
      async reserve(input) { const grant = await bill.service.reserve(input); return rejection === "reserve" ? insufficient : grant; },
    };
    const response = await fetchRequest(request(), current, { providerFetch: async () => { providers++; return paidSse(); } });
    assert.equal(response.status, 402);
    assert.equal((await response.json() as { code: string }).code, "CREDIT_INSUFFICIENT");
    assert.equal(bill.quotes.length, 1); assert.equal(bill.reserves.length, rejection === "quote" ? 0 : 1);
    assert.equal(bill.finalizations.length, 0); assert.equal(providers, 0);
    assert.equal(bill.quotes[0].accountId, "owner"); assert.equal(bill.quotes[0].requestId, requestId);
  }
});

test("scenario paid generation quotes and reserves the actual server preparation then settles actual usage once", async () => {
  const frozen = room(); frozen.snapshot.hostNotes = "隔离主持线索：日志页码与潮汐刻度相符。";
  const expected = scenarioGenerationPreparation(frozen)({}, 1), bill = paidBinding(), current = env(frozen);
  const waits: Promise<unknown>[] = []; current.BILLING = bill.service; let providers = 0;
  const selectedModel = readDzmmProviderConfig({ DZMM_MODEL: current.DZMM_MODEL, DZMM_BASE_URL: current.DZMM_BASE_URL, DZMM_API_KEY: current.DZMM_API_KEY }).models[expected.input.model];
  const response = await fetchRequest(request(), current, {
    waitUntil: promise => { waits.push(promise); },
    providerFetch: async (_url, init) => {
      providers++; bill.order.push("provider");
      const body = String(init?.body), parsed = JSON.parse(body) as { model: string; max_tokens: number; messages: { role: string; content: string }[]; reasoning: { effort: string } };
      assert.equal(bill.reserves.length, 1);
      assert.deepEqual(parsed.messages, expected.plan.messages);
      assert.equal(parsed.model, selectedModel);
      assert.match(parsed.messages[1].content, /检查灯塔测量记录/);
      assert.match(parsed.messages[1].content, /隔离主持线索/);
      assert.equal(parsed.max_tokens, 512); assert.equal(parsed.reasoning.effort, "low");
      assert.equal(bill.quotes[0].maxOutputTokens, 1200); assert.equal(bill.reserves[0].maxOutputTokens, 512);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))), byte => byte.toString(16).padStart(2, "0")).join("");
      assert.equal(bill.reserves[0].requestFingerprint, digest); assert.notEqual(bill.quotes[0].requestFingerprint, digest);
      const inputBytes = new TextEncoder().encode(JSON.stringify(expected.plan.messages)).byteLength + 1024 + expected.plan.messages.length * 64;
      assert.equal(bill.quotes[0].inputTokenUpperBound, inputBytes); assert.equal(bill.reserves[0].inputTokenUpperBound, inputBytes);
      assert.ok(!body.includes(claimToken) && !body.includes("dzmm_session"));
      return paidSse();
    },
  });
  assert.equal(response.status, 200); assert.match(await response.text(), /新的暗礁/); await Promise.all(waits);
  assert.equal(providers, 1); assert.deepEqual(bill.order, ["quote", "reserve", "provider", "finalize"]);
  assert.equal(bill.reserves[0].operation, "chat"); assert.equal(bill.reserves[0].model, selectedModel);
  assert.equal(bill.reserves[0].accountId, "owner"); assert.equal(bill.reserves[0].sessionToken, "isolated"); assert.equal(bill.reserves[0].requestId, requestId);
  assert.deepEqual(bill.finalizations, [{ reservationId, accountId: "owner", claimToken, outcome: "completed", hasValidOutput: true,
    generationId: "gen-isolated-scenario", usage: { promptTokens: 180, completionTokens: 42 } }]);
  assert.equal(response.headers.get("X-Xumeng-Request-Id"), requestId); assert.equal(response.headers.get("X-Xumeng-Max-Output-Tokens"), "512");
  assert.ok(!JSON.stringify([...response.headers]).includes(claimToken));
});

test("scenario upstream failure releases the enabled reservation without inventing valid output or usage", async () => {
  const bill = paidBinding(), current = env(room()), waits: Promise<unknown>[] = []; current.BILLING = bill.service;
  const response = await fetchRequest(request(), current, {
    waitUntil: promise => { waits.push(promise); },
    providerFetch: async () => { bill.order.push("provider"); throw new Error("private-provider-failure"); },
  });
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes("private-provider-failure")); await Promise.all(waits);
  assert.deepEqual(bill.order, ["quote", "reserve", "provider", "finalize"]);
  assert.deepEqual(bill.finalizations, [{ reservationId, accountId: "owner", claimToken, outcome: "failed", hasValidOutput: false }]);
});

test("scenario request interrupted after enabled reservation releases the hold exactly once", async () => {
  const bill = paidBinding(), current = env(room()), waits: Promise<unknown>[] = []; current.BILLING = bill.service;
  const abort = new AbortController(); let started!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const pending = fetchRequest(new Request(request(), { signal: abort.signal }), current, {
    waitUntil: promise => { waits.push(promise); },
    providerFetch: async () => { bill.order.push("provider"); started(); await gate; return paidSse(); },
  });
  await ready; assert.equal(bill.reserves.length, 1); abort.abort(); release();
  const response = await pending; assert.equal(response.status, 499); await response.text(); await Promise.all(waits);
  assert.deepEqual(bill.order, ["quote", "reserve", "provider", "finalize"]);
  assert.deepEqual(bill.finalizations, [{ reservationId, accountId: "owner", claimToken, outcome: "cancelled", hasValidOutput: false }]);
});
