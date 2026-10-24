import { Buffer } from "node:buffer";
import type { D1Database } from "@cloudflare/workers-types";
import { digest } from "./auth";
import { ApiError } from "./http";

type Tuple = { createdAt: number; id: string };
export type ChatMediaDirectoryRequest = { limit: number; after: Tuple | null; upper: Tuple | null };
export type ChatMediaDirectoryPage = {
  version: 1; limit: number; scannedRows: number; upper: Tuple | null; after: Tuple | null; nextCursor: string | null;
};
export type ChatMediaDirectoryRow = {
  id: string; user_id: string; conversation_id: string; message_id: string; kind: "audio" | "image";
  source_hash: string; status: "pending" | "ready" | "failed"; processing_token: string; object_key: string;
  mime_type: string | null; byte_length: number | null; audio_text_chars: number | null; total_text_chars: number | null;
  created_at: number; role: string; pending_expires_at: number | null;
};
const MAX_SOURCE_CHUNK_BYTES = 2 * 1024 * 1024;
const SOURCE_CHUNK_IDS = 40;
const ID = /^[A-Za-z0-9_-]{1,120}$/;
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 8_640_000_000_000_000;
const invalid = () => new ApiError(400, "请选择有效的素材目录分页。");
const tuple = (at: unknown, id: unknown): Tuple => {
  if (!timestamp(at) || typeof id !== "string" || !ID.test(id)) throw invalid();
  return { createdAt: at, id };
};
function compare(left: Tuple, right: Tuple): number {
  return left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
/** Explicit opt-in. An unpaged caller keeps the complete legacy response. */
export function parseChatMediaDirectoryRequest(query: URLSearchParams, accountId: string, conversationId: string): ChatMediaDirectoryRequest | null {
  const paginated = query.has("pagination");
  const allowed = paginated ? ["conversationId", "pagination", "limit", "cursor"] : ["conversationId"];
  if (Array.from(query.keys()).some(key => !allowed.includes(key))
    || allowed.some(key => query.getAll(key).length > 1)) throw invalid();
  if (!paginated) return null;
  if (query.get("pagination") !== "1") throw invalid();
  const rawLimit = query.get("limit") ?? "500";
  if (!/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > 500) throw invalid();
  const limit = Number(rawLimit), raw = query.get("cursor");
  if (raw === null) return { limit, after: null, upper: null };
  if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw invalid();
  let value: unknown;
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw invalid();
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch { throw invalid(); }
  if (!Array.isArray(value) || value.length !== 8 || value[0] !== 1 || value[1] !== accountId
    || value[2] !== conversationId || value[3] !== limit) throw invalid();
  const after = tuple(value[4], value[5]), upper = tuple(value[6], value[7]);
  if (compare(after, upper) >= 0) throw invalid();
  return { limit, after, upper };
}
function encode(accountId: string, conversationId: string, limit: number, after: Tuple, upper: Tuple): string {
  return Buffer.from(JSON.stringify([1, accountId, conversationId, limit, after.createdAt, after.id, upper.createdAt, upper.id]), "utf-8").toString("base64url");
}
const JOIN = `FROM chat_media_assets a JOIN messages m
  ON m.user_id=a.user_id AND m.conversation_id=a.conversation_id AND m.id=a.message_id
  LEFT JOIN chat_media_usage u ON u.id=a.processing_token AND u.user_id=a.user_id
    AND u.asset_id=a.id AND u.kind=a.kind AND u.status='pending'`;
const ELIGIBLE = `a.user_id=? AND a.conversation_id=?
  AND (a.status='ready' OR (a.status='pending' AND u.expires_at>?))`;

/** Metadata is paged first. Each consumed message body is read and hashed once, never repeated per old asset version. */
export async function readChatMediaDirectory(db: D1Database, accountId: string, conversationId: string, now: number,
  request: ChatMediaDirectoryRequest): Promise<{ matching: ChatMediaDirectoryRow[]; directory: ChatMediaDirectoryPage }> {
  let upper = request.upper;
  if (!upper) {
    const row = await db.prepare(`SELECT a.created_at AS createdAt,a.id AS id ${JOIN}
      WHERE ${ELIGIBLE} ORDER BY a.created_at DESC,a.id DESC LIMIT 1`)
      .bind(accountId, conversationId, now).first<{ createdAt: number; id: string }>();
    if (row) upper = tuple(row.createdAt, row.id);
  }
  if (!upper) return { matching: [], directory: { version: 1, limit: request.limit, scannedRows: 0, upper: null, after: null, nextCursor: null } };
  const afterClause = request.after ? " AND (a.created_at>? OR (a.created_at=? AND a.id>?))" : "";
  const bindings: (string | number)[] = [accountId, conversationId, now];
  if (request.after) bindings.push(request.after.createdAt, request.after.createdAt, request.after.id);
  bindings.push(upper.createdAt, upper.createdAt, upper.id, request.limit + 1);
  const rows = await db.prepare(`SELECT a.*,m.role,u.expires_at AS pending_expires_at ${JOIN}
    WHERE ${ELIGIBLE}${afterClause} AND (a.created_at<? OR (a.created_at=? AND a.id<=?))
    ORDER BY a.created_at,a.id LIMIT ?`).bind(...bindings).all<ChatMediaDirectoryRow>();
  const consumed = rows.results.slice(0, request.limit), hashes = new Map<string, string>();
  const messageIds = [...new Set(consumed.filter(row => row.role === "assistant").map(row => row.message_id))];
  for (let start = 0; start < messageIds.length; start += SOURCE_CHUNK_IDS) {
    const ids = messageIds.slice(start, start + SOURCE_CHUNK_IDS), placeholders = ids.map(() => "?").join(",");
    const where = `user_id=? AND conversation_id=? AND role='assistant' AND id IN (${placeholders})`;
    const sourceBindings = [accountId, conversationId, ...ids];
    const bound = await db.prepare(`SELECT COALESCE(SUM(length(CAST(content AS BLOB))),0) AS bytes FROM messages WHERE ${where}`)
      .bind(...sourceBindings).first<{ bytes: number }>();
    if (!bound || !Number.isSafeInteger(bound.bytes) || bound.bytes < 0) throw new ApiError(503, "会话素材目录暂时无法加载，请稍后重试。");
    if (bound.bytes > MAX_SOURCE_CHUNK_BYTES) throw new ApiError(413, "本页素材对应的消息正文过大，目录尚未加载；原素材保留，请稍后重新加载。");
    const source = await db.prepare(`SELECT id,role,content FROM messages WHERE ${where}`).bind(...sourceBindings)
      .all<{ id: string; role: string; content: string }>();
    let actualBytes = 0;
    for (const row of source.results) {
      if (typeof row.content !== "string") throw new ApiError(503, "会话素材目录暂时无法加载，请稍后重试。");
      actualBytes += new TextEncoder().encode(row.content).byteLength;
      if (actualBytes > MAX_SOURCE_CHUNK_BYTES) throw new ApiError(413, "本页素材对应的消息正文过大，目录尚未加载；原素材保留，请稍后重新加载。");
      if (row.role === "assistant") hashes.set(row.id, digest(row.content));
    }
  }
  const matching = consumed.filter(row => row.role === "assistant" && hashes.get(row.message_id) === row.source_hash);
  const last = consumed.at(-1), nextCursor = rows.results.length > request.limit && last
    ? encode(accountId, conversationId, request.limit, tuple(last.created_at, last.id), upper) : null;
  return { matching, directory: { version: 1, limit: request.limit, scannedRows: consumed.length, upper, after: request.after, nextCursor } };
}
