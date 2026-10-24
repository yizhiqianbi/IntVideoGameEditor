import { digest, rateLimit } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";
import type { DzmmForumPost, DzmmForumReply } from "../../../src/lib/dzmm-forum-types";
import { readForumCursor, nextForumCursor, type ForumCursorScope } from "./forum-cursor";

const CATEGORIES = new Set(["characters", "social", "life", "help", "real"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type AuthorRow = { user_id: string; nickname: string; is_demo: number; demo_batch_id: string | null };
type PostRow = AuthorRow & { id: string; title: string; body: string; category: DzmmForumPost["category"]; created_at: number; updated_at: number; tags_json: string; upvotes: number; downvotes: number; reply_count: number; my_vote: DzmmForumPost["myVote"] };
type ReplyRow = AuthorRow & { id: string; post_id: string; body: string; created_at: number };
type ReportRow = { id: string; post_id: string; title: string; user_id: string; nickname: string; reason: string; status: "pending" | "resolved" | "dismissed"; created_at: number; updated_at: number };
type CreateReceiptRow = { request_fingerprint: string; post_id: string | null };
const CREATE_LIMIT = 20;
const CREATE_WINDOW_MS = 10 * 60 * 1000;
const POST_COLUMNS = `SELECT p.id,p.title,p.body,p.category,p.user_id,u.nickname,u.is_demo,u.demo_batch_id,p.created_at,p.updated_at,
  COALESCE((SELECT json_group_array(t.tag) FROM forum_post_tags t WHERE t.post_id=p.id),'[]') AS tags_json,
  (SELECT COUNT(*) FROM forum_votes v WHERE v.post_id=p.id AND v.value=1) AS upvotes,
  (SELECT COUNT(*) FROM forum_votes v WHERE v.post_id=p.id AND v.value=-1) AS downvotes,
  (SELECT COUNT(*) FROM forum_replies r WHERE r.post_id=p.id) AS reply_count,
  COALESCE((SELECT v.value FROM forum_votes v WHERE v.post_id=p.id AND v.user_id=?),0) AS my_vote
  FROM forum_posts p JOIN users u ON u.id=p.user_id`;

function publicAuthor(row: AuthorRow): DzmmForumPost["author"] {
  return { id: row.user_id, nickname: row.nickname, ...(row.is_demo === 1 && row.demo_batch_id ? { isDemo: true,
    provenance: { kind: "fictional-demo" as const, source: "original" as const, label: "官方原创示例", batchId: row.demo_batch_id } } : {}) };
}
function toPost(row: PostRow): DzmmForumPost {
  return { id: row.id, title: row.title, body: row.body, category: row.category, author: publicAuthor(row), tags: JSON.parse(row.tags_json), createdAt: row.created_at, updatedAt: row.updated_at, upvotes: row.upvotes, downvotes: row.downvotes, replyCount: row.reply_count, myVote: row.my_vote };
}
function toReply(row: ReplyRow): DzmmForumReply {
  return { id: row.id, postId: row.post_id, body: row.body, author: publicAuthor(row), createdAt: row.created_at };
}
function isSuper(user: UserRecord): boolean { return "role" in user && user.role === "super"; }
function id(value: string): string {
  if (!UUID.test(value)) throw new ApiError(400, "主题或回复编号无效。");
  return value;
}
function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.includes("\0") || !value.trim() || value.length > max) throw new ApiError(400, `${name}需要 1 至 ${max} 个字符。`);
  return value.trim();
}
function draft(body: Record<string, unknown>) {
  const title = text(body.title, "标题", 120);
  const content = text(body.body, "正文", 12000);
  if (typeof body.category !== "string" || !CATEGORIES.has(body.category)) throw new ApiError(400, "请选择有效的主题分类。");
  if (!Array.isArray(body.tags) || body.tags.length > 10) throw new ApiError(400, "最多添加 10 个标签。");
  const tags = [...new Set(body.tags.map((tag) => text(tag, "标签", 40)))];
  return { title, body: content, category: body.category, tags };
}
function pagination(url: URL) {
  function integer(key: string, fallback: number, max: number, min: number) {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new ApiError(400, "分页参数无效。");
    return Number(raw);
  }
  return { limit: integer("limit", 20, 30, 1), offset: integer("offset", 0, 100000, 0) };
}
function optionalQuery(url: URL, name: string, max: number) {
  const value = url.searchParams.get(name);
  return value === null || value === "" ? "" : text(value, "搜索条件", max);
}
async function getPost(env: Env, user: UserRecord, postId: string) {
  const row = await env.DB.prepare(`${POST_COLUMNS} WHERE p.id=?`).bind(user.id, postId).first<PostRow>();
  if (!row) throw new ApiError(404, "主题不存在或已删除。");
  return toPost(row);
}
async function requireOwner(env: Env, user: UserRecord, postId: string) {
  const row = await env.DB.prepare("SELECT id FROM forum_posts WHERE id=? AND (user_id=? OR ?=1)").bind(postId, user.id, isSuper(user) ? 1 : 0).first();
  if (!row) throw new ApiError(404, "主题不存在或无法修改。");
}
async function requireWrite(request: Request, env: Env, user: UserRecord) {
  if (user.isGuest) throw new ApiError(403, "请先注册或登录，再参与广场讨论。");
  await rateLimit(request, env, "forum-write-account", 120, user.id);
  await rateLimit(request, env, "forum-write-ip", 300);
}

