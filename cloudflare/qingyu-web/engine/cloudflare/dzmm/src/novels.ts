import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";
import {
  countDzmmNovelWords,
  DZMM_NOVEL_MAX_BODY_BYTES,
  parseDzmmNovelDraft,
  type DzmmNovelChapter,
  type DzmmNovelDetail,
  type DzmmNovelDraft,
  type DzmmNovelWork,
  type DzmmNovelWorkSummary,
} from "../../../src/lib/dzmm-novels";
import { parseXumengNovelCharacters } from "../../../src/lib/xumeng-performance-character";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

type Row = Record<string, unknown>;
const ROOT = "/v1/novels";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function workFromRow(row: Row): DzmmNovelWork {
  const characters = parseXumengNovelCharacters(JSON.parse(row.characters_json as string));
  return {
    id: row.id as string,
    title: row.title as string,
    synopsis: row.synopsis as string,
    type: row.type as DzmmNovelWork["type"],
    tags: JSON.parse(row.tags_json as string) as string[],
    notes: row.notes as string,
    outline: row.outline as string,
    ...(characters.length ? { characters } : {}),
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function chapterFromRow(row: Row): DzmmNovelChapter {
  return {
    id: row.id as string,
    workId: row.work_id as string,
    title: row.title as string,
    content: row.content as string,
    position: Number(row.position),
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function detailStatements(db: D1Database, accountId: string, workId: string): D1PreparedStatement[] {
  return [
    db.prepare("SELECT * FROM novels WHERE user_id=? AND id=?").bind(accountId, workId),
    db.prepare("SELECT * FROM novel_chapters WHERE user_id=? AND work_id=? ORDER BY position,id").bind(accountId, workId),
  ];
}

function detailFromResults(accountId: string, result: D1Result<Row>[]): DzmmNovelDetail | null {
  const row = result[0].results[0];
  return row ? { accountId, work: workFromRow(row), chapters: result[1].results.map(chapterFromRow) } : null;
}

export async function readNovelDetail(db: D1Database, accountId: string, workId: string): Promise<DzmmNovelDetail | null> {
  // Both SELECTs share the same D1 transaction, so a concurrent save cannot
  // produce old metadata paired with new chapters.
  return detailFromResults(accountId, await db.batch<Row>(detailStatements(db, accountId, workId)));
}

function notFound(accountId: string): ApiError {
  return new ApiError(404, "作品不存在或不属于当前账户。", { accountId });
}

function conflict(current: DzmmNovelDetail): ApiError {
  return new ApiError(409, "作品已在其他页面更新，请加载最新版本后重试。", { accountId: current.accountId, current });
}

function checkAccount(body: Row, accountId: string): void {
  if (body.accountId !== accountId) throw new ApiError(401, "当前账户已切换，请重新加载作品后再保存。", { accountId });
}

function checkKeys(body: Row, keys: string[]): void {
  if (Object.keys(body).some(key => !keys.includes(key))) throw new ApiError(400, "小说请求包含不支持的字段。");
}

function versionFromBody(body: Row): number {
  if (typeof body.version !== "number" || !Number.isSafeInteger(body.version) || body.version < 1 || body.version >= Number.MAX_SAFE_INTEGER) {
    throw new ApiError(400, "保存或删除作品必须提供有效的 version。");
  }
  return body.version;
}

function draftFromBody(body: Row): DzmmNovelDraft {
  try { return parseDzmmNovelDraft(body.work); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "作品内容无效。"); }
}

function upsertChapters(db: D1Database, accountId: string, draft: DzmmNovelDraft, token: string, now: number): D1PreparedStatement {
  const rows = JSON.stringify(draft.chapters.map((chapter, position) => ({
    ...chapter, position, word_count: countDzmmNovelWords(chapter.content),
  })));
  return db.prepare(`INSERT INTO novel_chapters(user_id,work_id,id,title,content,position,word_count,version,created_at,updated_at)
    SELECT ?1,?2,json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.content'),
      json_extract(value,'$.position'),json_extract(value,'$.word_count'),1,?5,?5
    FROM json_each(?3)
    WHERE EXISTS(SELECT 1 FROM novels WHERE user_id=?1 AND id=?2 AND mutation_token=?4)
    ON CONFLICT(user_id,work_id,id) DO UPDATE SET
      title=excluded.title,content=excluded.content,position=excluded.position,word_count=excluded.word_count,
      version=novel_chapters.version+CASE WHEN novel_chapters.title!=excluded.title OR novel_chapters.content!=excluded.content OR novel_chapters.position!=excluded.position THEN 1 ELSE 0 END,
      updated_at=CASE WHEN novel_chapters.title!=excluded.title OR novel_chapters.content!=excluded.content OR novel_chapters.position!=excluded.position THEN excluded.updated_at ELSE novel_chapters.updated_at END`)
    .bind(accountId, draft.id, rows, token, now);
}

function removeMissingChapters(db: D1Database, accountId: string, draft: DzmmNovelDraft, token: string): D1PreparedStatement {
  const ids = JSON.stringify(draft.chapters.map(chapter => chapter.id));
  return db.prepare(`DELETE FROM novel_chapters WHERE user_id=?1 AND work_id=?2
    AND NOT EXISTS(SELECT 1 FROM json_each(?3) WHERE value=novel_chapters.id)
    AND EXISTS(SELECT 1 FROM novels WHERE user_id=?1 AND id=?2 AND mutation_token=?4)`)
    .bind(accountId, draft.id, ids, token);
}

async function createNovel(db: D1Database, accountId: string, draft: DzmmNovelDraft): Promise<DzmmNovelDetail> {
  const token = crypto.randomUUID(), now = Date.now();
  const inserted = db.prepare(`INSERT INTO novels(user_id,id,title,synopsis,type,tags_json,notes,outline,characters_json,version,mutation_token,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?) ON CONFLICT(user_id,id) DO NOTHING`)
    .bind(accountId, draft.id, draft.title, draft.synopsis, draft.type, JSON.stringify(draft.tags), draft.notes, draft.outline,
      JSON.stringify(draft.characters ?? []), token, now, now);
  const result = await db.batch<Row>([inserted, upsertChapters(db, accountId, draft, token, now), ...detailStatements(db, accountId, draft.id)]);
  const current = detailFromResults(accountId, result.slice(-2));
  if (!current) throw notFound(accountId);
  if (result[0].meta.changes !== 1) throw conflict(current);
  return current;
}

async function updateNovel(db: D1Database, accountId: string, draft: DzmmNovelDraft, expected: number): Promise<DzmmNovelDetail> {
  const token = crypto.randomUUID(), now = Date.now();
  // An older editor may omit cast data. Only an explicitly supplied array
  // replaces it; [] is the intentional clear operation under the same CAS.
  const updated = db.prepare(`UPDATE novels SET title=?,synopsis=?,type=?,tags_json=?,notes=?,outline=?,characters_json=COALESCE(?,characters_json),
    version=version+1,mutation_token=?,updated_at=? WHERE user_id=? AND id=? AND version=?`)
    .bind(draft.title, draft.synopsis, draft.type, JSON.stringify(draft.tags), draft.notes, draft.outline,
      draft.characters === undefined ? null : JSON.stringify(draft.characters), token, now, accountId, draft.id, expected);
  const result = await db.batch<Row>([
    updated, removeMissingChapters(db, accountId, draft, token), upsertChapters(db, accountId, draft, token, now),
    ...detailStatements(db, accountId, draft.id),
  ]);
  const current = detailFromResults(accountId, result.slice(-2));
  if (!current) throw notFound(accountId);
  if (result[0].meta.changes !== 1) throw conflict(current);
  return current;
}

async function deleteNovel(db: D1Database, accountId: string, workId: string, expected: number): Promise<void> {
  const result = await db.batch<Row>([
    db.prepare("DELETE FROM novels WHERE user_id=? AND id=? AND version=? RETURNING id").bind(accountId, workId, expected),
    ...detailStatements(db, accountId, workId),
  ]);
  // D1's changes metadata includes cascaded chapter deletions. RETURNING
  // identifies the single parent row that passed the ownership/version CAS.
  if (result[0].results.length === 1) return;
  const current = detailFromResults(accountId, result.slice(-2));
  if (!current) throw notFound(accountId);
  throw conflict(current);
}

export async function handleNovels(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  // Identify the namespace before reading any request body or account state.
  if (path !== ROOT && !path.startsWith(`${ROOT}/`)) return null;
  try {
    const route = /^\/v1\/novels(?:\/([^/]+))?$/.exec(path);
    if (!route) throw notFound(user.id);
    let workId: string | undefined;
    if (route[1]) {
      try { workId = decodeURIComponent(route[1]); } catch { throw new ApiError(400, "作品 ID 无效。"); }
      if (!ID_PATTERN.test(workId)) throw new ApiError(400, "作品 ID 无效。");
    }
    if (request.method === "GET") {
      if (workId) {
        const current = await readNovelDetail(env.DB, user.id, workId);
        if (!current) throw notFound(user.id);
        return json(current);
      }
      const { results } = await env.DB.prepare(`SELECT novels.*,
        (SELECT COUNT(*) FROM novel_chapters WHERE user_id=novels.user_id AND work_id=novels.id) AS chapter_count,
        COALESCE((SELECT SUM(word_count) FROM novel_chapters WHERE user_id=novels.user_id AND work_id=novels.id),0) AS word_count
        FROM novels WHERE user_id=? ORDER BY updated_at DESC,id`).bind(user.id).all<Row>();
      const works: DzmmNovelWorkSummary[] = results.map(row => ({
        ...workFromRow(row), chapterCount: Number(row.chapter_count), wordCount: Number(row.word_count),
      }));
      return json({ accountId: user.id, works });
    }
    if ((request.method === "POST" && !workId) || ((request.method === "PUT" || request.method === "DELETE") && workId)) {
      const body = await readJson(request, DZMM_NOVEL_MAX_BODY_BYTES);
      checkAccount(body, user.id);
      if (request.method === "DELETE") {
        checkKeys(body, ["accountId", "version"]);
        await deleteNovel(env.DB, user.id, workId!, versionFromBody(body));
        return json({ accountId: user.id, deleted: true });
      }
      checkKeys(body, request.method === "POST" ? ["accountId", "work"] : ["accountId", "version", "work"]);
      const draft = draftFromBody(body);
      if (workId && workId !== draft.id) throw new ApiError(400, "作品 ID 与请求路径不一致。");
      return request.method === "POST"
        ? json(await createNovel(env.DB, user.id, draft), 201)
        : json(await updateNovel(env.DB, user.id, draft, versionFromBody(body)));
    }
    throw new ApiError(405, "当前作品接口不支持此操作。", { accountId: user.id });
  } catch (error) {
    if (error instanceof ApiError) throw new ApiError(error.status, error.message, { ...error.details, accountId: user.id });
    throw new ApiError(500, "服务暂时不可用，请稍后重试。", { accountId: user.id });
  }
}
