import { sniffStoredImage } from "./cover-mirror";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";
import { isCustomTemplateAspectRatio } from "../../../src/lib/xumeng-custom-templates";

const MAX_POSTER_BYTES = 5_000_000;
const MAX_VIDEO_BYTES = 25_000_000;
const TEMPLATE_ID_RE = /^tpl_[a-z0-9]{6,24}$/;

type TemplateRow = {
  id: string;
  kind: "image" | "video";
  label: string;
  english_label: string;
  description: string;
  group_label: string;
  tags_json: string;
  aspect_ratio: string;
  prompt_pattern: string;
  poster_key: string | null;
  poster_content_type: string | null;
  video_key: string | null;
  video_content_type: string | null;
  sort_order: number;
  enabled: number;
  created_at: number;
  updated_at: number;
  updated_by: string;
};

function posterUrl(id: string, updatedAt: number): string {
  return `/api/backend/v1/generation-templates/${id}/poster?v=${updatedAt}`;
}

function videoUrl(id: string, updatedAt: number): string {
  return `/api/backend/v1/generation-templates/${id}/video?v=${updatedAt}`;
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function serializeTemplate(row: TemplateRow) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    englishLabel: row.english_label,
    description: row.description,
    groupLabel: row.group_label,
    tags: parseTags(row.tags_json),
    aspectRatio: row.aspect_ratio,
    promptPattern: row.prompt_pattern,
    demoPosterUrl: row.poster_key ? posterUrl(row.id, row.updated_at) : null,
    demoVideoUrl: row.video_key ? videoUrl(row.id, row.updated_at) : null,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeTemplateId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `tpl_${hex}`;
}

async function readBodyBytes(request: Request, maxBytes: number, emptyMessage: string, tooLargeMessage: string): Promise<Uint8Array> {
  if (!request.body) throw new ApiError(400, emptyMessage);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, tooLargeMessage);
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!length) throw new ApiError(400, emptyMessage);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function sniffVideo(bytes: Uint8Array): { type: "video/mp4" | "video/webm"; extension: ".mp4" | ".webm" } | null {
  if (bytes.byteLength >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return { type: "video/mp4", extension: ".mp4" };
  }
  if (bytes.byteLength >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { type: "video/webm", extension: ".webm" };
  }
  return null;
}

