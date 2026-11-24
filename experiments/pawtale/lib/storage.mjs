import { RESIDENTS } from "./characters.mjs";
import { isSafeText } from "./safety.mjs";
import { validateCustomResident } from "./validation.mjs";

export const STORAGE_KEY = "pawtale.workspace.v1";
export function emptyWorkspace() { return { version: 1, favorites: [], conversations: {}, notes: [], customs: [] }; }
export function parseWorkspace(raw) {
  if (!raw) return emptyWorkspace();
  const value = JSON.parse(raw);
  if (value?.version !== 1) throw new Error("保存的数据版本无法读取。");
  const customs = [];
  for (const item of Array.isArray(value.customs) ? value.customs.slice(0, 30) : []) {
    try {
      if (typeof item.id !== "string" || !/^custom-[a-z0-9-]{1,60}$/i.test(item.id)) continue;
      customs.push({ ...validateCustomResident(item), id: item.id });
    } catch { /* Invalid saved cards do not enter the all-ages directory. */ }
  }
  const ids = new Set([...RESIDENTS, ...customs].map((r) => r.id));
  const favorites = Array.isArray(value.favorites) ? value.favorites.filter((id) => ids.has(id)) : [];
  const conversations = {};
  if (value.conversations && typeof value.conversations === "object") {
    for (const [id, conversation] of Object.entries(value.conversations)) {
      if (!ids.has(id) || !Array.isArray(conversation?.messages)) continue;
      const messages = conversation.messages.slice(-160).filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.length <= 5000 && isSafeText(m.content)).map((m) => ({ role: m.role, content: m.content }));
      if (messages.length) conversations[id] = { messages, updatedAt: Number.isFinite(conversation.updatedAt) ? conversation.updatedAt : 0, mode: ["demo", "model", "boundary"].includes(conversation.mode) ? conversation.mode : "demo" };
    }
  }
  const notes = Array.isArray(value.notes) ? value.notes.slice(0, 100).filter((n) => n && typeof n.id === "string" && typeof n.content === "string" && n.content.length <= 3000 && isSafeText(n.content)).map((n) => ({ id: n.id, content: n.content, createdAt: Number.isFinite(n.createdAt) ? n.createdAt : 0, source: typeof n.source === "string" && isSafeText(n.source) ? n.source.slice(0, 50) : "随手记" })) : [];
  return { version: 1, favorites, conversations, notes, customs };
}
