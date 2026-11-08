import { MAX_MIRROR_BYTES, pendingRemoteSlots, sniffStoredImage } from "./cover-mirror";
import { readCardDerivative, washCardDerivative } from "./cover-rendition";
import { publishedMediaSlot } from "../../../src/lib/xumeng-cover-rendition";
import { DEFAULT_DZMM_CHARACTER_COVER, DZMM_CHARACTER_CARD_MAX_BYTES, DZMM_CHARACTERS, isDzmmListedCharacter, parseCharacterImport, type Character } from "../../../src/lib/dzmm-characters";
import { DZMM_PUBLIC_INTRODUCTION_IDS } from "../../../src/lib/dzmm-public-introduction-ids";
import { dzmmLocalLook } from "../../../src/lib/dzmm-local-looks";
import { parseDzmmCatalogQuery, toDzmmCatalogCard, type DzmmCatalogSort } from "../../../src/lib/dzmm-public-shelf";
import type { DzmmPublication, DzmmPublishingSubmission, DzmmPublishedCharacter, DzmmSubmissionStatus } from "../../../src/lib/dzmm-publishing";
import { requireUser, rateLimit } from "./auth";
import { listedOfficialCards } from "./ops-console";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const PUBLICATION_ID = /^published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STATIC_IDS = new Set([...DZMM_CHARACTERS.map((character) => character.id), ...DZMM_PUBLIC_INTRODUCTION_IDS]);
const STATIC_COVERS = new Set([
  DEFAULT_DZMM_CHARACTER_COVER,
  ...DZMM_CHARACTERS.map((character) => character.cover),
  ...[...DZMM_PUBLIC_INTRODUCTION_IDS].map((id) => `/dzmm/covers/${id}.webp`),
]);
const MAX_SNAPSHOT_BYTES = DZMM_CHARACTER_CARD_MAX_BYTES;
const PUBLISH_SNAPSHOT_MAX_BYTES = 1_800_000;
const PREFIX = "/api/dzmm/backend/v1/publishing";
type MediaMap = Record<string, string>;
type PublicationRow = { id: string; user_id: string; display_heat: number; display_likes: number; private_character_id: string; version: number; current_revision: number; approved_revision: number | null; is_listed: number; mutation_token: string; created_at: number; updated_at: number };
type SubmissionRow = { id: string; publication_id: string; revision: number; status: DzmmSubmissionStatus; snapshot_json: string; private_media_json: string; published_media_json: string; review_reason: string; created_at: number; reviewed_at: number | null; user_id: string; nickname: string; version: number; is_listed: number; approved_revision: number | null; display_heat: number; display_likes: number };
type MinePublicationRow = SubmissionRow & { private_character_id: string; current_revision: number; publication_created_at: number; publication_updated_at: number };
const SUBMISSIONS = `SELECT s.*,p.user_id,p.version,p.is_listed,p.approved_revision,p.display_heat,p.display_likes,u.nickname FROM character_submissions s
  JOIN character_publications p ON p.id=s.publication_id JOIN users u ON u.id=p.user_id`;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "角色快照必须是 JSON 对象。");
  return value as Record<string, unknown>;
}
function publicationId(value: string): string {
  if (!PUBLICATION_ID.test(value)) throw new ApiError(400, "公开角色编号无效。");
  return value;
}
function submissionId(value: string): string {
  if (!UUID.test(value)) throw new ApiError(400, "投稿编号无效。");
  return value;
}
function expectedVersion(body: Record<string, unknown>): number {
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 0) throw new ApiError(400, "请提供当前发布版本。");
  return Number(body.version);
}
function checkAccount(body: Record<string, unknown>, user: UserRecord) {
  if (body.accountId !== undefined && body.accountId !== user.id) throw new ApiError(401, "账号已切换，请在当前账号中重新操作。");
}
function pagination(url: URL, defaultLimit = 20, maxLimit = 50) {
  const read = (key: string, fallback: number, min: number, max: number) => {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new ApiError(400, "分页参数无效。");
    return Number(raw);
  };
  return { offset: read("offset", 0, 0, 100000), limit: read("limit", defaultLimit, 1, maxLimit) };
}
function isSuper(user: UserRecord): boolean { return !user.isGuest && user.role === "super"; }
function assertOwner(ownerId: string, user: UserRecord, allowSuper = false) {
  if (ownerId !== user.id && !(allowSuper && isSuper(user))) throw new ApiError(404, "投稿不存在或无法访问。");
}
function conflict(version?: number): never {
  throw new ApiError(409, "发布状态已改变，请刷新投稿后重试。", version === undefined ? undefined : { version });
}
async function requireWrite(request: Request, env: Env, user: UserRecord) {
  if (user.isGuest) throw new ApiError(403, "请注册或登录正式账户后提交角色。");
  await rateLimit(request, env, "publishing-write-account", 120, user.id);
  await rateLimit(request, env, "publishing-write-ip", 300);
}
function submissionCharacter(snapshot: string): Character & { gallery?: string[] } {
  const character = JSON.parse(snapshot);
  // Editor-only drafts must never be exposed through review or public reads,
  // including snapshots written by an earlier version of the application.
  delete character.authoringDraft;
  return character;
}
function toSubmission(row: SubmissionRow): DzmmPublishingSubmission {
  const character = submissionCharacter(row.snapshot_json);
  const media = JSON.parse(row.private_media_json) as MediaMap;
  return { id: row.id, publicationId: row.publication_id, revision: row.revision, status: row.status,
    character, author: { id: row.user_id, nickname: row.nickname }, reason: row.review_reason,
    createdAt: row.created_at, reviewedAt: row.reviewed_at, publicationVersion: row.version,
    isListed: row.is_listed === 1, approvedRevision: row.approved_revision,
    displayHeat: Number(row.display_heat) || 0, displayLikes: Number(row.display_likes) || 0,
    previewCoverUrl: media.cover ? `${PREFIX}/submissions/${row.id}/media/cover` : character.cover,
    ...(character.gallery ? { previewGalleryUrls: character.gallery.map((path, index) => media[`gallery-${index}`] ? `${PREFIX}/submissions/${row.id}/media/gallery-${index}` : path) } : {}) };
}
async function getSubmission(env: Env, id: string): Promise<SubmissionRow> {
  const row = await env.DB.prepare(`${SUBMISSIONS} WHERE s.id=?`).bind(id).first<SubmissionRow>();
  if (!row) throw new ApiError(404, "投稿不存在。");
  return row;
}
async function getPublication(env: Env, id: string): Promise<PublicationRow> {
  const row = await env.DB.prepare("SELECT * FROM character_publications WHERE id=?").bind(id).first<PublicationRow>();
  if (!row) throw new ApiError(404, "公开角色不存在。");
  return row;
}
async function toPublication(env: Env, row: PublicationRow): Promise<DzmmPublication> {
  const latest = await env.DB.prepare(`${SUBMISSIONS} WHERE s.publication_id=? AND s.revision=?`).bind(row.id, row.current_revision).first<SubmissionRow>();
  if (!latest) throw new ApiError(500, "投稿状态暂时无法读取。");
  return { id: row.id, ownerId: row.user_id, privateCharacterId: row.private_character_id, version: row.version,
    currentRevision: row.current_revision, approvedRevision: row.approved_revision, isListed: row.is_listed === 1,
    createdAt: row.created_at, updatedAt: row.updated_at, latestSubmission: toSubmission(latest) };
}
function minePublication(row: MinePublicationRow): DzmmPublication {
  return { id: row.publication_id, ownerId: row.user_id, privateCharacterId: row.private_character_id, version: row.version,
    currentRevision: row.current_revision, approvedRevision: row.approved_revision, isListed: row.is_listed === 1,
    createdAt: row.publication_created_at, updatedAt: row.publication_updated_at, latestSubmission: toSubmission(row) };
}
async function result(env: Env, id: string, submittedId: string) {
  const publication = await toPublication(env, await getPublication(env, id));
  return { publication, submission: toSubmission(await getSubmission(env, submittedId)) };
}
function displayCount(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1).replace(/\.0$/, "")}万`;
  return String(value);
}
function displayStats(body: Record<string, unknown>): { heat: number; likes: number } | null {
  if (body.displayHeat === undefined && body.displayLikes === undefined) return null;
  const read = (value: unknown) => {
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100_000_000) throw new ApiError(400, "初始热度和点赞须为 0 到 1 亿之间的整数。");
    return Number(value);
  };
  return { heat: read(body.displayHeat ?? 0), likes: read(body.displayLikes ?? 0) };
}
const PRIVATE_PLAY_FIELDS = ["systemPrompt", "postHistoryInstructions", "messageExamples", "characterBook"] as const;

function publicCharacter(row: SubmissionRow): DzmmPublishedCharacter {
  const card = submissionCharacter(row.snapshot_json);
  const visible = { ...card };
  for (const field of PRIVATE_PLAY_FIELDS) delete visible[field];
  const media = JSON.parse(row.published_media_json) as MediaMap;
  return { ...visible, id: row.publication_id, author: card.author?.trim() || row.nickname, heat: displayCount(Number(row.display_heat) || 0), likes: String(Number(row.display_likes) || 0),
    sourceKind: "original", promptOrigin: "original", sourceUrl: "", createdAt: new Date(row.reviewed_at ?? row.created_at).toISOString(),
    cover: media.cover ? `${PREFIX}/media/${row.publication_id}/${row.revision}/cover` : card.cover,
    ...(card.gallery ? { gallery: card.gallery.map((path, index) => media[`gallery-${index}`] ? `${PREFIX}/media/${row.publication_id}/${row.revision}/gallery-${index}` : path) } : {}),
    publication: { id: row.publication_id, authorId: row.user_id, revision: row.revision, publishedAt: row.reviewed_at ?? row.created_at } };
}

const CATALOG_ORDER: Record<DzmmCatalogSort, string> = {
  hot: "p.display_heat DESC, p.updated_at DESC, p.id",
  new: "COALESCE(s.reviewed_at, p.created_at) DESC, p.id",
  likes: "p.display_likes DESC, p.updated_at DESC, p.id",
  name: "json_extract(s.snapshot_json, '$.name') COLLATE NOCASE, p.id",
};

function catalogWhere(query: ReturnType<typeof parseDzmmCatalogQuery>): { sql: string; bindings: unknown[] } {
  const where = ["p.is_listed=1", "s.status='approved'", "s.revision=p.approved_revision"];
  const bindings: unknown[] = [];
  if (query.q) {
    where.push(`(instr(lower(coalesce(json_extract(s.snapshot_json,'$.name'),'')), ?)
      OR instr(lower(coalesce(json_extract(s.snapshot_json,'$.author'), u.nickname, '')), ?)
      OR instr(lower(coalesce(json_extract(s.snapshot_json,'$.description'),'')), ?)
      OR EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(json_extract(s.snapshot_json,'$.tags'))='array' THEN json_extract(s.snapshot_json,'$.tags') ELSE '[]' END) tag WHERE instr(lower(tag.value), ?)))`);
    bindings.push(query.q, query.q, query.q, query.q);
  }
  if (query.tags.length) {
    where.push(`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(json_extract(s.snapshot_json,'$.tags'))='array' THEN json_extract(s.snapshot_json,'$.tags') ELSE '[]' END) tag WHERE tag.value IN (${query.tags.map(() => "?").join(",")}))`);
    bindings.push(...query.tags);
  }
  if (query.authorIds.length) {
    where.push(`p.user_id IN (${query.authorIds.map(() => "?").join(",")})`);
    bindings.push(...query.authorIds);
  }
  if (query.ids.length) {
    where.push(`p.id IN (${query.ids.map(() => "?").join(",")})`);
    bindings.push(...query.ids);
  }
  if (query.since !== null) {
    where.push("COALESCE(s.reviewed_at, p.created_at) >= ?");
    bindings.push(query.since);
  }
  if (query.look) {
    // A recorded look is exact. Cards with no look row stay visible so a style
    // tag does not wipe the catalog before looks are backfilled.
    where.push(`(
      EXISTS (SELECT 1 FROM character_looks l WHERE l.publication_id = p.id AND l.look = ?)
      OR NOT EXISTS (SELECT 1 FROM character_looks l WHERE l.publication_id = p.id)
    )`);
    bindings.push(query.look);
  }
  return { sql: where.join(" AND "), bindings };
}

/** Publication ids matching the public catalog filters. Ranking reorders this subset. */
export async function listCatalogMatchIds(env: Pick<Env, "DB">, input: {
  q?: string;
  tags?: readonly string[];
  since?: number | null;
  look?: "photo" | "anime" | null;
}): Promise<string[]> {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  if (input.tags?.length) params.set("tags", input.tags.join(","));
  if (input.since != null) params.set("since", String(input.since));
  if (input.look) params.set("look", input.look);
  params.set("limit", "50");
  params.set("sort", "new");
  let query: ReturnType<typeof parseDzmmCatalogQuery>;
  try { query = parseDzmmCatalogQuery(params); }
  catch { return []; }
  const filter = catalogWhere(query);
  const rows = await env.DB.prepare(`SELECT p.id AS id FROM character_submissions s
    JOIN character_publications p ON p.id=s.publication_id
    JOIN users u ON u.id=p.user_id
    WHERE ${filter.sql}
    LIMIT 500`).bind(...filter.bindings).all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

async function readCatalogPage(env: Env, query: ReturnType<typeof parseDzmmCatalogQuery>): Promise<Character[]> {
  const filter = catalogWhere(query);
  const rows = await env.DB.prepare(`${SUBMISSIONS} WHERE ${filter.sql} ORDER BY ${CATALOG_ORDER[query.sort]} LIMIT ? OFFSET ?`)
    .bind(...filter.bindings, query.limit, query.ids.length ? 0 : query.offset).all<SubmissionRow>();
  const characters: Character[] = rows.results.map(publicCharacter);
  if (!query.authorIds.length && characters.length < query.limit) {
    try {
      const official = (await listedOfficialCards(env)).filter(card => {
        if (query.ids.length && !query.ids.includes(card.id)) return false;
        if (query.look && dzmmLocalLook(card.id) !== query.look) return false;
        if (query.q && !`${card.name} ${card.description} ${card.tags.join(" ")}`.toLowerCase().includes(query.q.toLowerCase())) return false;
        if (query.tags.length && !query.tags.some(tag => card.tags.includes(tag))) return false;
        return true;
      });
      characters.push(...official.slice(0, query.limit - characters.length));
    } catch { /* official catalogue is optional until its table exists */ }
  }
  if (query.ids.length) {
    const rank = new Map(query.ids.map((id, index) => [id, index]));
    characters.sort((left, right) => (rank.get(left.id) ?? query.ids.length) - (rank.get(right.id) ?? query.ids.length));
  }
  return query.view === "card" ? characters.map(toDzmmCatalogCard) : characters;
}

const SITEMAP_PAGE = 1000;
const SITEMAP_CAP = 50_000;

function sitemapCoverExtension(key: unknown): "png" | "jpg" | null {
  if (typeof key !== "string") return null;
  const match = /\.(png|jpe?g)$/i.exec(key);
  if (!match) return null;
  return match[1].toLowerCase() === "png" ? "png" : "jpg";
}

function sitemapName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) return null;
  return [...name].slice(0, 80).join("");
}

/** Listed, approved revisions only. The payload is the public card title plus ids and cover types, never descriptions or snapshots. */
export async function readPublicSitemapIndex(env: Pick<Env, "DB">): Promise<{ id: string; updatedAt: number; revision: number; coverExtension: "png" | "jpg" | null; title: string | null }[]> {
  const characters: { id: string; updatedAt: number; revision: number; coverExtension: "png" | "jpg" | null; title: string | null }[] = [];
  for (let offset = 0; characters.length < SITEMAP_CAP; offset += SITEMAP_PAGE) {
    const rows = await env.DB.prepare(`SELECT p.id AS id,
        COALESCE(s.reviewed_at, p.updated_at) AS updated_at,
        s.revision AS revision,
        json_extract(s.published_media_json, '$.cover') AS cover_key,
        json_extract(s.snapshot_json, '$.name') AS name
      FROM character_submissions s
      JOIN character_publications p ON p.id = s.publication_id
      WHERE p.is_listed = 1 AND s.status = 'approved' AND s.revision = p.approved_revision
      ORDER BY p.id
      LIMIT ? OFFSET ?`).bind(SITEMAP_PAGE, offset).all<{ id: string; updated_at: number; revision: number; cover_key: string | null; name: string | null }>();
    for (const row of rows.results) {
      const updatedAt = Number(row.updated_at);
      if (!PUBLICATION_ID.test(row.id) || !Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isSafeInteger(updatedAt) || updatedAt < 0) continue;
      characters.push({ id: row.id, updatedAt, revision: row.revision, coverExtension: sitemapCoverExtension(row.cover_key), title: sitemapName(row.name) });
      if (characters.length >= SITEMAP_CAP) break;
    }
    if (rows.results.length < SITEMAP_PAGE) break;
  }
  return characters;
}

/** Only the currently listed, explicitly approved revision can enter public discovery. */
export async function readPublishedCharacters(env: Env, options: { offset?: number; limit?: number } = {}): Promise<DzmmPublishedCharacter[]> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 100));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = await env.DB.prepare(`${SUBMISSIONS} WHERE p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision
    ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?`).bind(limit, offset).all<SubmissionRow>();
  return rows.results.map(publicCharacter);
}
export async function readPublishedCharacter(env: Env, id: string): Promise<DzmmPublishedCharacter | null> {
  const row = await env.DB.prepare(`${SUBMISSIONS} WHERE p.id=? AND p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision`).bind(id).first<SubmissionRow>();
  return row ? publicCharacter(row) : null;
}
/** Logged-in chat may read the author instruction. Public catalog responses omit it. */
export async function readPublishedPlayMaterials(env: Env, id: string): Promise<Pick<Character, "systemPrompt" | "postHistoryInstructions" | "messageExamples" | "characterBook" | "interactionTemplate" | "statusBar"> | null> {
  const row = await env.DB.prepare(`SELECT s.snapshot_json FROM character_publications p JOIN character_submissions s ON s.publication_id=p.id
    WHERE p.id=? AND p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision`).bind(id).first<{ snapshot_json: string }>();
  if (!row) return null;
  const card = submissionCharacter(row.snapshot_json);
  return {
    systemPrompt: card.systemPrompt ?? "",
    postHistoryInstructions: card.postHistoryInstructions ?? "",
    messageExamples: card.messageExamples ?? "",
    ...(card.characterBook ? { characterBook: card.characterBook } : {}),
    ...(card.interactionTemplate ? { interactionTemplate: card.interactionTemplate } : {}),
    ...(card.statusBar ? { statusBar: card.statusBar } : {}),
  };
}
export async function readPublishedPlayPrompt(env: Env, id: string): Promise<string | null> {
  const row = await env.DB.prepare(`${SUBMISSIONS} WHERE p.id=? AND p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision`).bind(id).first<SubmissionRow>();
  if (!row) return null;
  return submissionCharacter(row.snapshot_json).systemPrompt ?? "";
}

type LikeRow = { character_id: string; count: number; liked: number };
function likeStats(rows: LikeRow[]): Record<string, { count: number; liked: boolean }> {
  return Object.fromEntries(rows.map((row) => [row.character_id, { count: Number(row.count) || 0, liked: Number(row.liked) === 1 }]));
}
function likeIds(value: string | null): string[] {
  if (value === null || !value.trim()) throw new ApiError(400, "请提供角色编号。");
  const ids = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 100 || ids.some((item) => item.length > 120 || item.includes("/") || item.includes("\0"))) throw new ApiError(400, "角色编号列表无效。");
  return ids;
}
async function isLikeTarget(env: Env, characterId: string): Promise<boolean> {
  if (isDzmmListedCharacter({ id: characterId })) return true;
  const row = await env.DB.prepare(`${SUBMISSIONS} WHERE p.id=? AND p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision LIMIT 1`).bind(characterId).first<{ id: string }>();
  return Boolean(row);
}
async function readLikeStats(env: Env, user: UserRecord, ids: string[]) {
  const valid: string[] = [];
  for (const characterId of ids) if (await isLikeTarget(env, characterId)) valid.push(characterId);
  if (!valid.length) return {};
  const placeholders = valid.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT character_id,COUNT(*) AS count,
    MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS liked
    FROM character_likes WHERE character_id IN (${placeholders}) GROUP BY character_id`).bind(user.id, ...valid).all<LikeRow>();
  const result = likeStats(rows.results);
  for (const characterId of valid) result[characterId] ??= { count: 0, liked: false };
  return result;
}

