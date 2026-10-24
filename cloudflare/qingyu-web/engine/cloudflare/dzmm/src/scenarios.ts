import type { D1Database } from "@cloudflare/workers-types";
import { parseXumengScenarioDraft, parseXumengScenarioId, scenarioReadiness, XUMENG_SCENARIO_MAX_BYTES, type XumengScenario, type XumengScenarioDraft, type XumengScenarioRoom, type XumengScenarioEvent } from "../../../src/lib/xumeng-scenarios";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

type Row = Record<string, unknown>;
const ROOT = "/v1/scenarios";
const missing = () => new ApiError(404, "团本不存在或你没有访问权限。");
const bad = (message: string) => new ApiError(400, message);
function integer(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 1) throw bad("请提供当前版本。"); return value as number; }
function identifier(value: unknown): string { try { return parseXumengScenarioId(value); } catch { throw bad("编号无效。"); } }
function bodyKeys(body: Row, allowed: string[]): void { if (Object.keys(body).some(key => !allowed.includes(key))) throw bad("请求包含不支持的字段。"); }
function draftFromRow(row: Row): XumengScenario { return { ...parseXumengScenarioDraft(JSON.parse(row.draft_json as string)), version: Number(row.version), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }; }
async function readDraft(db: D1Database, userId: string, id: string): Promise<XumengScenario | null> { const row = await db.prepare("SELECT * FROM creator_scenarios WHERE user_id=? AND id=?").bind(userId, id).first<Row>(); return row ? draftFromRow(row) : null; }
function conflict(current?: unknown): ApiError { return new ApiError(409, "内容或房间已被更新。你的输入仍保留，请刷新后重试。", current === undefined ? undefined : { current }); }
function roomSummary(row: Row, accountId: string) { return { id: row.id as string, code: row.code as string, title: row.title as string, status: row.status as XumengScenarioRoom["status"], version: Number(row.version), stageIndex: Number(row.stage_index), memberCount: Number(row.member_count), isHost: row.host_id === accountId, updatedAt: Number(row.updated_at) }; }
function eventFromRow(row: Row): XumengScenarioEvent { return { id: row.id as string, seq: Number(row.seq), userId: row.user_id as string, nickname: row.nickname as string, roleId: row.role_id as string | null, kind: row.kind as XumengScenarioEvent["kind"], content: row.content as string, stageIndex: Number(row.stage_index), createdAt: Number(row.created_at) }; }