function parseTemplateInput(body: unknown, partial: boolean) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "模板参数无效。");
  const raw = body as Record<string, unknown>;
  const out: {
    kind?: "image" | "video";
    label?: string;
    englishLabel?: string;
    description?: string;
    groupLabel?: string;
    tags?: string[];
    aspectRatio?: string;
    promptPattern?: string;
    sortOrder?: number;
    enabled?: boolean;
  } = {};

  if (!partial || raw.kind !== undefined) {
    if (raw.kind !== "image" && raw.kind !== "video") throw new ApiError(400, "模板类型只能是图片或视频。");
    out.kind = raw.kind;
  }
  if (!partial || raw.label !== undefined) {
    if (typeof raw.label !== "string" || !raw.label.trim() || raw.label.trim().length > 60) {
      throw new ApiError(400, "模板名称必填，且不超过 60 字。");
    }
    out.label = raw.label.trim();
  }
  if (!partial || raw.englishLabel !== undefined) {
    if (raw.englishLabel !== undefined && (typeof raw.englishLabel !== "string" || raw.englishLabel.trim().length > 80)) {
      throw new ApiError(400, "英文名不能超过 80 字。");
    }
    out.englishLabel = typeof raw.englishLabel === "string" ? raw.englishLabel.trim() : "";
  }
  if (!partial || raw.description !== undefined) {
    if (raw.description !== undefined && (typeof raw.description !== "string" || raw.description.trim().length > 240)) {
      throw new ApiError(400, "模板说明不能超过 240 字。");
    }
    out.description = typeof raw.description === "string" ? raw.description.trim() : "";
  }
  if (!partial || raw.groupLabel !== undefined) {
    if (raw.groupLabel !== undefined && (typeof raw.groupLabel !== "string" || raw.groupLabel.trim().length > 24)) {
      throw new ApiError(400, "分组名称不能超过 24 字。");
    }
    out.groupLabel = typeof raw.groupLabel === "string" && raw.groupLabel.trim() ? raw.groupLabel.trim() : "自定义精选";
  }
  if (!partial || raw.tags !== undefined) {
    const source = Array.isArray(raw.tags)
      ? raw.tags
      : typeof raw.tags === "string"
        ? raw.tags.split(/[,，\s]+/)
        : [];
    const cleaned = Array.from(new Set(source
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(item => item.length > 0 && item.length <= 24))).slice(0, 12);
    out.tags = cleaned;
  }
  if (!partial || raw.aspectRatio !== undefined) {
    const ratio = typeof raw.aspectRatio === "string" && raw.aspectRatio.trim() ? raw.aspectRatio.trim() : (out.kind === "video" ? "9:16" : "3:4");
    if (!isCustomTemplateAspectRatio(ratio)) throw new ApiError(400, "画面比例不支持。");
    out.aspectRatio = ratio;
  }
  if (!partial || raw.promptPattern !== undefined) {
    if (typeof raw.promptPattern !== "string" || !raw.promptPattern.trim() || raw.promptPattern.trim().length > 4000) {
      throw new ApiError(400, "模板提示词必填，且不超过 4000 字。");
    }
    out.promptPattern = raw.promptPattern.trim();
  }
  if (!partial || raw.sortOrder !== undefined) {
    const n = raw.sortOrder === undefined ? 100 : Number(raw.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 99999) throw new ApiError(400, "排序权重需为 0 到 99999 的整数。");
    out.sortOrder = n;
  }
  if (!partial || raw.enabled !== undefined) {
    out.enabled = raw.enabled === undefined ? true : Boolean(raw.enabled);
  }
  return out;
}

export async function listPublicGenerationTemplates(env: Env): Promise<Response> {
  try {
    const listed = await env.DB.prepare(
      "SELECT * FROM custom_generation_templates WHERE enabled = 1 ORDER BY sort_order ASC, updated_at DESC LIMIT 200",
    ).all<TemplateRow>();
    return json({ templates: listed.results.map(serializeTemplate) });
  } catch {
    return json({ templates: [] });
  }
}

