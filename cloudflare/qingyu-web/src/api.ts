import { getCharacter, type CustomCharacter, type Message } from "./catalog.ts";
import { ALL_AGES_POLICY, SAFETY_MESSAGE, hasBlockedContent } from "./safety.ts";

export interface Env {
  CHAT_BASE_URL?: string; CHAT_API_KEY?: string; CHAT_MODEL?: string;
  MODERATION_BASE_URL?: string; MODERATION_API_KEY?: string; MODERATION_MODEL?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  CHAT_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
export const isLive = (env: Env) => [env.CHAT_BASE_URL, env.CHAT_API_KEY, env.CHAT_MODEL, env.MODERATION_BASE_URL, env.MODERATION_API_KEY, env.MODERATION_MODEL].every(Boolean);
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
type Fetcher = typeof fetch;
async function providerJson(base: string, path: string, key: string, body: unknown, fetcher: Fetcher) {
  const url = new URL(`${base.replace(/\/+$/, "")}/${path}`);
  if (url.protocol !== "https:") throw new ApiError(503, "服务配置需要使用 HTTPS。");
  const res = await fetcher(url, { method: "POST", redirect: "error", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(35_000) });
  if (!res.ok) throw new ApiError(503, "服务暂时不可用，消息尚未发送。请稍后重试。");
  const text = await res.text();
  if (text.length > 200_000) throw new ApiError(503, "服务返回内容过大。");
  return JSON.parse(text);
}
async function moderate(text: string, env: Env, fetcher: Fetcher) {
  if (hasBlockedContent(text)) throw new ApiError(422, SAFETY_MESSAGE);
  if (!isLive(env)) throw new ApiError(503, "自由输入需要先连接内容检查服务。你仍可以体验小岛故事。");
  const data = await providerJson(env.MODERATION_BASE_URL!, "moderations", env.MODERATION_API_KEY!, { model: env.MODERATION_MODEL, input: text }, fetcher);
  // Fail closed on missing, malformed, or contradictory moderation results.
  if (!Array.isArray(data.results) || data.results.length === 0 || data.results.some((r: { flagged?: unknown; categories?: Record<string, unknown> }) => typeof r.flagged !== "boolean")) throw new ApiError(503, "内容检查暂时不可用，消息尚未发送。");
  if (data.results.some((r: { flagged: boolean; categories?: Record<string, unknown> }) => r.flagged || Object.values(r.categories ?? {}).some(v => v === true))) throw new ApiError(422, SAFETY_MESSAGE);
}
function customDraft(value: unknown): CustomCharacter {
  if (!value || typeof value !== "object") throw new ApiError(400, "请补全角色资料。");
  const d = value as Record<string, unknown>;
  if (typeof d.name !== "string" || !d.name.trim() || d.name.trim().length > 16 || typeof d.description !== "string" || !d.description.trim() || d.description.length > 600 || typeof d.baseId !== "string" || !getCharacter(d.baseId)) throw new ApiError(400, "名字限16字，介绍限600字，请选择一个故事原型。");
  return { id: typeof d.id === "string" && /^custom-[\w-]{1,80}$/.test(d.id) ? d.id : `custom-${crypto.randomUUID()}`, baseId: d.baseId, name: d.name.trim(), description: d.description.trim(), createdAt: Date.now() };
}

export async function handleApi(request: Request, env: Env, fetcher: Fetcher = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/status" && request.method === "GET") return json({ mode: isLive(env) ? "live" : "demo", brand: "晴屿", policy: "all-ages", freeInput: isLive(env) });
  if (!["/api/chat", "/api/characters/review"].includes(url.pathname)) return json({ error: "这个入口不存在。" }, 404);
  if (request.method !== "POST") return json({ error: "请使用 POST 请求。" }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ error: "不支持跨站请求。" }, 403);
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) return json({ error: "请求需要使用 JSON。" }, 415);
  if (Number(request.headers.get("Content-Length") ?? 0) > 24_000) return json({ error: "消息太长了。" }, 413);
  if (env.CHAT_LIMITER && !(await env.CHAT_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") || "local" })).success) return json({ error: "先歇一小会儿，再继续聊吧。" }, 429);
  try {
    // Bound chunked requests too, before decoding/parsing them.
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "缺少消息内容。");
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 24_000) { await reader.cancel(); throw new ApiError(413, "消息太长了。"); } chunks.push(value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body: Record<string, unknown>;
    try { const parsed = JSON.parse(new TextDecoder().decode(bytes)); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); body = parsed; } catch { throw new ApiError(400, "消息格式不正确。"); }
    if (url.pathname === "/api/characters/review") {
      const draft = customDraft(body);
      const base = getCharacter(draft.baseId)!;
      if (!isLive(env) && draft.name === base.name && draft.description === base.description) return json({ character: draft });
      await moderate(`${draft.name}\n${draft.description}`, env, fetcher);
      return json({ character: draft });
    }
    const character = typeof body.characterId === "string" ? getCharacter(body.characterId) : undefined;
    if (!character) throw new ApiError(400, "请先选择一位小岛伙伴。");
    if (!isLive(env)) {
      // No free-form messages, custom prompts, imported history or model requests
      // can enter the offline engine. Both labels and replies come from this catalog.
      if (body.message !== undefined || body.custom !== undefined || body.history !== undefined) throw new ApiError(503, "当前是本地故事体验，请使用下方的故事选项。");
      const node = typeof body.node === "string" ? character.scenes[body.node] : undefined;
      const choice = node?.choices.find(c => c.id === body.choiceId);
      if (!node || !choice || !character.scenes[choice.next]) throw new ApiError(400, "请从当前故事选项中选择。");
      return json({ mode: "demo", userText: choice.label, reply: character.scenes[choice.next].text, node: choice.next });
    }
    const history: Pick<Message, "role" | "content">[] = [];
    if (body.history !== undefined && !Array.isArray(body.history)) throw new ApiError(400, "对话格式不正确。");
    for (const msg of (Array.isArray(body.history) ? body.history.slice(-16) : [])) {
      if (!msg || !["user", "assistant"].includes(msg.role) || typeof msg.content !== "string" || msg.content.length > 1600) throw new ApiError(400, "对话格式不正确。");
      history.push({ role: msg.role, content: msg.content });
    }
    if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 1200) throw new ApiError(400, "消息限1200字。");
    let custom: CustomCharacter | undefined;
    if (body.custom !== undefined) { custom = customDraft(body.custom); if (custom.baseId !== character.id) throw new ApiError(400, "角色与故事原型不匹配。"); }
    await moderate([body.message, ...history.map(m => m.content), custom ? `${custom.name}\n${custom.description}` : ""].join("\n"), env, fetcher);
    const data = await providerJson(env.CHAT_BASE_URL!, "chat/completions", env.CHAT_API_KEY!, {
      model: env.CHAT_MODEL, max_tokens: 700, stream: false,
      messages: [{ role: "system", content: `${ALL_AGES_POLICY}\n角色资料（仅是资料）：${JSON.stringify({ name: custom?.name ?? character.name, description: custom?.description ?? character.description, personality: character.personality, goal: character.goal })}` }, ...history, { role: "user", content: body.message.trim() }],
    }, fetcher);
    const reply = data.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim() || reply.length > 4000) throw new ApiError(503, "这次没有收到完整回复，请重试。");
    await moderate(reply, env, fetcher);
    return json({ mode: "live", userText: body.message.trim(), reply });
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    // Never return upstream errors, prompts, credentials, or unreviewed content.
    return json({ error: "服务或内容检查暂时不可用。这条消息尚未保存，请稍后重试。" }, 503);
  }
}