async function normalizeSnapshot(env: Env, user: UserRecord, value: unknown) {
  const supplied = object(value);
  if (supplied.authoringDraft !== undefined && supplied.authoringDraft !== null) {
    throw new ApiError(400, "世界书仍有未完成的私人草稿，请补全或移除未完成词条后再提交。");
  }
  if (typeof supplied.id !== "string" || !supplied.id.trim() || supplied.id.length > 120 || supplied.id.includes("\0")) throw new ApiError(400, "请提交拥有独立私人 ID 的角色草稿。");
  const privateId = supplied.id.trim();
  if (STATIC_IDS.has(privateId) || PUBLICATION_ID.test(privateId)) throw new ApiError(400, "请提交拥有独立私人 ID 的角色草稿。");
  if ((supplied.sourceKind !== undefined && supplied.sourceKind !== "original")
    || (supplied.promptOrigin !== undefined && supplied.promptOrigin !== "original")
    || (supplied.sourceUrl !== undefined && supplied.sourceUrl !== "")
    || supplied.publicIntroductionSha256 !== undefined || supplied.publication !== undefined) throw new ApiError(400, "投稿不可冒充原站来源或已审核公开角色。");
  let character: Character & { gallery?: string[] };
  try {
    if (new TextEncoder().encode(JSON.stringify(supplied)).byteLength > PUBLISH_SNAPSHOT_MAX_BYTES) throw new ApiError(413, "公开发布的角色不能超过 2 MB，请先精简世界书。");
    const runnable = { ...supplied };
    delete runnable.authoringDraft;
    character = parseCharacterImport(runnable, privateId);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, error instanceof Error ? error.message : "角色快照格式无效。");
  }
  character.author = user.nickname;
  if (!character.firstMessage.trim() && !character.openingMessages?.some((message) => message.role === "assistant" && message.content.trim())) throw new ApiError(400, "公开发布需要至少一条 AI 开场消息。");
  if (![character.description, character.personality, character.scenario, character.systemPrompt ?? ""].some((text) => text.trim())) throw new ApiError(400, "公开发布需要填写详细描述、性格、场景或系统指令中的至少一项。");
  const media: MediaMap = {};
  const paths = [{ slot: "cover", path: character.cover }, ...(character.gallery ?? []).map((path, index) => ({ slot: `gallery-${index}`, path }))];
  for (const { slot, path } of paths) {
    if (STATIC_COVERS.has(path)) continue;
    const match = /^\/api\/dzmm\/backend\/v1\/media\/([a-f0-9-]+)\/([a-f0-9-]+\.(?:png|jpg|webp|gif))$/.exec(path);
    if (!match || match[1] !== user.id) throw new ApiError(400, "公开发布图片须使用本人上传的图片或本站公共封面。");
    if (!env.MEDIA) throw new ApiError(503, "图片存储尚未启用。");
    const key = `${match[1]}/${match[2]}`;
    const stored = await env.MEDIA.head(key);
    if (!stored || stored.customMetadata?.ownerId !== user.id) throw new ApiError(400, "角色图片不存在或不属于当前账户，请重新上传。");
    media[slot] = key;
  }
  return { character, media };
}
async function copyApprovedMedia(env: Env, row: SubmissionRow) {
  const privateMedia = JSON.parse(row.private_media_json) as MediaMap;
  const copies: MediaMap = {};
  const nonce = crypto.randomUUID();
  try {
    for (const [slot, key] of Object.entries(privateMedia)) {
      if (!env.MEDIA) throw new ApiError(503, "图片存储尚未启用，无法发布上传图片。");
      const source = await env.MEDIA.get(key);
      if (!source || source.customMetadata?.ownerId !== row.user_id) throw new ApiError(409, "投稿图片已删除，请退回作者重新上传后再提交。");
      const extension = key.slice(key.lastIndexOf("."));
      const target = `published/${row.publication_id}/${row.revision}/${nonce}/${slot}${extension}`;
      await env.MEDIA.put(target, source.body, { httpMetadata: source.httpMetadata,
        customMetadata: { publicationId: row.publication_id, revision: String(row.revision) } });
      copies[slot] = target;
      try {
        const washed = await washCardDerivative(env.MEDIA, env.IMAGES, target, { publicationId: row.publication_id, revision: String(row.revision) });
        await washed?.body?.cancel();
      } catch { /* The shelf wash can retry this cover. */ }
    }
    return copies;
  } catch (error) {
    await removeCopies(env, copies);
    throw error;
  }
}
type MirrorRow = { submission_id: string; publication_id: string; revision: number; cover: string | null; gallery_json: string | null; published_media_json: string };