export async function publicGenerationTemplateMedia(
  request: Request,
  env: Env,
  id: string,
  asset: "poster" | "video",
): Promise<Response | null> {
  if (!TEMPLATE_ID_RE.test(id) || !env.MEDIA) return null;
  let row: TemplateRow | null = null;
  try {
    row = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>();
  } catch {
    return null;
  }
  if (!row) return null;
  const key = asset === "poster" ? row.poster_key : row.video_key;
  const contentType = asset === "poster" ? row.poster_content_type : row.video_content_type;
  if (!key || !contentType) return null;

  const rangeHeader = asset === "video" ? request.headers.get("Range") : null;
  const object = rangeHeader
    ? await env.MEDIA.get(key, { range: request.headers })
    : await env.MEDIA.get(key);
  if (!object) return null;

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  if (rangeHeader && object.range && "offset" in object.range && typeof object.range.offset === "number" && typeof object.range.length === "number") {
    const start = object.range.offset;
    const end = start + object.range.length - 1;
    headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
    headers.set("Content-Length", String(object.range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

export async function handleAdminGenerationTemplates(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (path === "/v1/admin/generation-templates" && request.method === "GET") {
    try {
      const listed = await env.DB.prepare(
        "SELECT * FROM custom_generation_templates ORDER BY sort_order ASC, updated_at DESC LIMIT 200",
      ).all<TemplateRow>();
      return json({ accountId: user.id, templates: listed.results.map(serializeTemplate) });
    } catch {
      throw new ApiError(503, "自定义模板还没建表，请先执行数据库迁移。");
    }
  }

  if (path === "/v1/admin/generation-templates" && request.method === "POST") {
    const body = await readJson(request);
    const input = parseTemplateInput(body, false);
    const id = makeTemplateId();
    const now = Date.now();
    try {
      await env.DB.prepare(`INSERT INTO custom_generation_templates(
        id, kind, label, english_label, description, group_label, tags_json, aspect_ratio,
        prompt_pattern, sort_order, enabled, created_at, updated_at, updated_by
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        id,
        input.kind!,
        input.label!,
        input.englishLabel ?? "",
        input.description ?? "",
        input.groupLabel ?? "自定义精选",
        JSON.stringify(input.tags ?? []),
        input.aspectRatio ?? "3:4",
        input.promptPattern!,
        input.sortOrder ?? 100,
        input.enabled ? 1 : 0,
        now,
        now,
        user.id,
      ).run();
      const created = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>();
      if (!created) throw new ApiError(500, "模板创建后读取失败。");
      return json({ accountId: user.id, template: serializeTemplate(created) }, 201);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "自定义模板还没建表，请先执行数据库迁移。");
    }
  }

  const updateMatch = /^\/v1\/admin\/generation-templates\/([^/]+)$/.exec(path);
  if (updateMatch && (request.method === "PATCH" || request.method === "POST")) {
    const id = decodeURIComponent(updateMatch[1]);
    if (!TEMPLATE_ID_RE.test(id)) throw new ApiError(404, "模板不存在。");
    let existing: TemplateRow | null = null;
    try {
      existing = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>();
    } catch {
      throw new ApiError(503, "自定义模板还没建表。");
    }
    if (!existing) throw new ApiError(404, "模板不存在。");
    const body = await readJson(request);
    const patch = parseTemplateInput(body, true);
    const now = Date.now();
    await env.DB.prepare(`UPDATE custom_generation_templates SET
      kind=?, label=?, english_label=?, description=?, group_label=?, tags_json=?, aspect_ratio=?,
      prompt_pattern=?, sort_order=?, enabled=?, updated_at=?, updated_by=?
      WHERE id=?`).bind(
      patch.kind ?? existing.kind,
      patch.label ?? existing.label,
      patch.englishLabel ?? existing.english_label,
      patch.description ?? existing.description,
      patch.groupLabel ?? existing.group_label,
      patch.tags ? JSON.stringify(patch.tags) : existing.tags_json,
      patch.aspectRatio ?? existing.aspect_ratio,
      patch.promptPattern ?? existing.prompt_pattern,
      patch.sortOrder ?? existing.sort_order,
      patch.enabled === undefined ? existing.enabled : (patch.enabled ? 1 : 0),
      now,
      user.id,
      id,
    ).run();
    const updated = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>();
    if (!updated) throw new ApiError(500, "模板更新后读取失败。");
    return json({ accountId: user.id, template: serializeTemplate(updated) });
  }

  const posterMatch = /^\/v1\/admin\/generation-templates\/([^/]+)\/poster$/.exec(path);
  if (posterMatch && request.method === "POST") {
    const id = decodeURIComponent(posterMatch[1]);
    if (!TEMPLATE_ID_RE.test(id)) throw new ApiError(404, "模板不存在。");
    if (!env.MEDIA) throw new ApiError(503, "媒体存储还没接上。");
    const existing = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>().catch(() => null);
    if (!existing) throw new ApiError(404, "模板不存在。");
    const bytes = await readBodyBytes(request, MAX_POSTER_BYTES, "请选择模板封面图。", "封面图片不能超过 5 MB。");
    const sniffed = sniffStoredImage(bytes);
    if (!sniffed || (sniffed.type !== "image/jpeg" && sniffed.type !== "image/png" && sniffed.type !== "image/webp")) {
      throw new ApiError(400, "模板封面只支持 JPG、PNG 或 WebP 格式。");
    }
    const key = `generation-templates/${id}/poster${sniffed.extension}`;
    const now = Date.now();
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: sniffed.type }, customMetadata: { templateId: id, ownerId: user.id } });
    if (existing.poster_key && existing.poster_key !== key) await env.MEDIA.delete(existing.poster_key).catch(() => undefined);
    await env.DB.prepare("UPDATE custom_generation_templates SET poster_key=?, poster_content_type=?, updated_at=?, updated_by=? WHERE id=?")
      .bind(key, sniffed.type, now, user.id, id).run();
    const updated = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>();
    if (!updated) throw new ApiError(500, "封面上传后读取失败。");
    return json({ accountId: user.id, template: serializeTemplate(updated) });
  }

  const videoMatch = /^\/v1\/admin\/generation-templates\/([^/]+)\/video$/.exec(path);
  if (videoMatch && request.method === "POST") {
    const id = decodeURIComponent(videoMatch[1]);
    if (!TEMPLATE_ID_RE.test(id)) throw new ApiError(404, "模板不存在。");
    if (!env.MEDIA) throw new ApiError(503, "媒体存储还没接上。");
    const existing = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>().catch(() => null);
    if (!existing) throw new ApiError(404, "模板不存在。");
    const bytes = await readBodyBytes(request, MAX_VIDEO_BYTES, "请选择动效预览视频。", "动效预览视频不能超过 25 MB。");
    const sniffed = sniffVideo(bytes);
    if (!sniffed) throw new ApiError(400, "动效预览只支持 MP4 或 WebM 视频格式。");
    const key = `generation-templates/${id}/video${sniffed.extension}`;
    const now = Date.now();
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: sniffed.type }, customMetadata: { templateId: id, ownerId: user.id } });
    if (existing.video_key && existing.video_key !== key) await env.MEDIA.delete(existing.video_key).catch(() => undefined);
    await env.DB.prepare("UPDATE custom_generation_templates SET video_key=?, video_content_type=?, updated_at=?, updated_by=? WHERE id=?")
      .bind(key, sniffed.type, now, user.id, id).run();
    const updated = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>();
    if (!updated) throw new ApiError(500, "动效视频上传后读取失败。");
    return json({ accountId: user.id, template: serializeTemplate(updated) });
  }

  const clearVideoMatch = /^\/v1\/admin\/generation-templates\/([^/]+)\/video\/delete$/.exec(path);
  if (clearVideoMatch && request.method === "POST") {
    const id = decodeURIComponent(clearVideoMatch[1]);
    if (!TEMPLATE_ID_RE.test(id)) throw new ApiError(404, "模板不存在。");
    const existing = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>().catch(() => null);
    if (!existing) throw new ApiError(404, "模板不存在。");
    const now = Date.now();
    await env.DB.prepare("UPDATE custom_generation_templates SET video_key=NULL, video_content_type=NULL, updated_at=?, updated_by=? WHERE id=?")
      .bind(now, user.id, id).run();
    if (existing.video_key && env.MEDIA) await env.MEDIA.delete(existing.video_key).catch(() => undefined);
    const updated = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>();
    return json({ accountId: user.id, template: updated ? serializeTemplate(updated) : null });
  }

  const deleteMatch = /^\/v1\/admin\/generation-templates\/([^/]+)\/delete$/.exec(path);
  if (deleteMatch && request.method === "POST") {
    const id = decodeURIComponent(deleteMatch[1]);
    if (!TEMPLATE_ID_RE.test(id)) throw new ApiError(404, "模板不存在。");
    const existing = await env.DB.prepare("SELECT * FROM custom_generation_templates WHERE id = ?").bind(id).first<TemplateRow>().catch(() => null);
    if (!existing) throw new ApiError(404, "模板不存在。");
    await env.DB.prepare("DELETE FROM custom_generation_templates WHERE id = ?").bind(id).run();
    if (env.MEDIA) {
      if (existing.poster_key) await env.MEDIA.delete(existing.poster_key).catch(() => undefined);
      if (existing.video_key) await env.MEDIA.delete(existing.video_key).catch(() => undefined);
    }
    return json({ accountId: user.id, deleted: id });
  }

  return null;
}
