"use client";

import { parseFolioGameDetail, parseFolioGameDraft, parseFolioGameId, parseFolioGameList, FOLIO_GAME_MAX_BODY_BYTES, folioGameBytes, folioGameDraftFromDetail,
  type FolioGameDetail, type FolioGameDraft, type FolioGameList } from "./folio-games";

const API = "/api/backend/v1/games";
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export class FolioGameClientError extends Error {
  constructor(readonly status: number, message: string, readonly current?: FolioGameDetail) { super(message); this.name = "FolioGameClientError"; }
}
async function request(accountId: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!accountId) throw new FolioGameClientError(401, "请先登录，再保存私人游戏。");
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (serialized && folioGameBytes(serialized) > FOLIO_GAME_MAX_BODY_BYTES) throw new FolioGameClientError(413, "游戏请求过大，源码已保留。请导出备份后减少内容。");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(abort, 120_000);
  let response: Response, value: unknown;
  try {
    response = await fetch(`${API}${path}`, { method, credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: serialized === undefined ? undefined : { "Content-Type": "application/json" }, body: serialized });
    value = await response.json();
  }
  catch (failure) {
    if (signal?.aborted) throw failure;
    throw new FolioGameClientError(503, "无法连接游戏服务，源码已保留。请导出备份后重试。");
  } finally { clearTimeout(deadline); signal?.removeEventListener("abort", abort); }
  if (!response.ok) {
    if (object(value) && value.accountId !== undefined && value.accountId !== accountId) throw new FolioGameClientError(401, "账号已切换，请重新加载。原账号草稿仍保留。");
    let current: FolioGameDetail | undefined;
    try { if (object(value) && value.current) current = parseFolioGameDetail(value.current, accountId); } catch { /* A mismatched response never becomes recovery data. */ }
    throw new FolioGameClientError(response.status, object(value) && typeof value.error === "string" ? value.error : "游戏请求失败，当前源码已保留。", current);
  }
  if (!object(value) || value.accountId !== accountId) throw new FolioGameClientError(401, "返回结果属于其他账号，请重新加载。原账号草稿仍保留。");
  return value;
}
export async function fetchFolioGames(accountId: string, signal?: AbortSignal): Promise<FolioGameList> {
  return parseFolioGameList(await request(accountId, "", "GET", undefined, signal), accountId);
}
export async function fetchFolioGame(accountId: string, gameId: string, signal?: AbortSignal): Promise<FolioGameDetail> {
  parseFolioGameId(gameId);
  const detail = parseFolioGameDetail(await request(accountId, `/${encodeURIComponent(gameId)}`, "GET", undefined, signal), accountId);
  if (detail.game.id !== gameId) throw new FolioGameClientError(502, "返回的游戏编号无效，未覆盖当前草稿。");
  return detail;
}
export async function saveFolioGame(accountId: string, draft: FolioGameDraft, version: number | null, signal?: AbortSignal): Promise<FolioGameDetail> {
  const game = parseFolioGameDraft(draft);
  if (version !== null && (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER)) throw new FolioGameClientError(400, "游戏版本无效，当前源码已保留。");
  let detail: FolioGameDetail;
  try {
    detail = parseFolioGameDetail(await request(accountId, version === null ? "" : `/${encodeURIComponent(game.id)}`, version === null ? "POST" : "PUT",
      { accountId, game, ...(version === null ? {} : { version }) }, signal), accountId);
  } catch (failure) {
    // A committed save may lose its response. Only an exact authenticated
    // snapshot can acknowledge that same save; changed drafts remain conflicts.
    if (!(failure instanceof FolioGameClientError) || failure.status !== 409 || !failure.current || signal?.aborted
      || failure.current.game.id !== game.id || (version !== null && failure.current.game.version <= version)
      || JSON.stringify(folioGameDraftFromDetail(failure.current)) !== JSON.stringify(game)) throw failure;
    detail = failure.current;
  }
  if (detail.game.id !== game.id) throw new FolioGameClientError(502, "保存结果的游戏编号无效，当前源码已保留。");
  if (JSON.stringify(folioGameDraftFromDetail(detail)) !== JSON.stringify(game)) throw new FolioGameClientError(502, "保存回执的源码与本次提交不一致，当前编辑器已保留。请刷新核对或导出备份。");
  return detail;
}
export async function deleteFolioGame(accountId: string, gameId: string, version: number, signal?: AbortSignal): Promise<void> {
  parseFolioGameId(gameId);
  const result = await request(accountId, `/${encodeURIComponent(gameId)}`, "DELETE", { accountId, version }, signal);
  if (!object(result) || result.deleted !== true) throw new FolioGameClientError(502, "删除结果未确认，请刷新作品列表后核对。");
}