async function readLimitedImage(url: string): Promise<Uint8Array | null> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "image/jpeg,image/png,image/webp,image/gif", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch { return null; }
  if (!response.ok || (response.status >= 300 && response.status < 400) || !response.body) {
    await response.body?.cancel();
    return null;
  }
  const declared = Number(response.headers.get("Content-Length") || 0);
  if (declared > MAX_MIRROR_BYTES) {
    await response.body.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total <= MAX_MIRROR_BYTES) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX_MIRROR_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(step.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Copy still-hotlinked public covers into R2. The snapshot keeps its source URL; public reads use the copy. */
export async function mirrorRemoteCovers(env: Env, limit: number, after: string): Promise<{ examined: number; mirrored: number; failed: number; remaining: number; nextId: string | null }> {
  if (!env.MEDIA) throw new ApiError(503, "图片存储尚未启用。");
  const rows = await env.DB.prepare(`SELECT s.id AS submission_id,p.id AS publication_id,s.revision AS revision,
      json_extract(s.snapshot_json,'$.cover') AS cover,json_extract(s.snapshot_json,'$.gallery') AS gallery_json,s.published_media_json
    FROM character_submissions s JOIN character_publications p ON p.id=s.publication_id
    WHERE p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision AND s.revision>=1 AND p.id>?
      AND json_extract(s.snapshot_json,'$.cover') LIKE 'https://static.aiaigirl.com/%'
      AND json_type(s.published_media_json,'$.cover') IS NULL
    ORDER BY p.id LIMIT ?`).bind(after, limit).all<MirrorRow>();
  let mirrored = 0;
  let failed = 0;
  const queue = rows.results.slice();
  const nextId = queue.at(-1)?.publication_id ?? null;
  let cursor = 0;
  async function one(row: MirrorRow) {
    let gallery: unknown = null;
    if (row.gallery_json) {
      try { gallery = JSON.parse(row.gallery_json); } catch { gallery = null; }
    }
    const media = JSON.parse(row.published_media_json) as MediaMap;
    const slots = pendingRemoteSlots({ cover: row.cover, gallery }, media);
    if (!slots.some((slot) => slot.slot === "cover")) {
      failed += 1;
      return;
    }
    const nonce = crypto.randomUUID();
    const copies: MediaMap = {};
    try {
      for (const slot of slots) {
        const bytes = await readLimitedImage(slot.url);
        const image = bytes ? sniffStoredImage(bytes) : null;
        if (!bytes || !image) throw new Error("unreadable");
        const key = `published/${row.publication_id}/${row.revision}/${nonce}/${slot.slot}${image.extension}`;
        await env.MEDIA!.put(key, bytes, {
          httpMetadata: { contentType: image.type },
          customMetadata: { publicationId: row.publication_id, revision: String(row.revision) },
        });
        copies[slot.slot] = key;
      }
      const saved = await env.DB.prepare(`UPDATE character_submissions SET published_media_json=?
        WHERE id=? AND status='approved' AND json_type(published_media_json,'$.cover') IS NULL`).bind(JSON.stringify({ ...media, ...copies }), row.submission_id).run();
      if (saved.meta.changes !== 1) throw new Error("lost");
      mirrored += 1;
    } catch {
      await removeCopies(env, copies);
      failed += 1;
    }
  }
  const workers = Math.min(2, queue.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < queue.length) {
      const row = queue[cursor];
      cursor += 1;
      await one(row);
    }
  }));
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM character_submissions s
    JOIN character_publications p ON p.id=s.publication_id
    WHERE p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision
      AND json_extract(s.snapshot_json,'$.cover') LIKE 'https://static.aiaigirl.com/%'
      AND json_type(s.published_media_json,'$.cover') IS NULL`).first<{ total: number }>();
  return { examined: queue.length, mirrored, failed, remaining: Number(count?.total ?? 0), nextId };
}

type WashRow = { publication_id: string; revision: number; published_media_json: string };

/** Store a width-600 WebP beside each listed original. The original object stays. */
export async function washPublishedCovers(env: Env, limit: number, after: string): Promise<{ examined: number; washed: number; skipped: number; failed: number; remaining: number; nextId: string | null }> {
  if (!env.MEDIA || !env.IMAGES) throw new ApiError(503, "封面压缩尚未启用。");
  const rows = await env.DB.prepare(`SELECT p.id AS publication_id, s.revision AS revision, s.published_media_json
    FROM character_submissions s JOIN character_publications p ON p.id=s.publication_id
    WHERE p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision AND p.id>?
    ORDER BY p.id LIMIT ?`).bind(after, limit).all<WashRow>();
  let washed = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows.results) {
    let media: MediaMap;
    try { media = JSON.parse(row.published_media_json) as MediaMap; } catch { failed += 1; continue; }
    const expected = { publicationId: row.publication_id, revision: String(row.revision) };
    for (const [slot, key] of Object.entries(media)) {
      if (!/^(cover|gallery-\d+)$/.test(slot) || !key) continue;
      const ready = await readCardDerivative(env.MEDIA, key, expected);
      if (ready) { await ready.body?.cancel(); skipped += 1; continue; }
      const created = await washCardDerivative(env.MEDIA, env.IMAGES, key, expected);
      if (!created) { failed += 1; continue; }
      await created.body?.cancel();
      washed += 1;
    }
  }
  const nextId = rows.results.at(-1)?.publication_id ?? null;
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM character_submissions s
    JOIN character_publications p ON p.id=s.publication_id
    WHERE p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision AND p.id>?`)
    .bind(nextId ?? "\uffff").first<{ total: number }>();
  return { examined: rows.results.length, washed, skipped, failed, remaining: nextId ? Number(count?.total ?? 0) : 0, nextId };
}

