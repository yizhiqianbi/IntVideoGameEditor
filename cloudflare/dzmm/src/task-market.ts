import { DZMM_LISTED_CHARACTERS } from "../../../src/lib/dzmm-characters";
import { hasTaskMarketInstructions, parseTaskMarketInstructions, type TaskMarketInstructions } from "../../../src/lib/dzmm-task-instructions";
import { digest, rateLimit, tokenFrom, toUser, type UserRow } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const PREFIX = "/v1/task-market";
const DAY = 86400000;
const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PUBLISHED = /^published-[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CATEGORIES = new Set(["roleplay", "writing", "feedback"]);
const STATIC = new Map(DZMM_LISTED_CHARACTERS.map(card => [card.id, card.name]));
// Every mutation rechecks the actual session, guest status and current role.
// These first three numbered bindings are reserved throughout this module.
const ACTOR = `WITH actor AS (SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
  WHERE u.id=?1 AND s.token_hash=?2 AND s.expires_at>?3 AND u.is_guest=0)`;
const PUBLIC_CHARACTER = `(t.character_id IS NULL OR t.character_kind='static' OR EXISTS(
  SELECT 1 FROM character_publications p JOIN character_submissions s ON s.publication_id=p.id
  WHERE p.id=t.character_id AND p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision))`;
const OCCUPIED = "status IN ('claimed','submitted','returned','approved')";
const TASK_SELECT = `SELECT t.*,u.nickname,
  (SELECT COUNT(*) FROM task_market_assignments a WHERE a.task_id=t.id AND ${OCCUPIED}) AS occupied,
  (SELECT COUNT(*) FROM task_market_assignments a WHERE a.task_id=t.id AND a.status='approved') AS approved_count,
  (SELECT COUNT(*) FROM task_market_assignments a WHERE a.task_id=t.id AND a.status IN ('submitted','returned','approved')) AS submission_count,
  EXISTS(SELECT 1 FROM task_market_hidden h WHERE h.task_id=t.id AND h.user_id=?1) AS hidden,
  EXISTS(SELECT 1 FROM task_market_assignments a WHERE a.task_id=t.id AND a.user_id=?1) AS participating,
  ${PUBLIC_CHARACTER} AS character_available FROM task_market_tasks t JOIN users u ON u.id=t.user_id`;

type TaskRow = {
  id: string; user_id: string; request_id: string; request_fingerprint: string;
  title: string; description: string; requirements: string; category: string; instructions_json: string;
  character_id: string | null; character_kind: string | null; character_name: string | null;
  reward_points: number; slots: number; deadline_at: number; status: "pending" | "open" | "cancelled" | "rejected";
  version: number; mutation_token: string; reviewed_by: string | null; reviewed_at: number | null;
  review_reason: string; created_at: number; updated_at: number;
  nickname: string; occupied: number; approved_count: number; submission_count: number;
  hidden: number; participating: number; character_available: number;
};
type AssignmentRow = {
  id: string; task_id: string; user_id: string;
  status: "claimed" | "submitted" | "returned" | "approved" | "withdrawn";
  version: number; revision: number; mutation_token: string; created_at: number; updated_at: number;
  submitted_at: number | null; reviewed_at: number | null; review_reason: string; reward_points: number;
};
type Auth = { user: UserRecord; hash: string; now: number };
function uid(value: string): string {
  if (!UUID.test(value)) throw new ApiError(400, "任务或领取编号无效。");
  return value;
}
function version(body: Record<string, unknown>): number {
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 1) throw new ApiError(400, "请提供当前任务或领取版本。");
  return Number(body.version);
}
function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) throw new ApiError(400, `${label}需要 1 至 ${maximum} 个字符。`);
  return value.trim();
}
function checkFields(body: Record<string, unknown>, allowed: string[], user: UserRecord) {
  if (body.accountId !== user.id) throw new ApiError(409, "账号已切换，请刷新后重新操作。");
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, "任务请求包含不支持的字段；奖励与权限由服务端确定。");
}
function args(auth: Auth): [string, string, number] { return [auth.user.id, auth.hash, auth.now]; }
function conflict(): never { throw new ApiError(409, "任务状态已改变，请刷新后重试。"); }
function isSuper(user: UserRecord) { return !user.isGuest && user.role === "super"; }
async function authFor(request: Request, env: Env, supplied: UserRecord, now: number): Promise<Auth> {
  const token = tokenFrom(request);
  if (!token) throw new ApiError(401, "请登录后查看任务。");
  const hash = digest(token);
  const row = await env.DB.prepare(`SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE u.id=? AND s.token_hash=? AND s.expires_at>?`).bind(supplied.id, hash, now).first<UserRow>();
  if (!row) throw new ApiError(401, "登录已失效，请重新登录。");
  return { user: toUser(row), hash, now };
}
async function writeAuth(request: Request, env: Env, auth: Auth) {
  if (auth.user.isGuest) throw new ApiError(403, "请注册或登录正式账户后参与任务。");
  const origin = request.headers.get("Origin");
  // Match app.checkMutationOrigin without a circular dependency: the web
  // gateway intentionally rewrites both URL and Origin to the backend's origin.
  const allowed = new Set([new URL(request.url).origin, ...(env.APP_ORIGINS || "").split(/[\s,]+/).filter(Boolean)]);
  if (origin ? !allowed.has(origin) : request.headers.has("Sec-Fetch-Site")) throw new ApiError(403, "请求来源不受信任。");
  await rateLimit(request, env, "task-market-write-account", 180, auth.user.id);
  await rateLimit(request, env, "task-market-write-ip", 500);
}
function publicTask(row: TaskRow, user: UserRecord, now: number) {
  const status = row.status === "open" && (row.deadline_at <= now || row.approved_count >= row.slots) ? "completed" : row.status;
  return {
    id: row.id, owner: { id: row.user_id, nickname: row.nickname }, title: row.title,
    description: row.description, requirements: row.requirements, category: row.category,
    instructions: parseTaskMarketInstructions(JSON.parse(row.instructions_json)),
    characterId: row.character_id, characterName: row.character_name, rewardPoints: row.reward_points,
    slots: row.slots, remainingSlots: Math.max(0, row.slots - row.occupied), deadlineAt: row.deadline_at,
    status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    hidden: Boolean(row.hidden), participating: Boolean(row.participating), approvedCount: row.approved_count,
    submissionCount: row.submission_count, reviewReason: row.review_reason,
    canClaim: !user.isGuest && row.user_id !== user.id && status === "open" && !row.hidden && !row.participating
      && row.occupied < row.slots && Boolean(row.character_available),
  };
}
function assignment(row: AssignmentRow) {
  return { id: row.id, taskId: row.task_id, userId: row.user_id, status: row.status, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at, submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at, reviewReason: row.review_reason, rewardPoints: row.reward_points };
}
function visible(row: TaskRow, user: UserRecord) {
  return row.status === "open" || (row.status === "cancelled" && row.reviewed_at !== null) || row.user_id === user.id || Boolean(row.participating) || isSuper(user);
}
async function getTask(env: Env, auth: Auth, id: string): Promise<TaskRow> {
  const row = await env.DB.prepare(`${TASK_SELECT} WHERE t.id=?2`).bind(auth.user.id, uid(id)).first<TaskRow>();
  if (!row || !visible(row, auth.user)) throw new ApiError(404, "任务不存在或无法访问。");
  return row;
}
async function ownAssignment(env: Env, auth: Auth, taskId: string) {
  return env.DB.prepare("SELECT * FROM task_market_assignments WHERE task_id=? AND user_id=?").bind(taskId, auth.user.id).first<AssignmentRow>();
}
async function responseTask(env: Env, auth: Auth, id: string, status = 200, extra: Record<string, unknown> = {}) {
  return json({ accountId: auth.user.id, task: publicTask(await getTask(env, auth, id), auth.user, auth.now), ...extra }, status);
}
async function list(env: Env, auth: Auth, url: URL, admin: boolean) {
  if (admin && !isSuper(auth.user)) throw new ApiError(403, "只有平台管理员可以审核任务。");
  const filter = url.searchParams.get("filter") ?? "open";
  const adminStatus = url.searchParams.get("status") ?? "pending";
  if ((!admin && !["open", "completed", "all", "hidden", "my", "joined"].includes(filter)) || (admin && !["pending", "all"].includes(adminStatus))) throw new ApiError(400, "任务筛选无效。");
  const category = url.searchParams.get("category") ?? "all";
  if (category !== "all" && !CATEGORIES.has(category)) throw new ApiError(400, "任务分类无效。");
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length > 120 || q.includes("\0")) throw new ApiError(400, "搜索词过长。");
  const number = (key: string, fallback: number, max: number, min = 0) => {
    const value = url.searchParams.get(key);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new ApiError(400, "分页参数无效。");
    return Number(value);
  };
  const offset = number("offset", 0, 100000), limit = number("limit", 20, 50, 1);
  const hidden = "EXISTS(SELECT 1 FROM task_market_hidden h WHERE h.task_id=t.id AND h.user_id=?1)";
  const joined = "EXISTS(SELECT 1 FROM task_market_assignments a WHERE a.task_id=t.id AND a.user_id=?1)";
  const completed = `(t.status='open' AND (t.deadline_at<=?2 OR (SELECT COUNT(*) FROM task_market_assignments a WHERE a.task_id=t.id AND a.status='approved')>=t.slots))`;
  const publicOrOwn = `(t.status='open' OR (t.status='cancelled' AND t.reviewed_at IS NOT NULL) OR t.user_id=?1 OR ${joined})`;
  let predicate: string;
  if (admin) predicate = adminStatus === "pending" ? "t.status='pending'" : "1";
  else if (filter === "hidden") predicate = `${hidden} AND ${publicOrOwn}`;
  else if (filter === "my") predicate = `t.user_id=?1 AND NOT ${hidden}`;
  else if (filter === "joined") predicate = `${joined} AND NOT ${hidden}`;
  else if (filter === "open") predicate = `t.status='open' AND NOT ${completed} AND NOT ${hidden}`;
  else if (filter === "completed") predicate = `(${completed} OR (t.status='cancelled' AND t.reviewed_at IS NOT NULL)) AND NOT ${hidden}`;
  else predicate = `${publicOrOwn} AND NOT ${hidden}`;
  const bindings: (string | number)[] = [auth.user.id, auth.now];
  if (category !== "all") { bindings.push(category); predicate += ` AND t.category=?${bindings.length}`; }
  if (q) { bindings.push(q); const n = bindings.length; predicate += ` AND (instr(lower(t.title),lower(?${n}))>0 OR instr(lower(t.description),lower(?${n}))>0 OR instr(lower(t.requirements),lower(?${n}))>0)`; }
  // ?2 must remain bound even when a selected filter does not use the clock.
  predicate += " AND ?2>=0";
  const results = await env.DB.batch([
    env.DB.prepare(`${TASK_SELECT} WHERE ${predicate} ORDER BY t.created_at DESC,t.id LIMIT ?${bindings.length + 1} OFFSET ?${bindings.length + 2}`).bind(...bindings, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM task_market_tasks t WHERE ${predicate}`).bind(...bindings),
  ]);
  const total = Number((results[1].results[0] as { total: number }).total);
  return json({ accountId: auth.user.id, pointsKind: "credit", modelBillingLinked: true, rewardUnit: "Credit",
    tasks: (results[0].results as TaskRow[]).map(row => publicTask(row, auth.user, auth.now)), total, offset, limit, hasMore: offset + limit < total });
}
async function character(env: Env, id: unknown): Promise<{ id: string | null; kind: string | null; name: string | null }> {
  if (id === undefined || id === null || id === "") return { id: null, kind: null, name: null };
  if (typeof id !== "string") throw new ApiError(400, "角色引用无效。");
  if (STATIC.has(id)) return { id, kind: "static", name: STATIC.get(id)! };
  if (!PUBLISHED.test(id)) throw new ApiError(400, "任务只能引用本站公开已上架角色。");
  const card = await env.DB.prepare(`SELECT s.snapshot_json FROM character_publications p JOIN character_submissions s ON s.publication_id=p.id
    WHERE p.id=? AND p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision`).bind(id).first<{ snapshot_json: string }>();
  if (!card) throw new ApiError(400, "引用角色尚未上架或已下架。");
  const name = (JSON.parse(card.snapshot_json) as { name?: unknown }).name;
  if (typeof name !== "string" || !name.trim()) throw new ApiError(400, "公开角色信息不完整。");
  return { id, kind: "published", name: name.slice(0, 120) };
}
async function create(env: Env, auth: Auth, body: Record<string, unknown>) {
  checkFields(body, ["accountId", "requestId", "title", "description", "requirements", "category", "characterId", "rewardPoints", "slots", "deadlineAt", "instructions"], auth.user);
  const requestId = typeof body.requestId === "string" ? uid(body.requestId) : uid("");
  const title = text(body.title, "标题", 80), description = text(body.description, "任务说明", 4000), requirements = text(body.requirements, "验收要求", 2000);
  if (typeof body.category !== "string" || !CATEGORIES.has(body.category)) throw new ApiError(400, "请选择任务分类。");
  if (![5, 10, 20].includes(Number(body.rewardPoints)) || typeof body.rewardPoints !== "number") throw new ApiError(400, "任务奖励仅支持 5、10、20 Credit。");
  if (!Number.isSafeInteger(body.slots) || Number(body.slots) < 1 || Number(body.slots) > 20) throw new ApiError(400, "任务名额需要 1 至 20 个。");
  if (!Number.isSafeInteger(body.deadlineAt)) throw new ApiError(400, "任务期限无效。");
  let instructions: TaskMarketInstructions;
  try { instructions = parseTaskMarketInstructions(body.instructions); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "任务目标或约束规则无效。"); }
  const charId = body.characterId === undefined || body.characterId === "" ? null : body.characterId;
  // Empty metadata deliberately keeps the original eight-field fingerprint.
  // An old frozen request can recover an existing task after this migration.
  const fingerprintValues: unknown[] = [title, description, requirements, body.category, charId, body.rewardPoints, body.slots, body.deadlineAt];
  if (hasTaskMarketInstructions(instructions)) fingerprintValues.push(instructions);
  const fingerprint = JSON.stringify(fingerprintValues);
  const prior = await env.DB.prepare("SELECT id,request_fingerprint FROM task_market_tasks WHERE user_id=? AND request_id=?").bind(auth.user.id, requestId).first<{ id: string; request_fingerprint: string }>();
  if (prior) { if (prior.request_fingerprint !== fingerprint) conflict(); return responseTask(env, auth, prior.id); }
  if (Number(body.deadlineAt) < auth.now + 3600000 || Number(body.deadlineAt) > auth.now + 30 * DAY) throw new ApiError(400, "任务期限需要为未来 1 小时至 30 天。");
  const ref = await character(env, charId), id = crypto.randomUUID(), nonce = crypto.randomUUID();
  const inserted = await env.DB.prepare(`${ACTOR} INSERT INTO task_market_tasks(id,user_id,request_id,request_fingerprint,title,description,requirements,category,
    character_id,character_kind,character_name,reward_points,slots,deadline_at,status,version,mutation_token,created_at,updated_at,instructions_json)
    SELECT ?4,id,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,'pending',1,?17,?3,?3,?18 FROM actor
    WHERE (SELECT COUNT(*) FROM task_market_tasks WHERE user_id=?1 AND status='pending')<10
      AND (?12 IS NULL OR ?12='static' OR EXISTS(SELECT 1 FROM character_publications p JOIN character_submissions s ON s.publication_id=p.id
        WHERE p.id=?11 AND p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision))
    ON CONFLICT(user_id,request_id) DO NOTHING`).bind(...args(auth), id, requestId, fingerprint, title, description, requirements, body.category,
    ref.id, ref.kind, ref.name, body.rewardPoints as number, body.slots as number, body.deadlineAt as number, nonce, JSON.stringify(instructions)).run();
  const saved = await env.DB.prepare("SELECT id,request_fingerprint FROM task_market_tasks WHERE user_id=? AND request_id=?").bind(auth.user.id, requestId).first<{ id: string; request_fingerprint: string }>();
  if (!saved || saved.request_fingerprint !== fingerprint) conflict();
  return responseTask(env, auth, saved.id, inserted.meta.changes === 1 ? 201 : 200);
}
async function platformReview(env: Env, auth: Auth, task: TaskRow, body: Record<string, unknown>) {
  checkFields(body, ["accountId", "version", "decision", "reason"], auth.user);
  if (!isSuper(auth.user)) throw new ApiError(403, "只有平台管理员可以审核任务。");
  const v = version(body), decision = body.decision;
  if (decision !== "approved" && decision !== "rejected") throw new ApiError(400, "审核决定无效。");
  const reason = decision === "rejected" ? text(body.reason, "退回原因", 2000) : body.reason === undefined ? "" : text(body.reason, "审核说明", 2000);
  const nonce = crypto.randomUUID();
  const results = await env.DB.batch([
    env.DB.prepare(`${ACTOR} UPDATE task_market_tasks AS t SET status=?4,version=version+1,reviewed_by=?1,reviewed_at=?3,
      review_reason=?5,updated_at=?3,mutation_token=?6 WHERE id=?7 AND version=?8 AND status='pending'
      AND EXISTS(SELECT 1 FROM actor WHERE role='super') AND (?4='rejected' OR (deadline_at>?3 AND ${PUBLIC_CHARACTER}))`).bind(...args(auth), decision === "approved" ? "open" : "rejected", reason, nonce, task.id, v),
    env.DB.prepare(`INSERT INTO task_market_reviews(id,task_id,actor_id,kind,decision,reason,created_at)
      SELECT ?,id,?,'platform',?,?,? FROM task_market_tasks WHERE id=? AND mutation_token=?`).bind(crypto.randomUUID(), auth.user.id, decision, reason, auth.now, task.id, nonce),
  ]);
  if (results[0].meta.changes !== 1) conflict();
  return responseTask(env, auth, task.id);
}
async function claim(env: Env, auth: Auth, task: TaskRow, body: Record<string, unknown>) {
  checkFields(body, ["accountId"], auth.user);
  if (task.user_id === auth.user.id) throw new ApiError(403, "不能领取自己发布的任务。");
  const prior = await ownAssignment(env, auth, task.id);
  if (prior) {
    if (prior.status === "withdrawn") throw new ApiError(409, "已退出此任务，不能重复领取。");
    return responseTask(env, auth, task.id, 200, { assignment: assignment(prior) });
  }
  const id = crypto.randomUUID();
  const created = await env.DB.prepare(`${ACTOR} INSERT INTO task_market_assignments(id,task_id,user_id,status,version,mutation_token,created_at,updated_at,reward_points)
    SELECT ?4,t.id,?1,'claimed',1,?5,?3,?3,t.reward_points FROM task_market_tasks t
    WHERE t.id=?6 AND t.status='open' AND t.deadline_at>?3 AND t.user_id<>?1 AND EXISTS(SELECT 1 FROM actor)
      AND NOT EXISTS(SELECT 1 FROM task_market_hidden WHERE task_id=t.id AND user_id=?1)
      AND ${PUBLIC_CHARACTER}
      AND (SELECT COUNT(*) FROM task_market_assignments WHERE task_id=t.id AND ${OCCUPIED})<t.slots
    ON CONFLICT(task_id,user_id) DO NOTHING`).bind(...args(auth), id, crypto.randomUUID(), task.id).run();
  const saved = await ownAssignment(env, auth, task.id);
  if (!saved || saved.status === "withdrawn") throw new ApiError(409, "任务已截止、名额已满或不能领取，请刷新后重试。");
  return responseTask(env, auth, task.id, created.meta.changes === 1 ? 201 : 200, { assignment: assignment(saved) });
}
async function hide(env: Env, auth: Auth, task: TaskRow, body: Record<string, unknown>) {
  checkFields(body, ["accountId", "hidden"], auth.user);
  if (typeof body.hidden !== "boolean") throw new ApiError(400, "隐藏状态无效。");
  if (body.hidden) await env.DB.prepare(`${ACTOR} INSERT INTO task_market_hidden(user_id,task_id,created_at)
    SELECT id,?4,?3 FROM actor WHERE 1 ON CONFLICT(user_id,task_id) DO NOTHING`).bind(...args(auth), task.id).run();
  else await env.DB.prepare(`${ACTOR} DELETE FROM task_market_hidden WHERE user_id=?1 AND task_id=?4 AND EXISTS(SELECT 1 FROM actor)`).bind(...args(auth), task.id).run();
  return responseTask(env, auth, task.id);
}
async function cancel(env: Env, auth: Auth, task: TaskRow, body: Record<string, unknown>) {
  checkFields(body, ["accountId", "version"], auth.user);
  if (task.user_id !== auth.user.id) throw new ApiError(404, "任务不存在或无法操作。");
  const v = version(body), nonce = crypto.randomUUID();
  const result = await env.DB.batch([
    env.DB.prepare(`${ACTOR} UPDATE task_market_tasks SET status='cancelled',version=version+1,updated_at=?3,mutation_token=?4
      WHERE id=?5 AND user_id=?1 AND version=?6 AND status IN ('pending','open') AND EXISTS(SELECT 1 FROM actor)`).bind(...args(auth), nonce, task.id, v),
    env.DB.prepare(`INSERT INTO task_market_reviews(id,task_id,actor_id,kind,decision,reason,created_at)
      SELECT ?,id,?,'cancel','cancelled','停止新领取；保留原参与者的提交与验收。',? FROM task_market_tasks WHERE id=? AND mutation_token=?`).bind(crypto.randomUUID(), auth.user.id, auth.now, task.id, nonce),
  ]);
  if (result[0].meta.changes !== 1) conflict();
  return responseTask(env, auth, task.id);
}
async function withdraw(env: Env, auth: Auth, task: TaskRow, body: Record<string, unknown>) {
  checkFields(body, ["accountId", "version"], auth.user);
  const v = version(body);
  const result = await env.DB.prepare(`${ACTOR} UPDATE task_market_assignments SET status='withdrawn',version=version+1,updated_at=?3,mutation_token=?4
    WHERE task_id=?5 AND user_id=?1 AND version=?6 AND status IN ('claimed','returned') AND EXISTS(SELECT 1 FROM actor)`).bind(...args(auth), crypto.randomUUID(), task.id, v).run();
  if (result.meta.changes !== 1) conflict();
  const saved = await ownAssignment(env, auth, task.id);
  if (!saved) conflict();
  return responseTask(env, auth, task.id, 200, { assignment: assignment(saved) });
}
async function submit(env: Env, auth: Auth, task: TaskRow, body: Record<string, unknown>) {
  checkFields(body, ["accountId", "version", "body"], auth.user);
  const v = version(body), nonce = crypto.randomUUID(), id = crypto.randomUUID();
  text(body.body, "原创成果正文", 12000);
  const content = body.body as string;
  // Cancellation only stops new claims. Previously claimed participants retain
  // their promised submission window and completed submissions remain reviewable.
  const result = await env.DB.batch([
    env.DB.prepare(`${ACTOR} UPDATE task_market_assignments SET status='submitted',version=version+1,revision=revision+1,
      submitted_at=?3,updated_at=?3,reviewed_at=NULL,review_reason='',mutation_token=?4
      WHERE task_id=?5 AND user_id=?1 AND version=?6 AND status IN ('claimed','returned') AND EXISTS(SELECT 1 FROM actor)
      AND EXISTS(SELECT 1 FROM task_market_tasks t WHERE t.id=task_id AND t.user_id<>?1 AND t.status IN ('open','cancelled')
        AND t.reviewed_by IS NOT NULL AND t.deadline_at>?3)`).bind(...args(auth), nonce, task.id, v),
    env.DB.prepare(`INSERT INTO task_market_submissions(id,assignment_id,revision,body,created_at)
      SELECT ?,id,revision,?,? FROM task_market_assignments WHERE task_id=? AND user_id=? AND mutation_token=?`).bind(id, content, auth.now, task.id, auth.user.id, nonce),
  ]);
  if (result[0].meta.changes !== 1) throw new ApiError(409, "领取状态已改变或提交期限已过，请刷新后重试。");
  const saved = await ownAssignment(env, auth, task.id);
  if (!saved) conflict();
  return responseTask(env, auth, task.id, 201, { assignment: assignment(saved), submission: {
    id, assignmentId: saved.id, userId: saved.user_id, nickname: auth.user.nickname, revision: saved.revision,
    body: content, createdAt: auth.now, assignment: assignment(saved),
  } });
}
async function submissionReview(env: Env, auth: Auth, task: TaskRow, id: string, body: Record<string, unknown>) {
  checkFields(body, ["accountId", "version", "decision", "reason"], auth.user);
  if (task.user_id !== auth.user.id) throw new ApiError(404, "任务不存在或无法操作。");
  const v = version(body), decision = body.decision;
  if (decision !== "approved" && decision !== "returned") throw new ApiError(400, "验收决定无效。");
  const reason = decision === "returned" ? text(body.reason, "退回原因", 2000) : body.reason === undefined ? "" : text(body.reason, "验收说明", 2000);
  const nonce = crypto.randomUUID();
  const result = await env.DB.batch([
    env.DB.prepare(`${ACTOR} UPDATE task_market_assignments SET status=?4,version=version+1,reviewed_at=?3,review_reason=?5,
      updated_at=?3,mutation_token=?6 WHERE id=?7 AND task_id=?8 AND version=?9 AND status='submitted' AND user_id<>?1
      AND EXISTS(SELECT 1 FROM actor) AND EXISTS(SELECT 1 FROM task_market_tasks t WHERE t.id=task_id AND t.user_id=?1
        AND t.reviewed_by IS NOT NULL AND t.status IN ('open','cancelled') AND t.reward_points=task_market_assignments.reward_points
        AND (?4<>'approved' OR ((SELECT COUNT(*) FROM task_market_rewards WHERE task_id=t.id)<t.slots
          AND NOT EXISTS(SELECT 1 FROM task_market_rewards r WHERE r.assignment_id=task_market_assignments.id))))`).bind(...args(auth), decision, reason, nonce, uid(id), task.id, v),
    env.DB.prepare(`INSERT INTO task_market_reviews(id,task_id,assignment_id,actor_id,kind,decision,reason,created_at)
      SELECT ?,task_id,id,?,'submission',?,?,? FROM task_market_assignments WHERE id=? AND task_id=? AND mutation_token=?`).bind(crypto.randomUUID(), auth.user.id, decision, reason, auth.now, id, task.id, nonce),
    env.DB.prepare(`INSERT INTO task_market_rewards(assignment_id,user_id,task_id,points,claimed_at,expires_at)
      SELECT a.id,a.user_id,a.task_id,a.reward_points,?,NULL FROM task_market_assignments a JOIN task_market_tasks t ON t.id=a.task_id
      WHERE a.id=? AND a.task_id=? AND a.mutation_token=? AND a.status='approved' AND a.user_id<>t.user_id
        AND t.reward_points=a.reward_points AND t.reviewed_by IS NOT NULL`).bind(auth.now, id, task.id, nonce),
  ]);
  if (result[0].meta.changes !== 1) conflict();
  // A successful approval must never become visible without its atomic award.
  // SQLite constraints and the fixed slot budget make this equality invariant.
  const saved = await env.DB.prepare("SELECT * FROM task_market_assignments WHERE id=? AND task_id=?").bind(id, task.id).first<AssignmentRow>();
  if (!saved) conflict();
  return responseTask(env, auth, task.id, 200, { assignment: assignment(saved) });
}
async function detail(env: Env, auth: Auth, id: string) {
  const taskId = uid(id);
  // D1 batches run in one transaction. Counters, the personal assignment and
  // each visible result must describe the same snapshot, even if another
  // window submits or reviews work while this request is reading.
  const results = await env.DB.batch([
    env.DB.prepare(`${TASK_SELECT} WHERE t.id=?2`).bind(auth.user.id, taskId),
    env.DB.prepare("SELECT * FROM task_market_assignments WHERE task_id=? AND user_id=?").bind(taskId, auth.user.id),
    env.DB.prepare(`SELECT s.id AS submission_id,s.body,s.revision AS submission_revision,s.created_at AS submission_created_at,a.*,u.nickname
      FROM task_market_submissions s JOIN task_market_assignments a ON a.id=s.assignment_id JOIN users u ON u.id=a.user_id
      WHERE a.task_id=?1 AND (a.user_id=?2 OR ?3=1 OR EXISTS(
        SELECT 1 FROM task_market_tasks t WHERE t.id=a.task_id AND t.user_id=?2))
      ORDER BY CASE WHEN s.revision=a.revision AND a.status IN ('claimed','submitted','returned','approved') THEN 0
        WHEN s.revision=a.revision THEN 1 ELSE 2 END,s.created_at DESC,s.id LIMIT 100`).bind(taskId, auth.user.id, Number(isSuper(auth.user))),
  ]);
  const task = results[0].results[0] as TaskRow | undefined;
  if (!task || !visible(task, auth.user)) throw new ApiError(404, "任务不存在或无法访问。");
  const own = results[1].results[0] as AssignmentRow | undefined;
  const rows = results[2].results as (AssignmentRow & {
    submission_id: string; body: string; submission_revision: number; submission_created_at: number; nickname: string;
  })[];
  return json({ accountId: auth.user.id, task: publicTask(task, auth.user, auth.now), assignment: own ? assignment(own) : null,
    submissions: rows.map(row => ({ id: row.submission_id, assignmentId: row.id, userId: row.user_id, nickname: row.nickname,
      revision: row.submission_revision, body: row.body, createdAt: row.submission_created_at, assignment: assignment(row) })) });
}

/** Authenticated task-market routes. No private conversations or Credit tables are read. */
export async function handleTaskMarket(request: Request, env: Env, user: UserRecord, options: { now?: () => number } = {}): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname.replace(/\/$/, "");
  if (path !== PREFIX && !path.startsWith(PREFIX + "/")) return null;
  const auth = await authFor(request, env, user, (options.now ?? Date.now)());
  if (request.method === "GET") {
    if (path === PREFIX) return list(env, auth, url, false);
    if (path === PREFIX + "/admin") return list(env, auth, url, true);
    const match = /^\/v1\/task-market\/([^/]+)$/.exec(path);
    if (!match) throw new ApiError(404, "任务接口不存在。");
    return detail(env, auth, match[1]);
  }
  if (request.method !== "POST") throw new ApiError(405, "任务修改仅支持 POST。");
  await writeAuth(request, env, auth);
  const body = await readJson(request, 64 * 1024);
  if (path === PREFIX) return create(env, auth, body);
  const match = /^\/v1\/task-market\/([^/]+)\/(claim|hide|cancel|withdraw|submissions|review)$/.exec(path);
  if (match) {
    const task = await getTask(env, auth, match[1]);
    if (match[2] === "claim") return claim(env, auth, task, body);
    if (match[2] === "hide") return hide(env, auth, task, body);
    if (match[2] === "cancel") return cancel(env, auth, task, body);
    if (match[2] === "withdraw") return withdraw(env, auth, task, body);
    if (match[2] === "submissions") return submit(env, auth, task, body);
    return platformReview(env, auth, task, body);
  }
  const review = /^\/v1\/task-market\/([^/]+)\/assignments\/([^/]+)\/review$/.exec(path);
  if (review) return submissionReview(env, auth, await getTask(env, auth, review[1]), uid(review[2]), body);
  throw new ApiError(404, "任务接口不存在。");
}