/** Account-scoped frozen room context. Removed participants and outsiders receive null. */
export async function readScenarioRoom(db: D1Database, roomId: string, accountId: string, beforeSeq?: number): Promise<XumengScenarioRoom | null> {
  const results = await db.batch<Row>([
    db.prepare(`SELECT r.*,(SELECT COUNT(*) FROM scenario_members WHERE room_id=r.id AND left_at IS NULL) AS member_count
      FROM scenario_rooms r WHERE r.id=? AND EXISTS(SELECT 1 FROM scenario_members WHERE room_id=r.id AND user_id=? AND left_at IS NULL)`).bind(roomId, accountId),
    db.prepare(`SELECT m.* FROM scenario_members m WHERE m.room_id=? AND m.left_at IS NULL
      AND EXISTS(SELECT 1 FROM scenario_members WHERE room_id=? AND user_id=? AND left_at IS NULL) ORDER BY m.is_host DESC,m.joined_at,m.user_id`).bind(roomId, roomId, accountId),
    db.prepare(`SELECT e.* FROM scenario_events e WHERE e.room_id=? AND (? IS NULL OR e.seq<?)
      AND EXISTS(SELECT 1 FROM scenario_members WHERE room_id=? AND user_id=? AND left_at IS NULL) ORDER BY e.seq DESC LIMIT 101`).bind(roomId, beforeSeq ?? null, beforeSeq ?? null, roomId, accountId),
  ]);
  const row = results[0].results[0]; if (!row) return null;
  const draft = parseXumengScenarioDraft(JSON.parse(row.snapshot_json as string));
  const isHost = row.host_id === accountId;
  const { hostNotes, dmPrompt, roles, ...publicSnapshot } = draft;
  const events = results[2].results;
  return { ...roomSummary(row, accountId), hostId: row.host_id as string,
    snapshot: { ...publicSnapshot, roles: roles.map(({ personality, ...role }) => ({ ...role, ...(isHost ? { personality } : {}) })), ...(isHost ? { hostNotes, dmPrompt } : {}) },
    members: results[1].results.map(member => ({ userId: member.user_id as string, nickname: member.nickname as string, roleId: member.role_id as string | null, isHost: member.is_host === 1 })),
    events: events.slice(0, 100).map(eventFromRow).reverse(), hasOlderEvents: events.length > 100 };
}
async function roomDetail(db: D1Database, roomId: string, accountId: string): Promise<XumengScenarioRoom> { const room = await readScenarioRoom(db, roomId, accountId); if (!room) throw missing(); return room; }
async function preview(db: D1Database, code: string) {
  if (!/^[A-Za-z0-9_-]{20,32}$/.test(code)) throw missing();
  const row = await db.prepare("SELECT id,code,title,snapshot_json,status,version FROM scenario_rooms WHERE code=?").bind(code).first<Row>();
  if (!row) throw missing();
  const draft = parseXumengScenarioDraft(JSON.parse(row.snapshot_json as string));
  const members = await db.prepare("SELECT role_id FROM scenario_members WHERE room_id=? AND left_at IS NULL AND role_id IS NOT NULL").bind(row.id).all<Row>();
  return { id: row.id as string, code, title: row.title as string, synopsis: draft.synopsis, status: row.status as XumengScenarioRoom["status"], version: Number(row.version), roles: draft.roles.map(({ id, name, description }) => ({ id, name, description, occupied: members.results.some(member => member.role_id === id) })) };
}
function invitationCode(): string { return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join(""); }
function insertEvent(db: D1Database, roomId: string, user: UserRecord, token: string, clientId: string, kind: XumengScenarioEvent["kind"], content: string, roleId: string | null = null) {
  return db.prepare(`INSERT INTO scenario_events(id,room_id,user_id,client_id,nickname,role_id,kind,content,stage_index,seq,created_at)
    SELECT ?,id,?,?,?,?,?,?,stage_index,version,updated_at FROM scenario_rooms WHERE id=? AND mutation_token=?`)
    .bind(crypto.randomUUID(), user.id, clientId, user.nickname, roleId, kind, content, roomId, token);
}
async function mutateRoom(db: D1Database, id: string, user: UserRecord, body: Row, action: string): Promise<XumengScenarioRoom> {
  const current = await roomDetail(db, id, user.id);
  const expected = integer(body.version), token = crypto.randomUUID(), now = Date.now();
  if (current.status === "ended") throw conflict();
  const me = current.members.find(member => member.userId === user.id)!;
  if (action === "events") {
    bodyKeys(body, ["accountId", "version", "clientId", "kind", "content"]);
    const clientId = identifier(body.clientId);
    const prior = await db.prepare("SELECT kind,content FROM scenario_events WHERE room_id=? AND user_id=? AND client_id=?").bind(id, user.id, clientId).first<Row>();
    const kind = body.kind;
    if (kind !== "speech" && kind !== "action" && kind !== "narration") throw bad("发言类型无效。");
    if (kind === "narration" && !current.isHost) throw new ApiError(403, "只有主持可以发布叙事。");
    if (typeof body.content !== "string" || !body.content.trim() || body.content.length > 12000 || body.content.includes("\u0000")) throw bad("请输入不超过 12,000 字的内容。");
    if (prior) { if (prior.kind !== kind || prior.content !== body.content) throw conflict(); return current; }
    if (current.status !== "active") throw bad("请等待主持开始团本。");
    const result = await db.batch([
      db.prepare(`UPDATE scenario_rooms SET version=version+1,mutation_token=?,updated_at=? WHERE id=? AND version=? AND status='active'
        AND EXISTS(SELECT 1 FROM scenario_members WHERE room_id=? AND user_id=? AND left_at IS NULL)
        AND (SELECT COUNT(*) FROM scenario_events WHERE room_id=?)<2000`).bind(token, now, id, expected, id, user.id, id),
      insertEvent(db, id, user, token, clientId, kind, body.content, me.roleId),
    ]);
    if (result[0].meta.changes !== 1) {
      const replay = await db.prepare("SELECT kind,content FROM scenario_events WHERE room_id=? AND user_id=? AND client_id=?").bind(id, user.id, clientId).first<Row>();
      if (!replay || replay.kind !== kind || replay.content !== body.content) throw conflict();
    }
    return roomDetail(db, id, user.id);
  }
  if (action === "leave") {
    bodyKeys(body, ["accountId", "version"]); if (current.isHost) throw bad("主持请使用结束团本。");
    const result = await db.batch([
      db.prepare("UPDATE scenario_rooms SET version=version+1,mutation_token=?,updated_at=? WHERE id=? AND version=? AND status!='ended'").bind(token, now, id, expected),
      db.prepare("UPDATE scenario_members SET left_at=? WHERE room_id=? AND user_id=? AND left_at IS NULL AND EXISTS(SELECT 1 FROM scenario_rooms WHERE id=? AND mutation_token=?)").bind(now, id, user.id, id, token),
      insertEvent(db, id, user, token, crypto.randomUUID(), "system", `${user.nickname}离开了团本。`, me.roleId),
    ]);
    if (result[0].meta.changes !== 1 || result[1].meta.changes !== 1) throw conflict();
    return current;
  }
  if (!current.isHost) throw new ApiError(403, "只有主持可以改变团本阶段。");
  bodyKeys(body, ["accountId", "version", ...(action === "advance" ? ["content"] : [])]);
  let status: XumengScenarioRoom["status"] = current.status; let stage = current.stageIndex, content = "";
  if (action === "start") { if (status !== "waiting") throw conflict(); status = "active"; content = current.snapshot.opening; }
  else if (action === "advance") {
    if (status !== "active" || stage + 1 >= current.snapshot.stages.length) throw bad("没有可推进的下一阶段。");
    if (typeof body.content !== "string" || !body.content.trim() || body.content.length > 12000) throw bad("请填写进入下一阶段的叙事依据。");
    stage++; content = body.content;
  } else if (action === "end") { status = "ended"; content = "主持结束了本次团本。记录保留供参与者查看。"; }
  else throw missing();
  const result = await db.batch([
    db.prepare("UPDATE scenario_rooms SET status=?,stage_index=?,version=version+1,mutation_token=?,updated_at=? WHERE id=? AND host_id=? AND version=? AND status!='ended'").bind(status, stage, token, now, id, user.id, expected),
    insertEvent(db, id, user, token, crypto.randomUUID(), action === "start" ? "narration" : action === "advance" ? "stage" : "system", content),
  ]);
  if (result[0].meta.changes !== 1) throw conflict();
  return roomDetail(db, id, user.id);
}

