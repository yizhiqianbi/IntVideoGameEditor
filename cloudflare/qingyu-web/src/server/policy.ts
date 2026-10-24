import reviewPolicy from "../../engine/companion-native/plugins/xumeng_media/review-policy.json";
import { hasBlockedContent, ALL_AGES_POLICY } from "../../engine/src/lib/qingyu-content-policy";
export interface ModerationEnv { MODERATION_BASE_URL?:string; MODERATION_API_KEY?:string; MODERATION_MODEL?:string; COMPANION_MEDIA_REVIEW_SECRET?:string; MODERATION_PROTOCOL?: "moderations" | "chat-completions" }
import { ContentError } from "../../engine/src/lib/qingyu-content-error";
export { ContentError } from "../../engine/src/lib/qingyu-content-error";
export const reviewReady = (env:ModerationEnv) => Boolean(env.MODERATION_BASE_URL && env.MODERATION_API_KEY && env.MODERATION_MODEL);
/** Only human-authored text goes to semantic review, never opaque IDs or secrets. */
export function contentText(value: unknown): string {
  const parts: string[] = [];
  function visit(v: unknown, key = "") {
    if (typeof v === "string") {
      if (/^(?:password|token|secret|apiKey|accessToken|refreshToken|sessionToken|signature|hash|sha256|cover|coverUrl|avatar|avatarUrl|imageUrl|url|id|[a-z]+Id|createdAt|updatedAt|timestamp|base64|b64Json|version|baseVersion|baseUpdatedAt|type|kind|status|model|locale|clockMode|confirmation|operation)$/i.test(key)) return;
      if (/^data:/i.test(v) && /^(?:image|audio|file|attachment|data)$/i.test(key)) return;
      if (v.trim()) parts.push(v);
    } else if (Array.isArray(v)) v.forEach(item => visit(item, key));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, item]) => visit(item, k));
  }
  visit(value);
  return parts.join("\n");
}
export function checkLocalContent(value: unknown): void {
  if (hasBlockedContent(contentText(value))) throw new ContentError(422, "晴屿只支持全年龄内容，请调整这段文字后重试。");
}
const REVIEW_POLICY = reviewPolicy.system;
const reviewSchema = reviewPolicy.responseFormat;
const reviewModelOptions:Record<string,unknown> = reviewPolicy.modelOptions;
function reviewInput(input: unknown): unknown {
  // Keep image content parts intact for a vision-capable review model.
  if (Array.isArray(input) && input.every(part => part && typeof part === "object" &&
    ["text", "image_url"].includes(String((part as Record<string, unknown>).type)))) {
    return [{ type: "text", text: "将下列所有图片与文字合并审核，最终只返回一个 JSON 对象，不返回数组：" }, ...input];
  }
  return typeof input === "string" ? JSON.stringify({content:input}) : JSON.stringify(input);
}
async function uncachedReview(input:unknown,env:ModerationEnv,fetcher:typeof fetch) {
  if (!reviewReady(env)) throw new ContentError(503,"内容检查服务尚未连接，暂时无法生成或公开发布。私人创作仍可保存。");
  const chat = env.MODERATION_PROTOCOL === "chat-completions";
  if (env.MODERATION_PROTOCOL && !["moderations", "chat-completions"].includes(env.MODERATION_PROTOCOL)) {
    throw new ContentError(503,"内容检查配置无效。");
  }
  const url = new URL(`${env.MODERATION_BASE_URL!.replace(/\/+$/, "")}/${chat ? "chat/completions" : "moderations"}`);
  if (url.protocol !== "https:" || url.username || url.password) throw new ContentError(503,"内容检查配置无效。");
  const body = chat ? {
    model: env.MODERATION_MODEL, stream: false, temperature: 0, max_tokens: 256,
    provider: { require_parameters: true },
    ...(reviewModelOptions[env.MODERATION_MODEL!] as Record<string,unknown> ?? {}),
    messages: [{ role: "system", content: REVIEW_POLICY }, { role: "user", content: reviewInput(input) }],
    response_format: reviewSchema,
  } : { model: env.MODERATION_MODEL, input };
  let data:any;
  try {
    const response = await fetcher(url, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.MODERATION_API_KEY}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) { console.warn("qingyu_review_upstream", { status: response.status }); throw new Error("upstream-status"); }
    const text = await response.text();
    if (text.length > 65536) throw new Error();
    data = JSON.parse(text);
  } catch (error) {
    console.warn("qingyu_review_unavailable", { name: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message.replaceAll(env.MODERATION_API_KEY!, "[redacted]").slice(0, 200) : "unknown" });
    throw new ContentError(503,"内容检查暂时不可用，未放行这次内容。");
  }
  if (chat) {
    let result: any;
    try {
      if (data.choices?.length !== 1 || data.choices[0].finish_reason !== "stop" || data.choices[0].message?.refusal) throw new Error();
      result = JSON.parse(data.choices[0].message.content);
      if (!result || Object.keys(result).some(key => !["decision", "categories"].includes(key)) ||
          !["allowed", "blocked", "uncertain"].includes(result.decision) ||
          !Array.isArray(result.categories) || result.categories.some((c: unknown) => typeof c !== "string" || !c.trim())) throw new Error();
    } catch {throw new ContentError(503,"内容检查结果无效，未放行这次内容。");}
    if (result.decision === "uncertain") throw new ContentError(503,"暂时无法确认内容适合全年龄，请调整后重试。");
    if (result.decision !== "allowed" || result.categories.length) throw new ContentError(422,"这段内容不适合晴屿，请换一个全年龄的话题。");
    return;
  }
  if(!Array.isArray(data?.results)||!data.results.length||data.results.some((r:any)=>typeof r?.flagged!=="boolean"))throw new ContentError(503,"内容检查结果无效，未放行这次内容。");
  if(data.results.some((r:any)=>r.flagged||Object.values(r.categories??{}).some(v=>v===true)))throw new ContentError(422,"这段内容不适合晴屿，请换一个全年龄的话题。");
}
const approvedReviews = new Map<string, { promise: Promise<void>; expires: number }>();
function mutableImage(input: unknown): boolean {
  if (Array.isArray(input)) return input.some(mutableImage);
  if (input && typeof input === "object") {
    const part = input as Record<string, any>;
    if (part.type === "image_url" && typeof part.image_url?.url === "string" && !part.image_url.url.startsWith("data:")) return true;
    return Object.values(part).some(mutableImage);
  }
  return false;
}
export async function reviewContent(input: unknown, env: ModerationEnv, fetcher: typeof fetch = fetch): Promise<void> {
  // Transcript polling must not buy the same review every second. Only exact
  // immutable input under the same policy/provider credentials shares approval.
  if (fetcher !== fetch || !reviewReady(env) || mutableImage(input)) return uncachedReview(input, env, fetcher);
  const bytes = new TextEncoder().encode(JSON.stringify([reviewPolicy, env.MODERATION_BASE_URL, env.MODERATION_MODEL, env.MODERATION_PROTOCOL, env.MODERATION_API_KEY, input]));
  const key = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const prior = approvedReviews.get(key);
  if (prior && prior.expires > Date.now()) return prior.promise;
  const entry = { promise: uncachedReview(input, env, fetcher), expires: Date.now() + 300_000 };
  if (approvedReviews.size >= 256) approvedReviews.delete(approvedReviews.keys().next().value!);
  approvedReviews.set(key, entry);
  try { await entry.promise; }
  catch (error) { if (approvedReviews.get(key) === entry) approvedReviews.delete(key); throw error; }
}
export function moderatedProviderFetch(env:ModerationEnv,fetcher:typeof fetch=fetch):typeof fetch {
  return (async(input:RequestInfo|URL,init?:RequestInit)=>{
    let body:any;try{body=JSON.parse(String(init?.body??"{}"));}catch{throw new ContentError(400,"生成请求格式无效。");}
    const messages=Array.isArray(body.messages)?body.messages:[];
    checkLocalContent(messages.filter((m:any)=>m.role!=="system"));
    await reviewContent(messages.map((m:any)=>String(m.content??"")).join("\n"),env,fetcher);
    body.messages=[{role:"system",content:ALL_AGES_POLICY},...messages];
    // Buffer the provider protocol before handing it to the established chat
    // parser, retaining SSE usage/world-state events and the billing lifecycle.
    const upstream=await fetcher(input,{...init,body:JSON.stringify(body)});
    if(!upstream.ok)return upstream;
    const reader=upstream.body?.getReader(); if(!reader)throw new ContentError(503,"生成服务没有返回正文。");
    let size=0;const chunks:Uint8Array[]=[];
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000){await reader.cancel();throw new ContentError(503,"生成结果过大。");}chunks.push(value);}
    const bytes=new Uint8Array(size);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.byteLength;}
    const text=new TextDecoder().decode(bytes);let prose="";
    if(upstream.headers.get("Content-Type")?.includes("text/event-stream")) {
      for(const line of text.split(/\r?\n/)) { if(!line.startsWith("data:"))continue;const json=line.slice(5).trim();if(!json||json==="[DONE]")continue;try{const d=JSON.parse(json);prose+=d.choices?.[0]?.delta?.content??d.choices?.[0]?.message?.content??"";}catch{/* provider parser handles malformed events */} }
    } else {try{prose=JSON.parse(text).choices?.[0]?.message?.content??"";}catch{throw new ContentError(503,"生成结果格式无效。");}}
    if(!prose.trim())throw new ContentError(503,"没有收到可检查的生成正文。");
    checkLocalContent(prose);await reviewContent(prose,env,fetcher);
    return new Response(bytes,{status:upstream.status,headers:upstream.headers});
  }) as typeof fetch;
}
