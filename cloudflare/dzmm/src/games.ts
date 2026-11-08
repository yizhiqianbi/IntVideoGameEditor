import type { D1Database } from "@cloudflare/workers-types";
import { parseXumengGameDraft, parseXumengGameId, XUMENG_GAME_INLINE_BYTES, XUMENG_GAME_MAX_BODY_BYTES, xumengGameBytes, type XumengGame, type XumengGameDraft, type XumengGameDetail } from "../../../src/lib/xumeng-games";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

type Row = Record<string, unknown>;
const ROOT = "/v1/games";
function gameFromRow(row: Row): XumengGame {
  return { id: row.id as string, title: row.title as string, synopsis: row.synopsis as string, source: row.source as string,
    version: Number(row.version), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function select(db: D1Database, accountId: string, id: string) { return db.prepare("SELECT * FROM creator_games WHERE user_id=? AND id=?").bind(accountId, id); }
function missing(accountId: string) { return new ApiError(404, "游戏不存在或不属于当前账号。", { accountId }); }
function conflict(current: XumengGameDetail) { return new ApiError(409, "游戏已在其他页面更新。当前源码已保留，请导出备份、另存副本或加载云端版本。", { accountId: current.accountId, current }); }
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) throw new ApiError(400, "保存或删除游戏需要有效的版本号。");
  return value;
}
async function storedSource(env: Env, row: Row): Promise<string> {
  const key = typeof row.media_key === "string" ? row.media_key : "";
  if (!key) return String(row.source ?? "");
  if (!env.MEDIA) throw new ApiError(503, "较大的游戏需要文件存储，当前未启用。");
  const object = await env.MEDIA.get(key);
  if (!object) throw new ApiError(404, "游戏文件缺失。");
  return await object.text();
}
async function detailFromRow(env: Env, accountId: string, row: Row): Promise<XumengGameDetail> {
  return { accountId, game: { ...gameFromRow(row), source: await storedSource(env, row) } };
}
async function save(env: Env, accountId: string, draft: XumengGameDraft, expected?: number): Promise<XumengGameDetail> {
  const now = Date.now();
  const bytes = xumengGameBytes(draft.source);
  let mediaKey: string | null = null;
  let mediaBytes = 0;
  let stored = draft.source;
  if (bytes > XUMENG_GAME_INLINE_BYTES) {
    if (!env.MEDIA) throw new ApiError(503, "较大的游戏需要文件存储，当前未启用。");
    mediaKey = `creator-games/${encodeURIComponent(accountId)}/${encodeURIComponent(draft.id)}/${now}.html`;
    if (mediaKey.length > 512) throw new ApiError(400, "游戏编号无效。");
    await env.MEDIA.put(mediaKey, draft.source, { httpMetadata: { contentType: "text/html;charset=utf-8" } });
    stored = "";
    mediaBytes = bytes;
  }
  const previous = await select(env.DB, accountId, draft.id).first<Row>();
  let committed = false;
  try {
    const mutation = expected === undefined
      ? env.DB.prepare("INSERT INTO creator_games(user_id,id,title,synopsis,source,media_bytes,media_key,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?) ON CONFLICT(user_id,id) DO NOTHING")
        .bind(accountId, draft.id, draft.title, draft.synopsis, stored, mediaBytes, mediaKey, now, now)
      : env.DB.prepare("UPDATE creator_games SET title=?,synopsis=?,source=?,media_bytes=?,media_key=?,version=version+1,updated_at=? WHERE user_id=? AND id=? AND version=?")
        .bind(draft.title, draft.synopsis, stored, mediaBytes, mediaKey, now, accountId, draft.id, expected);
    const results = await env.DB.batch<Row>([mutation, select(env.DB, accountId, draft.id)]);
    const row = results[1].results[0];
    if (!row) throw missing(accountId);
    if (results[0].meta.changes !== 1) throw conflict(await detailFromRow(env, accountId, row));
    committed = true;
    const oldKey = typeof previous?.media_key === "string" ? previous.media_key : "";
    if (oldKey && oldKey !== mediaKey) await env.MEDIA?.delete(oldKey);
    return await detailFromRow(env, accountId, row);
  } catch (error) {
    if (!committed && mediaKey) await env.MEDIA?.delete(mediaKey);
    throw error;
  }
}
export async function handleGames(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== ROOT && !path.startsWith(`${ROOT}/`)) return null;
  try {
    if (user.isGuest) throw new ApiError(403, "请登录后保存私人游戏作品。");
    const route = /^\/v1\/games(?:\/([^/]+))?$/.exec(path);
    if (!route) throw missing(user.id);
    let id: string | undefined;
    if (route[1]) {
      try { id = parseXumengGameId(decodeURIComponent(route[1])); } catch { throw new ApiError(400, "游戏编号无效。"); }
    }
    if (request.method === "GET") {
      if (id) {
        const row = await select(env.DB, user.id, id).first<Row>();
        if (!row) throw missing(user.id);
        return json(await detailFromRow(env, user.id, row));
      }
      const { results } = await env.DB.prepare("SELECT id,title,synopsis,version,created_at,updated_at,CASE WHEN media_bytes > 0 THEN media_bytes ELSE length(CAST(source AS BLOB)) END AS source_bytes FROM creator_games WHERE user_id=? ORDER BY updated_at DESC,id").bind(user.id).all<Row>();
      return json({ accountId: user.id, games: results.map(row => ({ id: row.id, title: row.title, synopsis: row.synopsis, version: Number(row.version),
        createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), sourceBytes: Number(row.source_bytes) })) });
    }
    if ((request.method === "POST" && !id) || ((request.method === "PUT" || request.method === "DELETE") && id)) {
      const body = await readJson(request, XUMENG_GAME_MAX_BODY_BYTES);
      if (body.accountId !== user.id) throw new ApiError(401, "当前账号已改变，请重新加载作品。源码仍保留在原账号草稿中。");
      const keys = request.method === "DELETE" ? ["accountId", "version"] : request.method === "PUT" ? ["accountId", "version", "game"] : ["accountId", "game"];
      if (Object.keys(body).some(key => !keys.includes(key))) throw new ApiError(400, "游戏请求包含不支持的字段。");
      if (request.method === "DELETE") {
        const existing = await select(env.DB, user.id, id!).first<Row>();
        const results = await env.DB.batch<Row>([env.DB.prepare("DELETE FROM creator_games WHERE user_id=? AND id=? AND version=? RETURNING id").bind(user.id, id, version(body.version)), select(env.DB, user.id, id!)]);
        if (results[0].results.length !== 1) {
          const row = results[1].results[0];
          if (!row) throw missing(user.id);
          throw conflict(await detailFromRow(env, user.id, row));
        }
        const key = typeof existing?.media_key === "string" ? existing.media_key : "";
        if (key) await env.MEDIA?.delete(key);
        return json({ accountId: user.id, deleted: true });
      }
      let draft: XumengGameDraft;
      try { draft = parseXumengGameDraft(body.game); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "游戏内容无效。"); }
      if (id && id !== draft.id) throw new ApiError(400, "游戏编号与请求路径不一致。");
      return json(await save(env, user.id, draft, request.method === "PUT" ? version(body.version) : undefined), request.method === "POST" ? 201 : 200);
    }
    throw new ApiError(405, "此游戏接口不支持当前操作。");
  } catch (error) {
    if (error instanceof ApiError) throw new ApiError(error.status, error.message, { ...error.details, accountId: user.id });
    throw new ApiError(500, "游戏服务暂时不可用，当前源码仍保留。请导出备份后重试。", { accountId: user.id });
  }
}