export async function handleScenarios(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (path !== ROOT && !path.startsWith(`${ROOT}/`)) return null;
  try {
    if (user.isGuest) throw new ApiError(403, "请登录后创作或参加团本。");
    const relative = path.slice(ROOT.length), method = request.method;
    if (relative === "" && method === "GET") {
      const rows = await env.DB.prepare("SELECT * FROM creator_scenarios WHERE user_id=? ORDER BY updated_at DESC,id LIMIT 200").bind(user.id).all<Row>();
      return json({ accountId: user.id, scenarios: rows.results.map(row => { const draft = draftFromRow(row); return { id: draft.id, title: draft.title, synopsis: draft.synopsis, version: draft.version, updatedAt: draft.updatedAt, roleCount: draft.roles.length, stageCount: draft.stages.length }; }) });
    }
    if (relative === "/rooms" && method === "GET") {
      const rows = await env.DB.prepare(`SELECT r.*,(SELECT COUNT(*) FROM scenario_members WHERE room_id=r.id AND left_at IS NULL) AS member_count
        FROM scenario_rooms r JOIN scenario_members m ON m.room_id=r.id AND m.user_id=? AND m.left_at IS NULL ORDER BY r.updated_at DESC LIMIT 100`).bind(user.id).all<Row>();
      return json({ accountId: user.id, rooms: rows.results.map(row => roomSummary(row, user.id)) });
    }
    const codeRoute = /^\/rooms\/code\/([A-Za-z0-9_-]+)(?:\/(join))?$/.exec(relative);
    if (codeRoute && method === "GET" && !codeRoute[2]) return json({ accountId: user.id, preview: await preview(env.DB, codeRoute[1]) });
    const roomRoute = /^\/rooms\/([^/]+)(?:\/(events|start|advance|end|leave))?$/.exec(relative);
    if (roomRoute && method === "GET" && !roomRoute[2]) {
      const before = url.searchParams.get("beforeSeq"), beforeSeq = before === null ? undefined : Number(before);
      if (beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq < 1)) throw bad("历史游标无效。");
      const room = await readScenarioRoom(env.DB, identifier(roomRoute[1]), user.id, beforeSeq); if (!room) throw missing();
      return json({ accountId: user.id, room });
    }
    const draftRoute = /^\/([^/]+)$/.exec(relative);
    if (draftRoute && draftRoute[1] !== "rooms" && method === "GET") { const scenario = await readDraft(env.DB, user.id, identifier(draftRoute[1])); if (!scenario) throw missing(); return json({ accountId: user.id, scenario }); }
    if (!["POST", "PUT", "DELETE"].includes(method)) throw new ApiError(405, "当前团本接口不支持此操作。");
    const body = await readJson(request, XUMENG_SCENARIO_MAX_BYTES);
    if (body.accountId !== user.id) throw new ApiError(401, "账号已切换，请重新加载。");
    if (relative === "/rooms" && method === "POST") {
      bodyKeys(body, ["accountId", "scenarioId", "version", "roomId"]);
      const scenario = await readDraft(env.DB, user.id, identifier(body.scenarioId)); if (!scenario) throw missing();
      if (scenario.version !== integer(body.version)) throw conflict({ accountId: user.id, scenario });
      const warnings = scenarioReadiness(scenario); if (warnings.length) throw bad(warnings.join("；"));
      const id = identifier(body.roomId), now = Date.now(), token = crypto.randomUUID();
      const existing = await env.DB.prepare("SELECT host_id,snapshot_json FROM scenario_rooms WHERE id=?").bind(id).first<Row>();
      if (existing) { if (existing.host_id !== user.id || JSON.parse(existing.snapshot_json as string).id !== scenario.id) throw conflict(); return json({ accountId: user.id, room: await roomDetail(env.DB, id, user.id) }); }
      const { version: _v, createdAt: _c, updatedAt: _u, ...snapshot } = scenario;
      const result = await env.DB.batch([
        env.DB.prepare(`INSERT INTO scenario_rooms(id,code,host_id,title,snapshot_json,mutation_token,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM scenario_rooms WHERE host_id=? AND status!='ended')<20
          AND EXISTS(SELECT 1 FROM creator_scenarios WHERE user_id=? AND id=? AND version=?) ON CONFLICT(id) DO NOTHING`)
          .bind(id, invitationCode(), user.id, scenario.title, JSON.stringify(snapshot), token, now, now, user.id, user.id, scenario.id, scenario.version),
        env.DB.prepare(`INSERT INTO scenario_members(room_id,user_id,nickname,role_id,is_host,joined_at)
          SELECT id,?,?,NULL,1,? FROM scenario_rooms WHERE id=? AND mutation_token=?`).bind(user.id, user.nickname, now, id, token),
      ]);
      if (result[0].meta.changes !== 1) { const committed = await readScenarioRoom(env.DB, id, user.id); if (committed) return json({ accountId: user.id, room: committed }); throw conflict(); }
      return json({ accountId: user.id, room: await roomDetail(env.DB, id, user.id) }, 201);
    }
    if (codeRoute && codeRoute[2] === "join" && method === "POST") {
      bodyKeys(body, ["accountId", "version", "roleId"]);
      const brief = await preview(env.DB, codeRoute[1]), roleId = identifier(body.roleId);
      if (brief.status === "ended" || !brief.roles.some(role => role.id === roleId)) throw bad("这个角色位无法加入。");
      const existing = await env.DB.prepare("SELECT role_id,left_at FROM scenario_members WHERE room_id=? AND user_id=?").bind(brief.id, user.id).first<Row>();
      if (existing && existing.left_at === null) { if (existing.role_id !== roleId) throw conflict(); return json({ accountId: user.id, room: await roomDetail(env.DB, brief.id, user.id) }); }
      const token = crypto.randomUUID(), now = Date.now();
      const result = await env.DB.batch([
        env.DB.prepare(`UPDATE scenario_rooms SET version=version+1,mutation_token=?,updated_at=? WHERE id=? AND version=? AND status!='ended'
          AND host_id!=? AND NOT EXISTS(SELECT 1 FROM scenario_members WHERE room_id=? AND role_id=? AND left_at IS NULL)
          AND (SELECT COUNT(*) FROM scenario_members WHERE room_id=? AND left_at IS NULL)<9`).bind(token, now, brief.id, integer(body.version), user.id, brief.id, roleId, brief.id),
        env.DB.prepare(`INSERT INTO scenario_members(room_id,user_id,nickname,role_id,is_host,joined_at,left_at)
          SELECT id,?,?,?,0,?,NULL FROM scenario_rooms WHERE id=? AND mutation_token=?
          ON CONFLICT(room_id,user_id) DO UPDATE SET nickname=excluded.nickname,role_id=excluded.role_id,joined_at=excluded.joined_at,left_at=NULL`)
          .bind(user.id, user.nickname, roleId, now, brief.id, token),
        insertEvent(env.DB, brief.id, user, token, crypto.randomUUID(), "system", `${user.nickname}加入了团本。`, roleId),
      ]);
      if (result[0].meta.changes !== 1) throw conflict();
      return json({ accountId: user.id, room: await roomDetail(env.DB, brief.id, user.id) });
    }
    if (roomRoute && roomRoute[2] && method === "POST") {
      const room = await mutateRoom(env.DB, identifier(roomRoute[1]), user, body, roomRoute[2]);
      return json(roomRoute[2] === "leave" ? { accountId: user.id, left: true } : { accountId: user.id, room });
    }
    if ((relative === "" && method === "POST") || (draftRoute && draftRoute[1] !== "rooms" && (method === "PUT" || method === "DELETE"))) {
      bodyKeys(body, method === "POST" ? ["accountId", "scenario"] : method === "PUT" ? ["accountId", "scenario", "version"] : ["accountId", "version"]);
      let draft: XumengScenarioDraft | undefined;
      if (method !== "DELETE") { try { draft = parseXumengScenarioDraft(body.scenario); } catch (error) { throw bad(error instanceof Error ? error.message : "团本格式无效。"); } }
      const id = draftRoute ? identifier(draftRoute[1]) : draft!.id; if (draft && draft.id !== id) throw bad("团本编号与路径不一致。");
      const now = Date.now();
      const statement = method === "POST"
        ? env.DB.prepare(`INSERT INTO creator_scenarios(user_id,id,title,synopsis,draft_json,version,created_at,updated_at)
            SELECT ?,?,?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM creator_scenarios WHERE user_id=?)<200 ON CONFLICT(user_id,id) DO NOTHING`)
          .bind(user.id, id, draft!.title, draft!.synopsis, JSON.stringify(draft), now, now, user.id)
        : method === "PUT"
          ? env.DB.prepare("UPDATE creator_scenarios SET title=?,synopsis=?,draft_json=?,version=version+1,updated_at=? WHERE user_id=? AND id=? AND version=?")
            .bind(draft!.title, draft!.synopsis, JSON.stringify(draft), now, user.id, id, integer(body.version))
          : env.DB.prepare("DELETE FROM creator_scenarios WHERE user_id=? AND id=? AND version=? RETURNING id").bind(user.id, id, integer(body.version));
      const results = await env.DB.batch<Row>([statement, env.DB.prepare("SELECT * FROM creator_scenarios WHERE user_id=? AND id=?").bind(user.id, id)]);
      const result = results[0];
      if (method === "DELETE" && result.results.length === 1) return json({ accountId: user.id, deleted: true });
      const scenario = results[1].results[0] ? draftFromRow(results[1].results[0]) : null;
      if (result.meta.changes !== 1) { if (!scenario && method !== "POST") throw missing(); throw conflict(scenario ? { accountId: user.id, scenario } : undefined); }
      return json({ accountId: user.id, scenario }, method === "POST" ? 201 : 200);
    }
    throw missing();
  } catch (error) {
    if (error instanceof ApiError) throw new ApiError(error.status, error.message, { ...error.details, accountId: user.id });
    throw new ApiError(500, "团本服务暂时不可用，你的输入仍保留。", { accountId: user.id });
  }
}
