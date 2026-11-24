import { getResident } from "./characters.mjs";
import { isSafeText } from "./safety.mjs";

export class InputError extends Error {}
const text = (value, max, label) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new InputError(`${label}需要填写，且不超过 ${max} 字。`);
  if (!isSafeText(value)) throw new InputError("请把居民设定写成适合全年龄的日常故事。");
  return value.trim();
};

export function validateCustomResident(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("居民资料格式有误。");
  if (!["cat", "dog"].includes(value.species)) throw new InputError("请选择猫猫或狗狗居民。");
  const name = text(value.name, 12, "名字");
  const job = text(value.job, 24, "职业");
  const personality = text(value.personality, 500, "性格与说话方式");
  const goal = text(value.goal, 200, "眼前的小目标");
  const opening = text(value.opening, 500, "第一次见面的开场");
  return {
    id: "custom", name, english: "NEIGHBOR", species: value.species, breed: value.species === "cat" ? "猫猫" : "狗狗", job,
    image: value.species === "cat" ? "/art/milo.webp" : "/art/sunny.webp", color: "#e1dfce",
    location: "尾语小镇", label: "你的原创居民", tags: ["原创居民", "日常故事"],
    line: goal, description: personality, personality,
    goal, opening, prompts: ["说说你今天的小计划吧", "有什么我可以帮忙的吗？", "我们出去散散步吧"],
  };
}

export function validateChatBody(body) {
  if (!body || typeof body !== "object") throw new InputError("请求格式有误。");
  const resident = body.residentId === "custom" ? validateCustomResident(body.customResident) : getResident(body.residentId);
  if (!resident) throw new InputError("没有找到这位居民。");
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 40) throw new InputError("一次最多携带 40 条对话，请开启新的故事。");
  const messages = body.messages.map((entry) => {
    if (!entry || !["user", "assistant"].includes(entry.role) || typeof entry.content !== "string" || !entry.content.trim() || entry.content.length > 2000) throw new InputError("消息应为 1–2000 字的文本。");
    return { role: entry.role, content: entry.content.trim() };
  });
  if (messages.at(-1).role !== "user") throw new InputError("最后一条消息应为你的发言。");
  return { resident, messages };
}

export async function readBody(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new InputError("请使用 JSON 提交。");
  if (Number(request.headers.get("content-length")) > 64000) throw new InputError("请求过大。");
  if (!request.body) throw new InputError("请求为空。");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64000) { await reader.cancel(); throw new InputError("请求过大。"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("请求格式有误。");
  } finally { reader.releaseLock(); }
}

export function checkOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const url = new URL(request.url);
  // Next may normalize Request.url to localhost while the browser uses 127.0.0.1.
  // Host is browser-controlled by the URL; never trust forwarded-host here.
  const host = request.headers.get("host") || url.host;
  let expected;
  try { expected = new URL(`${url.protocol}//${host}`).origin; }
  catch { throw new InputError("请求来源无效。"); }
  if (origin !== expected) throw new InputError("请从尾语页面发起请求。");
}
