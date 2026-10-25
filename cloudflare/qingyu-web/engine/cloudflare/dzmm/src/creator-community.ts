import { currentUser, rateLimit, requireUser } from "./auth";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const PREFIX = "/v1/community";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const POST_TYPES = new Set(["text", "image", "roleplay", "adventure", "video_preview", "voice_preview"]);
const VISIBILITIES = new Set(["free", "subscriber"]);
const PROFILE_STATUSES = new Set(["pending", "approved", "rejected", "suspended"]);
const POST_STATUSES = new Set(["pending", "approved", "rejected", "hidden"]);

type ProfileRow = {
  id: string; user_id: string; display_name: string; bio: string; avatar_url: string; cover_url: string;
  status: string; review_reason: string; created_at: number; updated_at: number; reviewed_at: number | null;
  follower_count?: number; post_count?: number; following?: number;
};
type PostRow = {
  id: string; creator_id: string; character_publication_id: string | null; post_type: string; body: string;
  media_json: string; visibility: string; status: string; pinned: number; review_reason: string; created_at: number; updated_at: number;
  display_name: string; avatar_url: string; like_count?: number; liked?: number;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "请求应为 JSON 对象。");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || value.includes("\0") || value.length > max || (required && !value.trim())) {
    throw new ApiError(400, `${label}需要 ${required ? 1 : 0} 至 ${max} 个字符。`);
  }
  return value.trim();
}
function id(value: string, label = "编号"): string {
  if (!UUID.test(value)) throw new ApiError(400, `${label}无效。`);
  return value;
}
function pagination(url: URL) {
  const read = (key: string, fallback: number, max: number) => {
    const value = url.searchParams.get(key);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < 0 || Number(value) > max) throw new ApiError(400, "分页参数无效。");
    return Number(value);
  };
  return { offset: read("offset", 0, 100000), limit: read("limit", 20, 50) };
}
function isSuper(user: UserRecord) { return !user.isGuest && user.role === "super"; }
function safeMedia(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new ApiError(400, "动态媒体最多 8 项。");
  return value.map(item => {
    const path = text(item, "媒体地址", 2048);
    if (/^(?:javascript|data|vbscript):/i.test(path)) throw new ApiError(400, "媒体地址无效。");
    return path;
  });
}
function parseMedia(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : []; }
  catch { return []; }
}
function profileView(row: ProfileRow, includeStatus = false) {
  return {
    id: row.id, userId: row.user_id, displayName: row.display_name, bio: row.bio,
    avatarUrl: row.avatar_url, coverUrl: row.cover_url,
    ...(includeStatus ? { status: row.status, reviewReason: row.review_reason, createdAt: row.created_at, updatedAt: row.updated_at } : {}),
    followerCount: Number(row.follower_count ?? 0), postCount: Number(row.post_count ?? 0), following: Number(row.following ?? 0) === 1,
    subscription: { state: "coming_soon", label: "订阅即将开放", paymentsEnabled: false },
  };
}
function postView(row: PostRow, canReadLocked = false) {
  const locked = row.visibility === "subscriber" && !canReadLocked;
  const body = locked ? "" : row.body;
  return {
    id: row.id, creatorId: row.creator_id, characterPublicationId: row.character_publication_id,
    type: row.post_type, visibility: row.visibility, locked, preview: locked ? row.body.slice(0, 180) : undefined,
    body, media: locked ? [] : parseMedia(row.media_json), pinned: row.pinned === 1,
    author: { displayName: row.display_name, avatarUrl: row.avatar_url },
    likeCount: Number(row.like_count ?? 0), liked: Number(row.liked ?? 0) === 1,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
const PROFILE_SELECT = `SELECT p.*,
  (SELECT COUNT(*) FROM creator_follows f WHERE f.creator_id=p.id) AS follower_count,
  (SELECT COUNT(*) FROM creator_posts cp WHERE cp.creator_id=p.id AND cp.status='approved') AS post_count
  FROM creator_profiles p`;
const POST_SELECT = `SELECT p.*,c.display_name,c.avatar_url,
  (SELECT COUNT(*) FROM creator_post_likes l WHERE l.post_id=p.id) AS like_count
  FROM creator_posts p JOIN creator_profiles c ON c.id=p.creator_id`;

async function approvedProfile(env: Env, profileId: string): Promise<ProfileRow> {
  const row = await env.DB.prepare(`${PROFILE_SELECT} WHERE p.id=? AND p.status='approved'`).bind(profileId).first<ProfileRow>();
  if (!row) throw new ApiError(404, "创作者不存在或尚未公开。");
  return row;
}
async function ownerProfile(env: Env, user: UserRecord): Promise<ProfileRow | null> {
  return env.DB.prepare(`${PROFILE_SELECT} WHERE p.user_id=?`).bind(user.id).first<ProfileRow>();
}
async function requireCreatorOwner(env: Env, user: UserRecord, profileId: string): Promise<ProfileRow> {
  const row = await env.DB.prepare(`${PROFILE_SELECT} WHERE p.id=? AND p.user_id=?`).bind(profileId, user.id).first<ProfileRow>();
  if (!row && !isSuper(user)) throw new ApiError(404, "创作者不存在或无法修改。");
  if (!row) throw new ApiError(404, "创作者不存在。");
  return row;
}
async function readUser(request: Request, env: Env): Promise<UserRecord | null> { return currentUser(request, env); }
async function requireWrite(request: Request, env: Env): Promise<UserRecord> {
  const user = await requireUser(request, env);
  if (user.isGuest) throw new ApiError(403, "请注册或登录正式账户后操作创作者社区。");
  await rateLimit(request, env, "creator-community-account", 120, user.id);
  await rateLimit(request, env, "creator-community-ip", 300);
  return user;
}
async function createProfile(request: Request, env: Env, user: UserRecord) {
  const body = record(await readJson(request, 64 * 1024));
  const displayName = text(body.displayName, "创作者名称", 60);
  const bio = text(body.bio, "简介", 2000, false);
  const avatarUrl = text(body.avatarUrl, "头像地址", 2048, false);
  const coverUrl = text(body.coverUrl, "封面地址", 2048, false);
  const now = Date.now();
  const existing = await ownerProfile(env, user);
  if (existing) throw new ApiError(409, "你已经有创作者资料，请使用修改接口。");
  const profileId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO creator_profiles(id,user_id,display_name,bio,avatar_url,cover_url,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?, 'pending', ?, ?)`)
    .bind(profileId, user.id, displayName, bio, avatarUrl, coverUrl, now, now).run();
  return json({ profile: profileView({ id: profileId, user_id: user.id, display_name: displayName, bio, avatar_url: avatarUrl, cover_url: coverUrl, status: "pending", review_reason: "", created_at: now, updated_at: now, reviewed_at: null }, true) }, 201);
}
async function updateProfile(request: Request, env: Env, user: UserRecord) {
  const profile = await ownerProfile(env, user);
  if (!profile) throw new ApiError(404, "请先创建创作者资料。");
  const body = record(await readJson(request, 64 * 1024));
  const displayName = body.displayName === undefined ? profile.display_name : text(body.displayName, "创作者名称", 60);
  const bio = body.bio === undefined ? profile.bio : text(body.bio, "简介", 2000, false);
  const avatarUrl = body.avatarUrl === undefined ? profile.avatar_url : text(body.avatarUrl, "头像地址", 2048, false);
  const coverUrl = body.coverUrl === undefined ? profile.cover_url : text(body.coverUrl, "封面地址", 2048, false);
  const now = Date.now();
  // Profile edits reopen moderation before the updated copy is public.
  const nextStatus = profile.status === "approved" ? "pending" : profile.status === "suspended" ? "suspended" : "pending";
  await env.DB.prepare(`UPDATE creator_profiles SET display_name=?,bio=?,avatar_url=?,cover_url=?,status=?,review_reason='',updated_at=? WHERE id=? AND user_id=?`)
    .bind(displayName, bio, avatarUrl, coverUrl, nextStatus, now, profile.id, user.id).run();
  const updated = await env.DB.prepare(`${PROFILE_SELECT} WHERE p.id=?`).bind(profile.id).first<ProfileRow>();
  return json({ profile: profileView(updated!, true) });
}
async function listCreators(request: Request, env: Env) {
  const url = new URL(request.url); const { offset, limit } = pagination(url); const user = await readUser(request, env);
  const q = url.searchParams.get("q")?.trim();
  const conditions = ["p.status='approved'"]; const values: unknown[] = [];
  if (q) { if (q.length > 60 || q.includes("\0")) throw new ApiError(400, "搜索条件无效。"); conditions.push("(p.display_name LIKE ? OR p.bio LIKE ?)"); values.push(`%${q}%`, `%${q}%`); }
  const rows = await env.DB.prepare(`${PROFILE_SELECT} WHERE ${conditions.join(" AND ")} ORDER BY follower_count DESC,p.updated_at DESC,p.id LIMIT ? OFFSET ?`)
    .bind(...values, limit, offset).all<ProfileRow>();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS total FROM creator_profiles p WHERE ${conditions.join(" AND ")}`).bind(...values).first<{ total: number }>();
  // D1 does not allow a select alias in the helper query above to carry the
  // user-specific expression, so enrich follows in one bounded pass.
  const profiles = await Promise.all(rows.results.map(async row => {
    const following = user ? await env.DB.prepare("SELECT 1 AS yes FROM creator_follows WHERE creator_id=? AND user_id=?").bind(row.id, user.id).first() : null;
    return profileView({ ...row, following: following ? 1 : 0 });
  }));
  return json({ creators: profiles, total: Number(total?.total ?? 0), offset, limit, hasMore: offset + limit < Number(total?.total ?? 0) });
}
async function creatorDetail(request: Request, env: Env, profileId: string) {
  const profile = await approvedProfile(env, profileId); const user = await readUser(request, env);
  const following = user ? await env.DB.prepare("SELECT 1 AS yes FROM creator_follows WHERE creator_id=? AND user_id=?").bind(profileId, user.id).first() : null;
  const rows = await env.DB.prepare(`${POST_SELECT} WHERE p.creator_id=? AND p.status='approved' ORDER BY p.pinned DESC,p.created_at DESC,p.id LIMIT 30`).bind(profileId).all<PostRow>();
  const posts = await Promise.all(rows.results.map(async row => {
    const liked = user ? await env.DB.prepare("SELECT 1 AS yes FROM creator_post_likes WHERE post_id=? AND user_id=?").bind(row.id, user.id).first() : null;
    return postView({ ...row, liked: liked ? 1 : 0 }, false);
  }));
  return json({ creator: profileView({ ...profile, following: following ? 1 : 0 }), posts });
}
async function createPost(request: Request, env: Env, user: UserRecord, profileId: string) {
  const profile = await requireCreatorOwner(env, user, profileId);
  const body = record(await readJson(request, 256 * 1024));
  const postType = typeof body.type === "string" ? body.type : "text";
  if (!POST_TYPES.has(postType)) throw new ApiError(400, "动态类型无效。");
  const visibility = typeof body.visibility === "string" ? body.visibility : "free";
  if (!VISIBILITIES.has(visibility)) throw new ApiError(400, "动态可见范围无效。");
  const content = text(body.body, "动态正文", 12000, false);
  const media = safeMedia(body.media);
  if (!content && !media.length) throw new ApiError(400, "动态需要正文或媒体。");
  const characterPublicationId = body.characterPublicationId === undefined || body.characterPublicationId === null ? null : text(body.characterPublicationId, "角色编号", 120, false);
  const pinned = body.pinned === true ? 1 : 0;
  const now = Date.now(); const postId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO creator_posts(id,creator_id,character_publication_id,post_type,body,media_json,visibility,status,pinned,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'pending',?,?,?)`).bind(postId, profile.id, characterPublicationId, postType, content, JSON.stringify(media), visibility, pinned, now, now).run();
  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id=?`).bind(postId).first<PostRow>();
  return json({ post: postView(row!, false), moderation: "pending" }, 201);
}
async function listFeed(request: Request, env: Env) {
  const url = new URL(request.url); const { offset, limit } = pagination(url); const user = await readUser(request, env);
  const followingOnly = url.searchParams.get("following") === "1";
  let where = `p.status='approved' AND c.status='approved'`;
  const values: unknown[] = [];
  if (followingOnly) {
    if (!user) throw new ApiError(401, "请登录后查看订阅动态。");
    where += " AND EXISTS (SELECT 1 FROM creator_follows f WHERE f.creator_id=p.creator_id AND f.user_id=?)"; values.push(user.id);
  }
  const rows = await env.DB.prepare(`${POST_SELECT} WHERE ${where} ORDER BY p.pinned DESC,p.created_at DESC,p.id LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<PostRow>();
  const total = await env.DB.prepare(`SELECT COUNT(*) AS total FROM creator_posts p JOIN creator_profiles c ON c.id=p.creator_id WHERE ${where}`).bind(...values).first<{ total: number }>();
  const posts = await Promise.all(rows.results.map(async row => {
    const liked = user ? await env.DB.prepare("SELECT 1 AS yes FROM creator_post_likes WHERE post_id=? AND user_id=?").bind(row.id, user.id).first() : null;
    return postView({ ...row, liked: liked ? 1 : 0 }, false);
  }));
  return json({ posts, total: Number(total?.total ?? 0), offset, limit, hasMore: offset + limit < Number(total?.total ?? 0) });
}
async function follow(request: Request, env: Env, user: UserRecord, profileId: string, following: boolean) {
  await approvedProfile(env, profileId); const now = Date.now();
  if (following) await env.DB.prepare("INSERT OR IGNORE INTO creator_follows(creator_id,user_id,created_at) VALUES(?,?,?)").bind(profileId, user.id, now).run();
  else await env.DB.prepare("DELETE FROM creator_follows WHERE creator_id=? AND user_id=?").bind(profileId, user.id).run();
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM creator_follows WHERE creator_id=?").bind(profileId).first<{ total: number }>();
  return json({ following, followerCount: Number(row?.total ?? 0) });
}
async function subscriptionIntent(env: Env, user: UserRecord, profileId: string) {
  await approvedProfile(env, profileId); const now = Date.now();
  const result = await env.DB.prepare("INSERT OR IGNORE INTO creator_subscription_intents(creator_id,user_id,status,created_at,updated_at) VALUES(?,?, 'waiting', ?, ?)").bind(profileId, user.id, now, now).run();
  return json({ intent: "waiting", created: result.meta.changes === 1, paymentsEnabled: false, message: "订阅开放后会提醒你。" }, result.meta.changes === 1 ? 201 : 200);
}
async function toggleLike(request: Request, env: Env, user: UserRecord, postId: string, liked: boolean) {
  id(postId, "动态编号"); const exists = await env.DB.prepare("SELECT p.id FROM creator_posts p JOIN creator_profiles c ON c.id=p.creator_id WHERE p.id=? AND p.status='approved' AND c.status='approved'").bind(postId).first();
  if (!exists) throw new ApiError(404, "动态不存在或已下架。");
  if (liked) await env.DB.prepare("INSERT OR IGNORE INTO creator_post_likes(post_id,user_id,created_at) VALUES(?,?,?)").bind(postId, user.id, Date.now()).run();
  else await env.DB.prepare("DELETE FROM creator_post_likes WHERE post_id=? AND user_id=?").bind(postId, user.id).run();
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM creator_post_likes WHERE post_id=?").bind(postId).first<{ total: number }>();
  return json({ liked, likeCount: Number(count?.total ?? 0) });
}
async function moderation(request: Request, env: Env, user: UserRecord, path: string) {
  if (!isSuper(user)) throw new ApiError(403, "只有审核员可以处理创作者内容。");
  if (request.method === "GET" && path === "/moderation/queue") {
    const profiles = await env.DB.prepare(`${PROFILE_SELECT} WHERE p.status='pending' ORDER BY p.created_at ASC LIMIT 50`).all<ProfileRow>();
    const posts = await env.DB.prepare(`${POST_SELECT} WHERE p.status='pending' ORDER BY p.created_at ASC LIMIT 50`).all<PostRow>();
    return json({ profiles: profiles.results.map(row => profileView(row, true)), posts: posts.results.map(row => ({ ...postView(row, true), status: row.status, reviewReason: row.review_reason })) });
  }
  const profileMatch = /^\/moderation\/creators\/([^/]+)$/.exec(path);
  if (profileMatch && request.method === "PATCH") {
    const profileId = id(profileMatch[1], "创作者编号"); const body = record(await readJson(request, 32 * 1024));
    const status = text(body.status, "审核状态", 20); if (!PROFILE_STATUSES.has(status) || status === "pending") throw new ApiError(400, "审核状态无效。");
    const reason = text(body.reason, "审核备注", 2000, false); const now = Date.now();
    const result = await env.DB.prepare("UPDATE creator_profiles SET status=?,review_reason=?,reviewed_at=?,reviewed_by=?,updated_at=? WHERE id=?").bind(status, reason, now, user.id, now, profileId).run();
    if (!result.meta.changes) throw new ApiError(404, "创作者不存在。");
    const row = await env.DB.prepare(`${PROFILE_SELECT} WHERE p.id=?`).bind(profileId).first<ProfileRow>(); return json({ profile: profileView(row!, true) });
  }
  const postMatch = /^\/moderation\/posts\/([^/]+)$/.exec(path);
  if (postMatch && request.method === "PATCH") {
    const postId = id(postMatch[1], "动态编号"); const body = record(await readJson(request, 32 * 1024));
    const status = text(body.status, "审核状态", 20); if (!POST_STATUSES.has(status) || status === "pending") throw new ApiError(400, "审核状态无效。");
    const reason = text(body.reason, "审核备注", 2000, false); const now = Date.now();
    const result = await env.DB.prepare("UPDATE creator_posts SET status=?,review_reason=?,reviewed_at=?,reviewed_by=?,updated_at=? WHERE id=?").bind(status, reason, now, user.id, now, postId).run();
    if (!result.meta.changes) throw new ApiError(404, "动态不存在。");
    const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id=?`).bind(postId).first<PostRow>(); return json({ post: postView(row!, true) });
  }
  throw new ApiError(404, "审核接口不存在。");
}