async function removeCopies(env: Env, copies: MediaMap) {
  if (env.MEDIA) await Promise.allSettled(Object.values(copies).map((key) => env.MEDIA!.delete(key)));
}
async function removeUnreferencedCopies(env: Env, copies: MediaMap) {
  if (!env.MEDIA) return;
  await Promise.allSettled(Object.values(copies).map(async key => {
    let referenced;
    try {
      // A batch may commit before its response is lost. Approved snapshots also
      // retain their images for private review after replacement or takedown.
      referenced = await env.DB.prepare(`SELECT 1 AS found FROM character_submissions s,json_each(s.published_media_json) media
        WHERE s.status='approved' AND media.value=? LIMIT 1`).bind(key).first();
    } catch { return; } // Uncertain database state cannot justify deleting a possible approval.
    if (!referenced) await env.MEDIA!.delete(key);
  }));
}
async function imageResponse(env: Env, key: string, expected: { ownerId?: string; publicationId?: string; revision?: string }) {
  if (!env.MEDIA) throw new ApiError(503, "图片存储尚未启用。");
  const stored = await env.MEDIA.get(key);
  if (!stored || Object.entries(expected).some(([name, value]) => stored.customMetadata?.[name] !== value)) throw new ApiError(404, "图片不存在。");
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
  stored.writeHttpMetadata(headers); headers.set("etag", stored.httpEtag);
  return new Response(stored.body as unknown as ReadableStream<Uint8Array>, { headers });
}

