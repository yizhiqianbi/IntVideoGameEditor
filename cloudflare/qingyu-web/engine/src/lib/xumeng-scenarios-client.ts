"use client";
import { parseXumengScenarioDetail, parseXumengScenarioDraft, parseXumengScenarioId, parseXumengScenarioList, scenarioDraft, XUMENG_SCENARIO_MAX_BYTES, type XumengScenarioDetail, type XumengScenarioDraft, type XumengScenarioList, type XumengScenarioPreview, type XumengScenarioRoom, type XumengScenarioRoomDetail, type XumengScenarioRoomSummary } from "./xumeng-scenarios";
const API = "/api/backend/v1/scenarios";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export class XumengScenarioClientError extends Error { constructor(readonly status: number, message: string, readonly current?: XumengScenarioDetail) { super(message); this.name = "XumengScenarioClientError"; } }
async function request(accountId: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!accountId) throw new XumengScenarioClientError(401, "请先登录。");
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (serialized && new TextEncoder().encode(serialized).byteLength > XUMENG_SCENARIO_MAX_BYTES) throw new XumengScenarioClientError(413, "内容过大，当前草稿已保留。");
  let response: Response;
  try { response = await fetch(`${API}${path}`, { method, credentials: "same-origin", cache: "no-store", signal, ...(serialized === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: serialized }) }); }
  catch (error) { if (signal?.aborted) throw error; throw new XumengScenarioClientError(503, "团本服务无法连接，输入仍保留，请重试。"); }
  const value: unknown = await response.json().catch(() => null);
  if (object(value) && value.accountId !== undefined && value.accountId !== accountId) throw new XumengScenarioClientError(401, "账号已切换，请重新打开当前账号的团本。");
  if (!response.ok) {
    let current: XumengScenarioDetail | undefined; try { if (object(value) && value.current) current = parseXumengScenarioDetail(value.current, accountId); } catch { /* A recovery snapshot must match this account. */ }
    throw new XumengScenarioClientError(response.status, object(value) && typeof value.error === "string" ? value.error : "操作失败，输入仍保留，请刷新后重试。", current);
  }
  if (!object(value) || value.accountId !== accountId) throw new XumengScenarioClientError(502, "团本服务返回的账号无效。");
  return value;
}
export async function fetchXumengScenarios(accountId: string, signal?: AbortSignal): Promise<XumengScenarioList> { return parseXumengScenarioList(await request(accountId, "", "GET", undefined, signal), accountId); }
export async function fetchXumengScenario(accountId: string, id: string, signal?: AbortSignal): Promise<XumengScenarioDetail> {
  const detail = parseXumengScenarioDetail(await request(accountId, `/${encodeURIComponent(parseXumengScenarioId(id))}`, "GET", undefined, signal), accountId);
  if (detail.scenario.id !== id) throw new XumengScenarioClientError(502, "团本编号不一致。"); return detail;
}
export async function saveXumengScenario(accountId: string, scenario: XumengScenarioDraft, version: number | null, signal?: AbortSignal): Promise<XumengScenarioDetail> {
  const draft = parseXumengScenarioDraft(scenario); let detail: XumengScenarioDetail;
  try { detail = parseXumengScenarioDetail(await request(accountId, version === null ? "" : `/${encodeURIComponent(draft.id)}`, version === null ? "POST" : "PUT", { accountId, scenario: draft, ...(version === null ? {} : { version }) }, signal), accountId); }
  catch (error) {
    if (!(error instanceof XumengScenarioClientError) || error.status !== 409 || !error.current || signal?.aborted || JSON.stringify(scenarioDraft(error.current.scenario)) !== JSON.stringify(draft)) throw error;
    detail = error.current;
  }
  if (detail.scenario.id !== draft.id) throw new XumengScenarioClientError(502, "保存结果编号不一致，输入仍保留。"); return detail;
}
export async function deleteXumengScenario(accountId: string, id: string, version: number, signal?: AbortSignal): Promise<void> { const value = await request(accountId, `/${encodeURIComponent(id)}`, "DELETE", { accountId, version }, signal); if (value.deleted !== true) throw new XumengScenarioClientError(502, "删除结果无效，请刷新。"); }
function roomSummary(value: unknown): XumengScenarioRoomSummary {
  if (!object(value) || !["waiting", "active", "ended"].includes(value.status as string) || typeof value.title !== "string" || !/^[A-Za-z0-9_-]{20,32}$/.test(value.code as string) || typeof value.isHost !== "boolean") throw new Error("房间摘要无效。");
  for (const field of ["version", "stageIndex", "memberCount", "updatedAt"]) if (!Number.isSafeInteger(value[field]) || (value[field] as number) < (field === "version" ? 1 : 0)) throw new Error("房间状态无效。");
  return { id: parseXumengScenarioId(value.id), code: value.code as string, title: value.title, status: value.status as XumengScenarioRoomSummary["status"], version: value.version as number, stageIndex: value.stageIndex as number, memberCount: value.memberCount as number, isHost: value.isHost, updatedAt: value.updatedAt as number };
}
export function parseXumengScenarioRoomDetail(value: unknown, accountId: string): XumengScenarioRoomDetail {
  if (!object(value) || value.accountId !== accountId || !object(value.room)) throw new Error("房间返回账号无效。");
  const item = value.room, summary = roomSummary(item);
  if (!object(item.snapshot) || !Array.isArray(item.snapshot.roles) || !Array.isArray(item.members) || !Array.isArray(item.events) || item.events.length > 100 || typeof item.hasOlderEvents !== "boolean") throw new Error("房间返回格式无效。");
  const sanitized = parseXumengScenarioDraft({ ...item.snapshot, hostNotes: item.snapshot.hostNotes ?? "", dmPrompt: item.snapshot.dmPrompt ?? "", roles: item.snapshot.roles.map(role => { if (!object(role)) throw new Error("角色位无效。"); return { ...role, personality: role.personality ?? "" }; }) });
  if (!summary.isHost && (Object.hasOwn(item.snapshot, "hostNotes") || Object.hasOwn(item.snapshot, "dmPrompt") || item.snapshot.roles.some(role => object(role) && Object.hasOwn(role, "personality")))) throw new Error("玩家返回中出现主持资料，已停止显示。");
  const { hostNotes, dmPrompt, roles, ...publicSnapshot } = sanitized;
  const members = item.members.map(member => { if (!object(member) || typeof member.nickname !== "string" || typeof member.isHost !== "boolean" || (member.roleId !== null && typeof member.roleId !== "string")) throw new Error("参与者无效。"); return { userId: parseXumengScenarioId(member.userId), nickname: member.nickname, roleId: member.roleId as string | null, isHost: member.isHost }; });
  if (!members.some(member => member.userId === accountId)) throw new Error("你已不在这个房间。");
  const events = item.events.map(event => {
    if (!object(event) || typeof event.nickname !== "string" || typeof event.content !== "string" || !["speech", "action", "narration", "stage", "system"].includes(event.kind as string) || !Number.isSafeInteger(event.seq) || !Number.isSafeInteger(event.stageIndex) || !Number.isSafeInteger(event.createdAt) || (event.roleId !== null && typeof event.roleId !== "string")) throw new Error("房间记录无效。");
    return { id: parseXumengScenarioId(event.id), userId: parseXumengScenarioId(event.userId), seq: event.seq as number, nickname: event.nickname, roleId: event.roleId as string | null, kind: event.kind as XumengScenarioRoom["events"][number]["kind"], content: event.content, stageIndex: event.stageIndex as number, createdAt: event.createdAt as number };
  });
  return { accountId, room: { ...summary, hostId: parseXumengScenarioId(item.hostId), snapshot: { ...publicSnapshot, roles: roles.map(({ personality, ...role }) => ({ ...role, ...(summary.isHost ? { personality } : {}) })), ...(summary.isHost ? { hostNotes, dmPrompt } : {}) }, members, events, hasOlderEvents: item.hasOlderEvents } };
}
export async function fetchXumengScenarioRooms(accountId: string, signal?: AbortSignal): Promise<XumengScenarioRoomSummary[]> {
  const value = await request(accountId, "/rooms", "GET", undefined, signal); if (!Array.isArray(value.rooms) || value.rooms.length > 100) throw new Error("房间列表无效。"); return value.rooms.map(roomSummary);
}
export async function fetchXumengScenarioRoom(accountId: string, id: string, signal?: AbortSignal, beforeSeq?: number): Promise<XumengScenarioRoom> { return parseXumengScenarioRoomDetail(await request(accountId, `/rooms/${encodeURIComponent(id)}${beforeSeq === undefined ? "" : `?beforeSeq=${beforeSeq}`}`, "GET", undefined, signal), accountId).room; }
export async function fetchXumengScenarioPreview(accountId: string, code: string, signal?: AbortSignal): Promise<XumengScenarioPreview["preview"]> {
  const value = await request(accountId, `/rooms/code/${encodeURIComponent(code)}`, "GET", undefined, signal);
  if (!object(value.preview) || typeof value.preview.title !== "string" || typeof value.preview.synopsis !== "string" || value.preview.code !== code || !Array.isArray(value.preview.roles) || value.preview.roles.length > 8 || !["waiting", "active", "ended"].includes(value.preview.status as string) || !Number.isSafeInteger(value.preview.version)) throw new Error("邀请预览无效。");
  const roles = value.preview.roles.map(role => { if (!object(role) || typeof role.name !== "string" || typeof role.description !== "string" || typeof role.occupied !== "boolean" || Object.hasOwn(role, "personality")) throw new Error("邀请角色位无效。"); return { id: parseXumengScenarioId(role.id), name: role.name, description: role.description, personality: "", occupied: role.occupied }; });
  return { id: parseXumengScenarioId(value.preview.id), code, title: value.preview.title, synopsis: value.preview.synopsis, status: value.preview.status as XumengScenarioRoom["status"], version: value.preview.version as number, roles };
}
export async function createXumengScenarioRoom(accountId: string, scenarioId: string, version: number, roomId: string, signal?: AbortSignal): Promise<XumengScenarioRoom> { return parseXumengScenarioRoomDetail(await request(accountId, "/rooms", "POST", { accountId, scenarioId, version, roomId }, signal), accountId).room; }
export async function joinXumengScenarioRoom(accountId: string, code: string, roleId: string, version: number, signal?: AbortSignal): Promise<XumengScenarioRoom> { return parseXumengScenarioRoomDetail(await request(accountId, `/rooms/code/${encodeURIComponent(code)}/join`, "POST", { accountId, roleId, version }, signal), accountId).room; }
export async function mutateXumengScenarioRoom(accountId: string, id: string, action: "events" | "start" | "advance" | "end" | "leave", payload: { version: number; clientId?: string; kind?: "speech" | "action" | "narration"; content?: string }, signal?: AbortSignal): Promise<XumengScenarioRoom | null> {
  const value = await request(accountId, `/rooms/${encodeURIComponent(id)}/${action}`, "POST", { accountId, ...payload }, signal);
  if (action === "leave") { if (value.left !== true) throw new Error("离开结果无效。"); return null; }
  return parseXumengScenarioRoomDetail(value, accountId).room;
}
export async function generateXumengScenarioNarration(roomId: string, onDelta: (delta: string) => void, signal: AbortSignal): Promise<void> {
  const response = await fetch("/api/dzmm/scenario", { method: "POST", credentials: "same-origin", cache: "no-store", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenarioRoomId: roomId, requestId: crypto.randomUUID() }) });
  if (!response.ok) { const value: unknown = await response.json().catch(() => null); throw new Error(object(value) && typeof value.error === "string" ? value.error : "AI 叙事未完成，请重试。"); }
  if (!response.body || !response.headers.get("Content-Type")?.startsWith("text/plain")) throw new Error("AI 叙事返回格式无效。");
  const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0;
  try { for (;;) { signal.throwIfAborted(); const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 64000) throw new Error("AI 叙事过长，已停止，收到的草稿仍保留。"); onDelta(decoder.decode(chunk.value, { stream: true })); } const tail = decoder.decode(); if (tail) onDelta(tail); }
  catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
}
export type XumengScenarioRecovery = { draft: XumengScenarioDraft; version: number | null; updatedAt: number; key: string; raw: string };
export function writeScenarioRecovery(accountId: string, owner: string, draft: XumengScenarioDraft, version: number | null): XumengScenarioRecovery {
  const key = `qingyu-scenario-recovery:${encodeURIComponent(accountId)}:${owner}:${draft.id}`;
  const value = { accountId, draft, version, updatedAt: Date.now() }, raw = JSON.stringify(value); localStorage.setItem(key, raw); return { ...value, key, raw };
}
export function readScenarioRecoveries(accountId: string): XumengScenarioRecovery[] {
  const prefix = `qingyu-scenario-recovery:${encodeURIComponent(accountId)}:`, entries: XumengScenarioRecovery[] = [];
  for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index); if (!key?.startsWith(prefix)) continue; const raw = localStorage.getItem(key); if (!raw || raw.length > XUMENG_SCENARIO_MAX_BYTES) continue;
    try { const value: unknown = JSON.parse(raw); if (!object(value) || value.accountId !== accountId || !Number.isSafeInteger(value.updatedAt) || (value.version !== null && (!Number.isSafeInteger(value.version) || (value.version as number) < 1))) continue; entries.push({ draft: parseXumengScenarioDraft(value.draft), version: value.version as number | null, updatedAt: value.updatedAt as number, key, raw }); } catch { /* Other or invalid drafts are not shown. */ }
  }
  return entries.sort((left, right) => right.updatedAt - left.updatedAt);
}
export function clearScenarioRecovery(entry: XumengScenarioRecovery, accountId: string, owner: string): void { if (entry.key === `qingyu-scenario-recovery:${encodeURIComponent(accountId)}:${owner}:${entry.draft.id}` && localStorage.getItem(entry.key) === entry.raw) localStorage.removeItem(entry.key); }