/** First-phase creator community API. Payments and crypto remain disabled. */
export async function handleCreatorCommunity(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url); if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null;
  const path = url.pathname.slice(PREFIX.length) || "/";
  if (path === "/creators" && request.method === "GET") return listCreators(request, env);
  if (path === "/creators/me" && request.method === "GET") {
    const user = await requireUser(request, env); const profile = await ownerProfile(env, user); return json({ profile: profile ? profileView(profile, true) : null });
  }
  const detail = /^\/creators\/([^/]+)$/.exec(path);
  if (detail && request.method === "GET") { id(detail[1], "创作者编号"); return creatorDetail(request, env, detail[1]); }
  if (path === "/feed" && request.method === "GET") return listFeed(request, env);
  if (path === "/creators" && request.method === "POST") return createProfile(request, env, await requireWrite(request, env));
  if (path === "/creators/me" && (request.method === "PATCH" || request.method === "PUT")) return updateProfile(request, env, await requireWrite(request, env));
  const postCreate = /^\/creators\/([^/]+)\/posts$/.exec(path);
  if (postCreate && request.method === "POST") return createPost(request, env, await requireWrite(request, env), id(postCreate[1], "创作者编号"));
  const followMatch = /^\/creators\/([^/]+)\/follow$/.exec(path);
  if (followMatch && (request.method === "POST" || request.method === "DELETE")) return follow(request, env, await requireWrite(request, env), id(followMatch[1], "创作者编号"), request.method === "POST");
  const intentMatch = /^\/creators\/([^/]+)\/subscription-intent$/.exec(path);
  if (intentMatch && request.method === "POST") return subscriptionIntent(env, await requireWrite(request, env), id(intentMatch[1], "创作者编号"));
  const likeMatch = /^\/posts\/([^/]+)\/like$/.exec(path);
  if (likeMatch && (request.method === "POST" || request.method === "DELETE")) return toggleLike(request, env, await requireWrite(request, env), id(likeMatch[1], "动态编号"), request.method === "POST");
  if (path.startsWith("/moderation/")) return moderation(request, env, await requireUser(request, env), path);
  throw new ApiError(404, "社区接口不存在。");
}
