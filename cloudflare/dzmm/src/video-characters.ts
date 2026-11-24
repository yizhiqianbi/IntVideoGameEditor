import { rateLimit } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const DRAMA_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const CARD_FIELDS = ["name", "description", "personality", "scenario", "firstMessage", "tags"] as const;
const LIMITS = { name: 40, description: 4000, personality: 2000, scenario: 1200, firstMessage: 2000 };

export type VideoCharacterCard = {
  name: string; description: string; personality: string; scenario: string; firstMessage: string; tags: string[];
};
type Row = { drama_id: string; card_json: string; name: string; generated_by: string | null; created_at: number; updated_at: number };

function view(row: Row) {
  let card: unknown = null;
  try { card = JSON.parse(row.card_json); } catch { /* Corrupt rows are treated as absent. */ }
  if (!card) return null;
  return { dramaId: row.drama_id, card, name: row.name, official: true, createdAt: row.created_at, updatedAt: row.updated_at };
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function parseCard(raw: unknown): VideoCharacterCard {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "角色卡格式无效。");
  const value = raw as Record<string, unknown>;
  const name = clean(value.name, LIMITS.name);
  const description = clean(value.description, LIMITS.description);
  const firstMessage = clean(value.firstMessage, LIMITS.firstMessage);
  if (!name || !description || !firstMessage) throw new ApiError(400, "角色卡缺少必要字段。");
  return {
    name, description,
    personality: clean(value.personality, LIMITS.personality),
    scenario: clean(value.scenario, LIMITS.scenario),
    firstMessage,
    tags: Array.isArray(value.tags) ? value.tags.filter(tag => typeof tag === "string").slice(0, 6).map(tag => clean(tag, 24)).filter(Boolean) : [],
  };
}

/** Public read: one official, shared card per short drama. */
export async function publicVideoCharacter(request: Request, env: Env, dramaId: string): Promise<Response> {
  if (!DRAMA_ID.test(dramaId)) return json({ error: "短剧编号无效。" }, 400);
  const row = await env.DB.prepare("SELECT drama_id,card_json,name,generated_by,created_at,updated_at FROM video_characters WHERE drama_id=?")
    .bind(dramaId).first<Row>();
  if (!row) return json({ error: "这部短剧还没有官方角色卡。" }, 404);
  const result = view(row);
  if (!result) return json({ error: "官方角色卡暂时不可用。" }, 503);
  return json({ official: true, dramaId: row.drama_id, card: result.card, name: row.name, url: `https://xumengchat.top/#videos/${encodeURIComponent(row.drama_id)}` });
}

/** First successful generation wins; later viewers always get the same card. */
export async function handleVideoCharacters(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  if (path !== "/v1/video-characters") return null;
  if (request.method !== "POST") throw new ApiError(405, "仅支持 POST。");
  if (user.isGuest) throw new ApiError(403, "登录后才能生成官方角色卡。");
  await rateLimit(request, env, "video-character-save", 10, user.id);
  const body = await readJson(request, 32 * 1024);
  const dramaId = typeof body.dramaId === "string" ? body.dramaId.trim() : "";
  if (!DRAMA_ID.test(dramaId)) throw new ApiError(400, "短剧编号无效。");
  const card = parseCard(body.card);
  const now = Date.now();
  const existing = await env.DB.prepare("SELECT drama_id,card_json,name,generated_by,created_at,updated_at FROM video_characters WHERE drama_id=?")
    .bind(dramaId).first<Row>();
  if (existing) {
    const result = view(existing);
    if (result) return json({ official: true, dramaId, card: result.card, name: existing.name, created: false });
  }
  await env.DB.prepare(`INSERT INTO video_characters(drama_id,card_json,name,generated_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(drama_id) DO NOTHING`)
    .bind(dramaId, JSON.stringify(card), card.name, user.id, now, now).run();
  const row = await env.DB.prepare("SELECT drama_id,card_json,name,generated_by,created_at,updated_at FROM video_characters WHERE drama_id=?")
    .bind(dramaId).first<Row>();
  if (!row) throw new ApiError(503, "官方角色卡保存失败，请重试。");
  const result = view(row);
  if (!result) throw new ApiError(503, "官方角色卡保存异常，请重试。");
  return json({ official: true, dramaId, card: result.card, name: row.name, created: true }, 201);
}
