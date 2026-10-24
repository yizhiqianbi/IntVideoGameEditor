"use client";

import { parseXumengGameDetail, parseXumengGameDraft, parseXumengGameId, parseXumengGameList, XUMENG_GAME_MAX_BODY_BYTES, xumengGameBytes, xumengGameDraftFromDetail,
  type XumengGameDetail, type XumengGameDraft, type XumengGameList } from "./xumeng-games";

const API = "/api/backend/v1/games";
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export class XumengGameClientError extends Error {
  constructor(readonly status: number, message: string, readonly current?: XumengGameDetail) { super(message); this.name = "XumengGameClientError"; }
}
async function request(accountId: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!accountId) throw new XumengGameClientError(401, "请先登录，再保存私人游戏。");
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (serialized && xumengGameBytes(serialized) > XUMENG_GAME_MAX_BODY_BYTES) throw new XumengGameClientError(413, "游戏请求过大，源码已保留。请导出备份后减少内容。");
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
    throw new XumengGameClientError(503, "无法连接游戏服务，源码已保留。请导出备份后重试。");
  } finally { clearTimeout(deadline); signal?.removeEventListener("abort", abort); }
  if (!response.ok) {
    if (object(value) && value.accountId !== undefined && value.accountId !== accountId) throw new XumengGameClientError(401, "账号已切换，请重新加载。原账号草稿仍保留。");
    let current: XumengGameDetail | undefined;
    try { if (object(value) && value.current) current = parseXumengGameDetail(value.current, accountId); } catch { /* A mismatched response never becomes recovery data. */ }
    throw new XumengGameClientError(response.status, object(value) && typeof value.error === "string" ? value.error : "游戏请求失败，当前源码已保留。", current);
  }
  if (!object(value) || value.accountId !== accountId) throw new XumengGameClientError(401, "返回结果属于其他账号，请重新加载。原账号草稿仍保留。");
  return value;
}
export async function fetchXumengGames(accountId: string, signal?: AbortSignal): Promise<XumengGameList> {
  return parseXumengGameList(await request(accountId, "", "GET", undefined, signal), accountId);
}
export async function fetchXumengGame(accountId: string, gameId: string, signal?: AbortSignal): Promise<XumengGameDetail> {
  parseXumengGameId(gameId);
  const detail = parseXumengGameDetail(await request(accountId, `/${encodeURIComponent(gameId)}`, "GET", undefined, signal), accountId);
  if (detail.game.id !== gameId) throw new XumengGameClientError(502, "返回的游戏编号无效，未覆盖当前草稿。");
  return detail;
}
export async function saveXumengGame(accountId: string, draft: XumengGameDraft, version: number | null, signal?: AbortSignal): Promise<XumengGameDetail> {
  const game = parseXumengGameDraft(draft);
  if (version !== null && (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER)) throw new XumengGameClientError(400, "游戏版本无效，当前源码已保留。");
  let detail: XumengGameDetail;
  try {
    detail = parseXumengGameDetail(await request(accountId, version === null ? "" : `/${encodeURIComponent(game.id)}`, version === null ? "POST" : "PUT",
      { accountId, game, ...(version === null ? {} : { version }) }, signal), accountId);
  } catch (failure) {
    // A committed save may lose its response. Only an exact authenticated
    // snapshot can acknowledge that same save; changed drafts remain conflicts.
    if (!(failure instanceof XumengGameClientError) || failure.status !== 409 || !failure.current || signal?.aborted
      || failure.current.game.id !== game.id || (version !== null && failure.current.game.version <= version)
      || JSON.stringify(xumengGameDraftFromDetail(failure.current)) !== JSON.stringify(game)) throw failure;
    detail = failure.current;
  }
  if (detail.game.id !== game.id) throw new XumengGameClientError(502, "保存结果的游戏编号无效，当前源码已保留。");
  if (JSON.stringify(xumengGameDraftFromDetail(detail)) !== JSON.stringify(game)) throw new XumengGameClientError(502, "保存回执的源码与本次提交不一致，当前编辑器已保留。请刷新核对或导出备份。");
  return detail;
}
export async function deleteXumengGame(accountId: string, gameId: string, version: number, signal?: AbortSignal): Promise<void> {
  parseXumengGameId(gameId);
  const result = await request(accountId, `/${encodeURIComponent(gameId)}`, "DELETE", { accountId, version }, signal);
  if (!object(result) || result.deleted !== true) throw new XumengGameClientError(502, "删除结果未确认，请刷新作品列表后核对。");
}