/** Call before ordinary session routing: catalog, sitemap and approved-media GETs are anonymous. */
export async function handlePublishingApi(request: Request, env: Env, suppliedUser?: UserRecord | null): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/publishing" && !url.pathname.startsWith("/v1/publishing/")) return null;
  const path = url.pathname.slice("/v1/publishing".length);
  if (path === "/sitemap") {
    if (request.method !== "GET") throw new ApiError(405, "公开角色地址表仅支持 GET。");
    const characters = await readPublicSitemapIndex(env);
    return json({ characters, total: characters.length });
  }
  if (path === "/catalog") {
    if (request.method !== "GET") throw new ApiError(405, "公共目录仅支持 GET。");
    let query: ReturnType<typeof parseDzmmCatalogQuery>;
    try { query = parseDzmmCatalogQuery(url.searchParams); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "分页参数无效。"); }
    const filter = catalogWhere(query);
    const [characters, count] = await Promise.all([
      readCatalogPage(env, query),
      env.DB.prepare(`SELECT COUNT(*) AS total FROM character_submissions s JOIN character_publications p ON p.id=s.publication_id JOIN users u ON u.id=p.user_id WHERE ${filter.sql}`)
        .bind(...filter.bindings).first<{ total: number }>(),
    ]);
    const total = Number(count?.total ?? 0);
    const offset = query.ids.length ? 0 : query.offset;
    return json({
      characters, total, offset, limit: query.limit, hasMore: query.ids.length ? false : offset + query.limit < total,
      applied: { q: query.q, tags: query.tags, sort: query.sort, view: query.view, authorIds: query.authorIds, ids: query.ids, since: query.since, look: query.look },
    });
  }
  const playPrompt = /^\/catalog\/([^/]+)\/prompt$/.exec(path);
  if (playPrompt) {
    if (request.method !== "GET") throw new ApiError(405, "角色扮演指令仅支持 GET。");
    const user = suppliedUser ?? await requireUser(request, env);
    await rateLimit(request, env, "play-prompt", 120, user.id);
    const play = await readPublishedPlayMaterials(env, publicationId(playPrompt[1]));
    if (!play) throw new ApiError(404, "角色尚未发布或已下架。");
    return json(play);
  }
  const publicCard = /^\/catalog\/([^/]+)$/.exec(path);
  if (publicCard) {
    if (request.method !== "GET") throw new ApiError(405, "公共角色仅支持 GET。");
    const character = await readPublishedCharacter(env, publicationId(publicCard[1]));
    if (!character) throw new ApiError(404, "角色尚未发布或已下架。");
    return json({ character });
  }
  const likeCollection = path === "/likes";
  const likeItem = /^\/likes\/([^/]+)$/.exec(path);
  if (likeCollection || likeItem) {
    const user = suppliedUser ?? await requireUser(request, env);
    if (likeCollection) {
      if (request.method !== "GET") throw new ApiError(405, "点赞统计仅支持 GET。");
      return json({ likes: await readLikeStats(env, user, likeIds(url.searchParams.get("ids"))) });
    }
    let characterId: string;
    try { characterId = decodeURIComponent(likeItem![1]); } catch { throw new ApiError(400, "角色编号无效。"); }
    if (!characterId || characterId.length > 120 || characterId.includes("/") || !(await isLikeTarget(env, characterId))) throw new ApiError(404, "角色不存在或已下架。");
    if (request.method !== "PUT" && request.method !== "DELETE") throw new ApiError(405, "点赞仅支持 PUT 或 DELETE。");
    await rateLimit(request, env, "character-like-account", 120, user.id);
    await rateLimit(request, env, "character-like-ip", 300);
    if (request.method === "PUT") {
      await env.DB.prepare("INSERT OR IGNORE INTO character_likes(character_id,user_id,created_at) VALUES(?,?,?)").bind(characterId, user.id, Date.now()).run();
    } else {
      await env.DB.prepare("DELETE FROM character_likes WHERE character_id=? AND user_id=?").bind(characterId, user.id).run();
    }
    const stats = await readLikeStats(env, user, [characterId]);
    return json(stats[characterId] ?? { count: 0, liked: false });
  }
  const publicMedia = /^\/media\/([^/]+)\/(\d+)\/(cover(?:-card)?|gallery-\d+(?:-card)?)$/.exec(path);
  if (publicMedia) {
    if (request.method !== "GET") throw new ApiError(405, "公开图片仅支持 GET。");
    const parsed = publishedMediaSlot(publicMedia[3]);
    const id = publicationId(publicMedia[1]);
    if (!parsed || !Number.isSafeInteger(Number(publicMedia[2])) || Number(publicMedia[2]) < 1) throw new ApiError(400, "图片版本无效。");
    const row = await env.DB.prepare(`SELECT s.published_media_json, s.revision FROM character_submissions s
      JOIN character_publications p ON p.id=s.publication_id
      WHERE p.id=? AND p.is_listed=1 AND s.status='approved' AND s.revision=p.approved_revision AND s.revision=?`).bind(id, Number(publicMedia[2])).first<{ published_media_json: string; revision: number }>();
    let media: MediaMap = {};
    try { media = row ? JSON.parse(row.published_media_json) as MediaMap : {}; } catch { media = {}; }
    const key = media[parsed.name];
    if (!row || !key) throw new ApiError(404, "图片不存在或角色已下架。");
    const expected = { publicationId: id, revision: String(row.revision) };
    if (parsed.card) {
      if (!env.MEDIA) throw new ApiError(503, "图片存储尚未启用。");
      const ready = await readCardDerivative(env.MEDIA, key, expected);
      if (ready) return ready;
      const washed = await washCardDerivative(env.MEDIA, env.IMAGES, key, expected);
      if (washed) return washed;
    }
    return imageResponse(env, key, expected);
  }
  const user = suppliedUser ?? await requireUser(request, env);
  if (path === "/mirror-covers" && request.method === "POST") {
    if (!isSuper(user)) throw new ApiError(403, "仅 Super 可以把公开封面收回后端。");
    await rateLimit(request, env, "publishing-mirror-account", 4000, user.id);
    const body = await readJson(request, 1024);
    checkAccount(body, user);
    const limit = body.limit === undefined ? 8 : body.limit;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 12) throw new ApiError(400, "每次最多收回 12 张封面。");
    const after = body.after === undefined || body.after === "" ? "" : body.after;
    if (typeof after !== "string" || (after !== "" && !PUBLICATION_ID.test(after))) throw new ApiError(400, "续传编号无效。");
    return json(await mirrorRemoteCovers(env, Number(limit), after));
  }
  if (path === "/wash-covers" && request.method === "POST") {
    if (!isSuper(user)) throw new ApiError(403, "仅 Super 可以压缩公开封面。");
    if (!env.IMAGES || !env.MEDIA) throw new ApiError(503, "封面压缩尚未启用。");
    await rateLimit(request, env, "publishing-wash-account", 2000, user.id);
    const body = await readJson(request, 1024);
    checkAccount(body, user);
    const limit = body.limit === undefined ? 4 : body.limit;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 8) throw new ApiError(400, "每次最多压缩 8 个角色。");
    const after = body.after === undefined || body.after === "" ? "" : body.after;
    if (typeof after !== "string" || (after !== "" && !PUBLICATION_ID.test(after))) throw new ApiError(400, "续传编号无效。");
    return json(await washPublishedCovers(env, Number(limit), after));
  }
  if (path === "/mine" && request.method === "GET") {
    const { offset, limit } = pagination(url);
    const statuses = url.searchParams.getAll("status");
    const status = statuses[0] ?? "all";
    const conditions: Record<string, string> = {
      all: "1=1", pending: "s.status='pending'", published: "p.is_listed=1", rejected: "s.status='rejected'",
      // Withdrawing an update can leave the previous approved revision online.
      // It belongs in both the published view and the withdrawal archive.
      archived: "(s.status='withdrawn' OR (p.is_listed=0 AND s.status='approved'))",
    };
    if (statuses.length > 1 || !Object.hasOwn(conditions, status)) throw new ApiError(400, "投稿筛选状态无效。");
    const source = "FROM character_publications p JOIN character_submissions s ON s.publication_id=p.id AND s.revision=p.current_revision JOIN users u ON u.id=p.user_id";
    const where = `WHERE p.user_id=? AND ${conditions[status]}`;
    // Read the publication, its current submission and the filtered count in one
    // snapshot. A later review/re-submission must not enter a second lookup.
    const [rows, count] = await env.DB.batch([
      env.DB.prepare(`SELECT s.*,p.user_id,p.version,p.is_listed,p.approved_revision,p.display_heat,p.display_likes,u.nickname,
        p.private_character_id,p.current_revision,p.created_at AS publication_created_at,p.updated_at AS publication_updated_at
        ${source} ${where} ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?`).bind(user.id, limit, offset),
      env.DB.prepare(`SELECT COUNT(*) AS total ${source} ${where}`).bind(user.id),
    ]);
    const publications = (rows.results as MinePublicationRow[]).map(minePublication);
    const total = Number((count.results[0] as { total: number } | undefined)?.total ?? 0);
    return json({ publications, status, total, offset, limit, hasMore: offset + limit < total });
  }
  if (path === "/submissions" && request.method === "GET") {
    if (!isSuper(user)) throw new ApiError(403, "仅 Super 可以查看审核队列。");
    const { offset, limit } = pagination(url);
    const status = url.searchParams.get("status") ?? "pending";
    if (!["pending", "approved", "rejected", "withdrawn"].includes(status)) throw new ApiError(400, "审核状态无效。");
    const [rows, count] = await Promise.all([
      env.DB.prepare(`${SUBMISSIONS} WHERE s.status=? AND s.revision=p.current_revision ORDER BY s.created_at,s.id LIMIT ? OFFSET ?`).bind(status, limit, offset).all<SubmissionRow>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM character_submissions s JOIN character_publications p ON p.id=s.publication_id WHERE s.status=? AND s.revision=p.current_revision").bind(status).first<{ total: number }>(),
    ]);
    const total = Number(count?.total ?? 0);
    return json({ submissions: rows.results.map(toSubmission), total, offset, limit, hasMore: offset + limit < total });
  }
  if (path === "/submissions" && request.method === "POST") {
    await requireWrite(request, env, user);
    await rateLimit(request, env, "publishing-submit-account", 40, user.id);
    const body = await readJson(request, MAX_SNAPSHOT_BYTES + 4096);
    checkAccount(body, user);
    const { character, media } = await normalizeSnapshot(env, user, body.character);
    let previous: PublicationRow | null;
    if (body.publicationId !== undefined) {
      if (typeof body.publicationId !== "string") throw new ApiError(400, "公开角色编号无效。");
      previous = await getPublication(env, publicationId(body.publicationId));
      assertOwner(previous.user_id, user);
      if (previous.private_character_id !== character.id) throw new ApiError(400, "投稿必须对应同一私人角色草稿。");
    } else previous = await env.DB.prepare("SELECT * FROM character_publications WHERE user_id=? AND private_character_id=?").bind(user.id, character.id).first<PublicationRow>();
    const id = previous?.id ?? `published-${crypto.randomUUID()}`;
    const submission = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const now = Date.now();
    const revision = (previous?.current_revision ?? 0) + 1;
    if (previous && expectedVersion(body) !== previous.version) conflict(previous.version);
    if (!previous && body.version !== undefined && expectedVersion(body) !== 0) conflict(0);
    if (!previous) {
      const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM character_publications WHERE user_id=?").bind(user.id).first<{ total: number }>();
      if (Number(count?.total ?? 0) >= 200) throw new ApiError(400, "每个账户最多投稿 200 个角色。");
    }
    const guard = previous
      ? env.DB.prepare("UPDATE character_publications SET version=version+1,current_revision=current_revision+1,mutation_token=?,updated_at=? WHERE id=? AND user_id=? AND version=?").bind(nonce, now, id, user.id, previous.version)
      : env.DB.prepare("INSERT OR IGNORE INTO character_publications (id,user_id,private_character_id,mutation_token,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM character_publications WHERE user_id=?)<200").bind(id, user.id, character.id, nonce, now, now, user.id);
    const results = await env.DB.batch([
      guard,
      env.DB.prepare("UPDATE character_submissions SET status='withdrawn',review_reason='作者提交了新版本。',reviewed_at=? WHERE publication_id=? AND status='pending' AND EXISTS(SELECT 1 FROM character_publications WHERE id=? AND mutation_token=?)").bind(now, id, id, nonce),
      env.DB.prepare("INSERT INTO character_submissions (id,publication_id,revision,snapshot_json,private_media_json,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM character_publications WHERE id=? AND mutation_token=?)").bind(submission, id, revision, JSON.stringify(character), JSON.stringify(media), now, id, nonce),
    ]);
    if (results[0].meta.changes !== 1 || results[2].meta.changes !== 1) conflict();
    return json(await result(env, id, submission), 201);
  }
  const privateMedia = /^\/submissions\/([^/]+)\/media\/(cover|gallery-\d+)$/.exec(path);
  if (privateMedia) {
    if (request.method !== "GET") throw new ApiError(405, "审核图片仅支持 GET。");
    const row = await getSubmission(env, submissionId(privateMedia[1]));
    assertOwner(row.user_id, user, true);
    const approvedKey = row.status === "approved" ? (JSON.parse(row.published_media_json) as MediaMap)[privateMedia[2]] : undefined;
    if (approvedKey) return imageResponse(env, approvedKey, { publicationId: row.publication_id, revision: String(row.revision) });
    const key = (JSON.parse(row.private_media_json) as MediaMap)[privateMedia[2]];
    if (!key) throw new ApiError(404, "审核图片不存在。");
    return imageResponse(env, key, { ownerId: row.user_id });
  }
  const detail = /^\/submissions\/([^/]+)$/.exec(path);
  if (detail && request.method === "GET") {
    const row = await getSubmission(env, submissionId(detail[1]));
    assertOwner(row.user_id, user, true);
    return json({ submission: toSubmission(row) });
  }
  const action = /^\/submissions\/([^/]+)\/(withdraw|review)$/.exec(path);
  if (action) {
    const review = action[2] === "review";
    if (request.method !== (review ? "PATCH" : "POST")) throw new ApiError(405, "投稿操作方法无效。");
    await requireWrite(request, env, user);
    const body = await readJson(request, 8192);
    checkAccount(body, user);
    if (review && !isSuper(user)) throw new ApiError(403, "仅 Super 可以审核角色。");
    const row = await getSubmission(env, submissionId(action[1]));
    if (!review) assertOwner(row.user_id, user);
    const version = expectedVersion(body);
    const publication = await getPublication(env, row.publication_id);
    if (version !== publication.version || row.status !== "pending" || row.revision !== publication.current_revision) conflict(publication.version);
    let status: DzmmSubmissionStatus = "withdrawn";
    let reason = "作者撤回投稿。";
    if (review) {
      if (body.decision !== "approved" && body.decision !== "rejected") throw new ApiError(400, "请选择通过或退回。");
      status = body.decision;
      if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.includes("\0") || body.reason.length > 2000)) throw new ApiError(400, "审核说明不能超过 2000 字。");
      reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (status === "rejected" && !reason) throw new ApiError(400, "退回投稿时请填写修改建议。");
    }
    const stats = review && status === "approved" ? displayStats(body) : null;
    const copies = status === "approved" ? await copyApprovedMedia(env, row) : {};
    const nonce = crypto.randomUUID();
    const now = Date.now();
    try {
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE character_publications SET version=version+1,mutation_token=?,updated_at=?${status === "approved" ? ",approved_revision=?,is_listed=1" : ""}${stats ? ",display_heat=?,display_likes=?" : ""}
          WHERE id=? AND version=? AND current_revision=? AND EXISTS(SELECT 1 FROM character_submissions WHERE id=? AND status='pending')`)
          .bind(nonce, now, ...(status === "approved" ? [row.revision] : []), ...(stats ? [stats.heat, stats.likes] : []), row.publication_id, version, row.revision, row.id),
        env.DB.prepare("UPDATE character_submissions SET status=?,review_reason=?,reviewed_by=?,reviewed_at=?,published_media_json=? WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM character_publications WHERE id=? AND mutation_token=?)")
          .bind(status, reason, user.id, now, JSON.stringify(copies), row.id, row.publication_id, nonce),
      ]);
      if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) conflict();
    } catch (error) { await removeUnreferencedCopies(env, copies); throw error; }
    return json(await result(env, row.publication_id, row.id));
  }
  const statsTarget = /^\/publications\/([^/]+)\/display-stats$/.exec(path);
  if (statsTarget) {
    if (request.method !== "PATCH") throw new ApiError(405, "初始热度仅支持 PATCH。");
    await requireWrite(request, env, user);
    if (!isSuper(user)) throw new ApiError(403, "仅 Super 可以设置初始热度和点赞。");
    const body = await readJson(request, 4096);
    checkAccount(body, user);
    const id = publicationId(statsTarget[1]);
    const stats = displayStats(body);
    if (!stats) throw new ApiError(400, "请填写初始热度或点赞。");
    const updated = await env.DB.prepare("UPDATE character_publications SET display_heat=?,display_likes=? WHERE id=?").bind(stats.heat, stats.likes, id).run();
    if (updated.meta.changes !== 1) throw new ApiError(404, "公开角色不存在。");
    return json({ publication: await toPublication(env, await getPublication(env, id)) });
  }
  const unpublish = /^\/publications\/([^/]+)\/unpublish$/.exec(path);
  if (unpublish) {
    if (request.method !== "POST") throw new ApiError(405, "下架仅支持 POST。");
    await requireWrite(request, env, user);
    const body = await readJson(request, 8192);
    checkAccount(body, user);
    const id = publicationId(unpublish[1]);
    const row = await getPublication(env, id);
    assertOwner(row.user_id, user, true);
    const version = expectedVersion(body);
    if (row.version !== version || row.is_listed !== 1) conflict(row.version);
    const nonce = crypto.randomUUID();
    const now = Date.now();
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE character_publications SET is_listed=0,version=version+1,mutation_token=?,updated_at=? WHERE id=? AND version=? AND is_listed=1").bind(nonce, now, id, version),
      env.DB.prepare("UPDATE character_submissions SET status='withdrawn',review_reason='角色已下架，待审更新一并撤回。',reviewed_by=?,reviewed_at=? WHERE publication_id=? AND status='pending' AND EXISTS(SELECT 1 FROM character_publications WHERE id=? AND mutation_token=?)").bind(user.id, now, id, id, nonce),
    ]);
    if (results[0].meta.changes !== 1) conflict();
    return json({ publication: await toPublication(env, await getPublication(env, id)) });
  }
  throw new ApiError(404, "发布接口不存在。");
}
