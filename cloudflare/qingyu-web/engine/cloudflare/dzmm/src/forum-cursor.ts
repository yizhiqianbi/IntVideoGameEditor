import { Buffer } from "node:buffer";
import { ApiError } from "./http";

export type ForumCursorScope = readonly ["topics", string, string, string, string] | readonly ["replies", string, string];
export type ForumCursorRow = { id: string; created_at: number };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function readForumCursor(url: URL, scope: ForumCursorScope, legacyOffset: number) {
  const value = url.searchParams.get("cursor");
  if (value === null) return { keyset: false, offset: legacyOffset, boundary: null };
  const invalid = () => new ApiError(400, "论坛分页位置无效，请重新打开列表。");
  if (legacyOffset !== 0 || url.searchParams.getAll("cursor").length !== 1) throw invalid();
  if (value === "") return { keyset: true, offset: 0, boundary: null };
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 5 || parsed[0] !== 1 || JSON.stringify(parsed[1]) !== JSON.stringify(scope)
      || !Number.isSafeInteger(parsed[2]) || parsed[2] < 0 || typeof parsed[3] !== "string" || !UUID.test(parsed[3])
      || !Number.isSafeInteger(parsed[4]) || parsed[4] < 0) throw invalid();
    return { keyset: true, offset: parsed[4] as number, boundary: { created_at: parsed[2] as number, id: parsed[3] } };
  } catch { throw invalid(); }
}

export function nextForumCursor(scope: ForumCursorScope, last: ForumCursorRow | undefined, consumed: number, hasMore: boolean) {
  return hasMore && last ? Buffer.from(JSON.stringify([1, scope, last.created_at, last.id, consumed])).toString("base64url") : null;
}