export async function handleForum(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/forum" && !url.pathname.startsWith("/v1/forum/")) return null;
  const path = url.pathname.slice("/v1/forum".length);
  if (path === "/posts" && request.method === "GET") {
    const { offset, limit } = pagination(url);
    const category = optionalQuery(url, "category", 40);
    if (category && !CATEGORIES.has(category)) throw new ApiError(400, "主题分类无效。");
    const q = optionalQuery(url, "q", 120);
    const tag = optionalQuery(url, "tag", 40);
    const scope: ForumCursorScope = ["topics", user.id, category, q, tag];
    const page = readForumCursor(url, scope, offset);
    const conditions: string[] = [];
    const values: string[] = [];
    if (category) { conditions.push("p.category=?"); values.push(category); }
    if (q) {
      const escaped = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')"); values.push(escaped, escaped);
    }
    if (tag) { conditions.push("EXISTS (SELECT 1 FROM forum_post_tags t WHERE t.post_id=p.id AND t.tag=?)"); values.push(tag); }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const boundaryWhere = page.boundary ? `${where ? `${where} AND` : " WHERE"} (p.created_at<? OR (p.created_at=? AND p.id<?))` : where;
    const boundaryValues = page.boundary ? [page.boundary.created_at, page.boundary.created_at, page.boundary.id] : [];
    const result = await env.DB.batch([
      env.DB.prepare(`${POST_COLUMNS}${boundaryWhere} ORDER BY p.created_at DESC,p.id DESC LIMIT ?${page.keyset ? "" : " OFFSET ?"}`)
        .bind(user.id, ...values, ...boundaryValues, page.keyset ? limit + 1 : limit, ...(page.keyset ? [] : [offset])),
      env.DB.prepare(`SELECT COUNT(*) AS total FROM forum_posts p${where}`).bind(...values),
      env.DB.prepare("SELECT tag,COUNT(*) AS count FROM forum_post_tags GROUP BY tag ORDER BY count DESC,tag ASC LIMIT 12"),
    ]);
    const total = Number((result[1].results[0] as { total: number }).total);
    const raw = result[0].results as PostRow[], rows = page.keyset ? raw.slice(0, limit) : raw;
    const hasMore = page.keyset ? raw.length > limit : offset + limit < total;
    return json({ posts: rows.map(toPost), total, offset: page.offset, limit, hasMore, popularTags: result[2].results,
      ...(page.keyset ? { nextCursor: nextForumCursor(scope, rows.at(-1), page.offset + rows.length, hasMore) } : {}) });
  }
  if (path === "/posts" && request.method === "POST") {
    await requireWrite(request, env, user);
    const body = await readJson(request, 64 * 1024);
    if (body.accountId !== undefined && body.accountId !== user.id) {
      throw new ApiError(409, "账号已改变，发布草稿仍保留，请重新核对当前账号。", { code: "FORUM_ACCOUNT_CHANGED" });
    }
    const value = draft(body);
    const postId = crypto.randomUUID();
    const now = Date.now();
    if (body.requestId === undefined) {
      // Older callers retain their non-idempotent contract. Read the saved
      // result in this transaction, just as the versioned PATCH does.
      await rateLimit(request, env, "forum-create-account", CREATE_LIMIT, user.id);
      const results = await env.DB.batch<PostRow>([
        env.DB.prepare("INSERT INTO forum_posts (id,user_id,title,body,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(postId, user.id, value.title, value.body, value.category, now, now),
        ...value.tags.map((tag) => env.DB.prepare("INSERT INTO forum_post_tags (post_id,tag) VALUES (?,?)").bind(postId, tag)),
        env.DB.prepare(`${POST_COLUMNS} WHERE p.id=?`).bind(user.id, postId),
      ]);
      return json({ post: toPost(results.at(-1)!.results[0]) }, 201);
    }
    if (typeof body.requestId !== "string" || !UUID.test(body.requestId.toLowerCase())) {
      throw new ApiError(400, "发布请求编号无效，原草稿仍保留。");
    }
    const requestId = body.requestId.toLowerCase();
    const fingerprint = digest(JSON.stringify({ ...value, tags: [...value.tags].sort() }));
    const claim = crypto.randomUUID();
    const rateKey = digest(`forum-create-account:${user.id}`);
    const claimScope = "user_id=? AND request_id=? AND claim_token=? AND post_id IS NULL";
    const claimValues = [user.id, requestId, claim];
    // The receipt, quota, post, tags and returned snapshot commit together.
    // Only this transaction's winning nonce can insert the parent or tags.
    // Replay does not spend another create quota, even at the rate ceiling.
    const results = await env.DB.batch<PostRow>([
      env.DB.prepare(`INSERT INTO forum_create_requests(user_id,request_id,request_fingerprint,post_id,claim_token,created_at)
        SELECT ?,?,?,NULL,?,? WHERE NOT EXISTS
          (SELECT 1 FROM auth_rate_limits WHERE key=? AND window_start>=? AND count>=?)
        ON CONFLICT(user_id,request_id) DO NOTHING`)
        .bind(user.id, requestId, fingerprint, claim, now, rateKey, now - CREATE_WINDOW_MS, CREATE_LIMIT),
      env.DB.prepare(`INSERT INTO auth_rate_limits(key,count,window_start)
        SELECT ?,1,? WHERE EXISTS (SELECT 1 FROM forum_create_requests WHERE ${claimScope})
        ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<? THEN 1 ELSE count+1 END,
          window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END`)
        .bind(rateKey, now, ...claimValues, now - CREATE_WINDOW_MS, now - CREATE_WINDOW_MS),
      env.DB.prepare(`INSERT INTO forum_posts(id,user_id,title,body,category,created_at,updated_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM forum_create_requests WHERE ${claimScope})`)
        .bind(postId, user.id, value.title, value.body, value.category, now, now, ...claimValues),
      ...value.tags.map((tag) => env.DB.prepare(`INSERT INTO forum_post_tags(post_id,tag)
        SELECT ?,? WHERE EXISTS (SELECT 1 FROM forum_create_requests WHERE ${claimScope})`)
        .bind(postId, tag, ...claimValues)),
      env.DB.prepare(`UPDATE forum_create_requests SET post_id=? WHERE ${claimScope}`).bind(postId, ...claimValues),
      env.DB.prepare("SELECT request_fingerprint,post_id FROM forum_create_requests WHERE user_id=? AND request_id=?").bind(user.id, requestId),
      env.DB.prepare(`${POST_COLUMNS} WHERE p.id=(SELECT post_id FROM forum_create_requests WHERE user_id=? AND request_id=?) AND p.user_id=?`)
        .bind(user.id, user.id, requestId, user.id),
    ]);
    const receipt = results.at(-2)!.results[0] as unknown as CreateReceiptRow | undefined;
    if (!receipt) throw new ApiError(429, "操作过于频繁，请稍后再试。");
    if (receipt.request_fingerprint !== fingerprint) {
      throw new ApiError(409, "该发布请求已用于另一份内容，请先核对上次发布，当前草稿仍保留。", { code: "FORUM_CREATE_CONFLICT" });
    }
    const row = results.at(-1)!.results[0];
    if (!receipt.post_id || !row) {
      throw new ApiError(410, "上次发布的主题已删除，请明确新建主题，原草稿仍保留。", { code: "FORUM_CREATE_DELETED" });
    }
    return json({ post: toPost(row) }, 201);
  }
  const postMatch = /^\/posts\/([^/]+)$/.exec(path);
  if (postMatch) {
    const postId = id(postMatch[1]);
    if (request.method === "GET") {
      const { limit, offset } = pagination(url);
      const scope: ForumCursorScope = ["replies", user.id, postId];
      const page = readForumCursor(url, scope, offset);
      const post = await getPost(env, user, postId);
      const boundaryWhere = page.boundary ? " AND (r.created_at>? OR (r.created_at=? AND r.id>?))" : "";
      const boundaryValues = page.boundary ? [page.boundary.created_at, page.boundary.created_at, page.boundary.id] : [];
      const results = await env.DB.batch([
        env.DB.prepare(`SELECT r.id,r.post_id,r.body,r.user_id,u.nickname,u.is_demo,u.demo_batch_id,r.created_at FROM forum_replies r JOIN users u ON u.id=r.user_id WHERE r.post_id=?${boundaryWhere} ORDER BY r.created_at ASC,r.id ASC LIMIT ?${page.keyset ? "" : " OFFSET ?"}`)
          .bind(postId, ...boundaryValues, page.keyset ? limit + 1 : limit, ...(page.keyset ? [] : [offset])),
        env.DB.prepare("SELECT COUNT(*) AS total FROM forum_replies WHERE post_id=?").bind(postId),
      ]);
      const total = Number((results[1].results[0] as { total: number }).total);
      const raw = results[0].results as ReplyRow[], rows = page.keyset ? raw.slice(0, limit) : raw;
      const hasMore = page.keyset ? raw.length > limit : offset + limit < total;
      return json({ post, replies: rows.map(toReply), total, offset: page.offset, limit, hasMore,
        ...(page.keyset ? { nextCursor: nextForumCursor(scope, rows.at(-1), page.offset + rows.length, hasMore) } : {}) });
    }
    if (request.method === "PATCH") {
      await requireWrite(request, env, user);
      await requireOwner(env, user, postId);
      const body = await readJson(request, 64 * 1024);
      const base = body.baseUpdatedAt;
      if (base === undefined) throw new ApiError(428, "请先核对主题的最新版本，再保存修改。");
      if (typeof base !== "number" || !Number.isSafeInteger(base) || base < 0 || base >= Number.MAX_SAFE_INTEGER) {
        throw new ApiError(400, "主题来源版本无效，请重新核对最新主题。");
      }
      const value = draft(body);
      const scope = "id=? AND (user_id=? OR ?=1) AND updated_at=?";
      const scopeValues = [postId, user.id, isSuper(user) ? 1 : 0, base];
      const nextUpdatedAt = Math.max(Date.now(), base + 1);
      // D1 batches are atomic. Keep every tag mutation on the old version,
      // before advancing the parent, so a losing edit changes neither field.
      const results = await env.DB.batch<PostRow>([
        env.DB.prepare(`DELETE FROM forum_post_tags WHERE post_id=? AND EXISTS (SELECT 1 FROM forum_posts WHERE ${scope})`).bind(postId, ...scopeValues),
        ...value.tags.map((tag) => env.DB.prepare(`INSERT INTO forum_post_tags (post_id,tag) SELECT ?,? WHERE EXISTS (SELECT 1 FROM forum_posts WHERE ${scope})`).bind(postId, tag, ...scopeValues)),
        env.DB.prepare(`UPDATE forum_posts SET title=?,body=?,category=?,updated_at=? WHERE ${scope}`).bind(value.title, value.body, value.category, nextUpdatedAt, ...scopeValues),
        env.DB.prepare(`${POST_COLUMNS} WHERE p.id=? AND (p.user_id=? OR ?=1)`).bind(user.id, postId, user.id, isSuper(user) ? 1 : 0),
      ]);
      const row = results.at(-1)!.results[0];
      if (!row) throw new ApiError(404, "主题不存在或无法修改。");
      const current = toPost(row);
      if (results.at(-2)!.meta.changes !== 1) {
        throw new ApiError(409, "主题已在其他页面更新，原草稿仍保留，请先对照最新内容。", { code: "FORUM_EDIT_CONFLICT", current });
      }
      return json({ post: current });
    }
    if (request.method === "DELETE") {
      await requireWrite(request, env, user);
      const result = await env.DB.prepare("DELETE FROM forum_posts WHERE id=? AND (user_id=? OR ?=1)").bind(postId, user.id, isSuper(user) ? 1 : 0).run();
      if (!result.meta.changes) throw new ApiError(404, "主题不存在或无法删除。");
      return json({ deleted: true });
    }
    throw new ApiError(405, "主题接口不支持此操作。");
  }
  const replyMatch = /^\/posts\/([^/]+)\/replies$/.exec(path);
  if (replyMatch) {
    const postId = id(replyMatch[1]);
    if (request.method !== "POST") throw new ApiError(405, "回复接口仅支持 POST。");
    await requireWrite(request, env, user);
    await getPost(env, user, postId);
    const body = text((await readJson(request, 24 * 1024)).body, "回复", 4000);
    const replyId = crypto.randomUUID();
    const now = Date.now();
    const result = await env.DB.prepare("INSERT INTO forum_replies (id,post_id,user_id,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM forum_posts WHERE id=?)").bind(replyId, postId, user.id, body, now, postId).run();
    if (!result.meta.changes) throw new ApiError(404, "主题不存在或已删除。");
    return json({ reply: { id: replyId, postId, body, author: { id: user.id, nickname: user.nickname }, createdAt: now } }, 201);
  }
  const voteMatch = /^\/posts\/([^/]+)\/vote$/.exec(path);
  if (voteMatch) {
    const postId = id(voteMatch[1]);
    if (request.method !== "PUT") throw new ApiError(405, "投票接口仅支持 PUT。");
    await requireWrite(request, env, user);
    await getPost(env, user, postId);
    const value = (await readJson(request, 1024)).value;
    if (value !== -1 && value !== 0 && value !== 1) throw new ApiError(400, "投票值应为赞、踩或取消。");
    if (value === 0) await env.DB.prepare("DELETE FROM forum_votes WHERE post_id=? AND user_id=?").bind(postId, user.id).run();
    else await env.DB.prepare("INSERT INTO forum_votes (post_id,user_id,value) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM forum_posts WHERE id=?) ON CONFLICT(post_id,user_id) DO UPDATE SET value=excluded.value").bind(postId, user.id, value, postId).run();
    return json({ post: await getPost(env, user, postId) });
  }
  const deleteReplyMatch = /^\/replies\/([^/]+)$/.exec(path);
  if (deleteReplyMatch) {
    const replyId = id(deleteReplyMatch[1]);
    if (request.method !== "DELETE") throw new ApiError(405, "此回复接口仅支持 DELETE。");
    await requireWrite(request, env, user);
    const result = await env.DB.prepare("DELETE FROM forum_replies WHERE id=? AND (user_id=? OR ?=1)").bind(replyId, user.id, isSuper(user) ? 1 : 0).run();
    if (!result.meta.changes) throw new ApiError(404, "回复不存在或无法删除。");
    return json({ deleted: true });
  }
  const reportMatch = /^\/posts\/([^/]+)\/report$/.exec(path);
  if (reportMatch) {
    const postId = id(reportMatch[1]);
    if (request.method !== "POST") throw new ApiError(405, "举报接口仅支持 POST。");
    await requireWrite(request, env, user);
    await rateLimit(request, env, "forum-report-account", 10, user.id);
    await getPost(env, user, postId);
    const reason = text((await readJson(request, 8192)).reason, "举报说明", 1000);
    const now = Date.now();
    const result = await env.DB.prepare("INSERT INTO forum_reports (id,post_id,user_id,reason,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM forum_posts WHERE id=?) ON CONFLICT(post_id,user_id) DO NOTHING").bind(crypto.randomUUID(), postId, user.id, reason, now, now, postId).run();
    if (!result.meta.changes) await getPost(env, user, postId);
    return json({ reported: true }, result.meta.changes ? 201 : 200);
  }
  if (path === "/reports" && request.method === "GET") {
    if (user.isGuest || !isSuper(user)) throw new ApiError(403, "仅超级管理员可以查看举报。");
    const { offset, limit } = pagination(url);
    const status = optionalQuery(url, "status", 20) || "pending";
    if (!["pending", "resolved", "dismissed"].includes(status)) throw new ApiError(400, "举报状态无效。");
    const results = await env.DB.batch([
      env.DB.prepare("SELECT r.id,r.post_id,p.title,r.user_id,u.nickname,r.reason,r.status,r.created_at,r.updated_at FROM forum_reports r JOIN forum_posts p ON p.id=r.post_id JOIN users u ON u.id=r.user_id WHERE r.status=? ORDER BY r.created_at DESC,r.id DESC LIMIT ? OFFSET ?").bind(status, limit, offset),
      env.DB.prepare("SELECT COUNT(*) AS total FROM forum_reports WHERE status=?").bind(status),
    ]);
    const total = Number((results[1].results[0] as { total: number }).total);
    const reports = (results[0].results as ReportRow[]).map((row) => ({ id: row.id, postId: row.post_id, title: row.title, reporter: { id: row.user_id, nickname: row.nickname }, reason: row.reason, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }));
    return json({ reports, total, offset, limit, hasMore: offset + limit < total });
  }
  const reviewMatch = /^\/reports\/([^/]+)\/status$/.exec(path);
  if (reviewMatch) {
    const reportId = id(reviewMatch[1]);
    if (request.method !== "PATCH") throw new ApiError(405, "处理举报仅支持 PATCH。");
    await requireWrite(request, env, user);
    if (!isSuper(user)) throw new ApiError(403, "仅超级管理员可以处理举报。");
    const status = (await readJson(request, 1024)).status;
    if (status !== "resolved" && status !== "dismissed") throw new ApiError(400, "请选择有效的处理结果。");
    const result = await env.DB.prepare("UPDATE forum_reports SET status=?,reviewed_by=?,updated_at=? WHERE id=?").bind(status, user.id, Date.now(), reportId).run();
    if (!result.meta.changes) throw new ApiError(404, "举报不存在或相关主题已删除。");
    return json({ reviewed: true });
  }
  if (path === "/posts") throw new ApiError(405, "广场接口不支持此操作。");
  throw new ApiError(404, "广场接口不存在。");
}
