import { selectHomeBanners, type HomeBanner, type HomeBannerAudience } from "../../../src/lib/home-banners";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";

const AUDIENCES = new Set<HomeBannerAudience>(["male", "female", "general"]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

type BannerRow = {
  id: string;
  audience: HomeBannerAudience;
  position: number;
  title: string;
  body: string;
  href: string | null;
  deleted_at: number | null;
  desktop_image: string | null;
  mobile_image: string | null;
  enabled: number;
  orientation_id: string | null;
};

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new ApiError(400, `${label}无效。`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f\u007f]/u.test(trimmed)) throw new ApiError(400, `${label}无效。`);
  return trimmed;
}

function href(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const link = text(value, 200, "链接");
  if (!link.startsWith("/") && !link.startsWith("#")) throw new ApiError(400, "横幅链接只能指向本站路径。");
  if (link.includes("\\") || link.includes("//")) throw new ApiError(400, "横幅链接只能指向本站路径。");
  return link;
}

function audience(value: unknown): HomeBannerAudience {
  if (typeof value !== "string" || !AUDIENCES.has(value as HomeBannerAudience)) throw new ApiError(400, "横幅受众无效。");
  return value as HomeBannerAudience;
}

function position(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 99) throw new ApiError(400, "横幅编号必须是 1 到 99 的整数。");
  return value as number;
}

function imageRef(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = text(value, 500, label);
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") && /\.jpe?g$/i.test(raw)) return raw;
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiError(400, `${label}需要是 jpg 地址。`); }
  if (url.protocol !== "https:" || url.username || url.password || !/\.jpe?g$/i.test(url.pathname)) throw new ApiError(400, `${label}需要是 https 的 jpg 图片。`);
  return url.toString();
}

function publicBanner(row: BannerRow) {
  return {
    id: row.id, position: row.position, title: row.title, body: row.body, href: row.href,
    ...(row.desktop_image ? { desktopImage: row.desktop_image } : {}),
    ...(row.mobile_image ? { mobileImage: row.mobile_image } : {}),
  };
}

function adminBanner(row: BannerRow) {
  return {
    ...publicBanner(row), audience: row.audience, deletedAt: row.deleted_at, enabled: row.enabled !== 0,
    desktopImage: row.desktop_image, mobileImage: row.mobile_image, orientationId: row.orientation_id,
  };
}

const BANNER_COLUMNS = "id,audience,position,title,body,href,deleted_at,desktop_image,mobile_image,enabled,orientation_id";

function bannerInput(body: { audience?: unknown; position?: unknown; title?: unknown; body?: unknown; href?: unknown; desktopImage?: unknown; mobileImage?: unknown; enabled?: unknown; orientationId?: unknown }, id = crypto.randomUUID()) {
  const enabled = body.enabled === undefined ? 1 : body.enabled === true || body.enabled === 1 ? 1 : body.enabled === false || body.enabled === 0 ? 0 : null;
  if (enabled === null) throw new ApiError(400, "横幅状态无效。");
  const orientationId = body.orientationId === undefined || body.orientationId === null || body.orientationId === "" ? null : text(body.orientationId, 40, "性向");
  return {
    id, audience: audience(body.audience), position: position(body.position), title: text(body.title, 40, "标题"), body: text(body.body, 120, "说明"),
    href: href(body.href), desktopImage: imageRef(body.desktopImage, "电脑端图片"), mobileImage: imageRef(body.mobileImage, "手机端图片"), enabled, orientationId,
  };
}

export async function listPublicHomeBanners(request: Request, env: Pick<Env, "DB">): Promise<Response> {
  const url = new URL(request.url);
  const raw = url.searchParams.get("audience");
  if ([...url.searchParams.keys()].some((key) => key !== "audience" || url.searchParams.getAll(key).length !== 1)
    || (raw !== null && raw !== "male" && raw !== "female" && raw !== "general")) {
    throw new ApiError(400, "横幅受众无效。");
  }
  const rows = await env.DB.prepare(`SELECT ${BANNER_COLUMNS} FROM home_banners
    WHERE deleted_at IS NULL AND enabled=1`).all<BannerRow>();
  const banners = selectHomeBanners(rows.results, raw).map(publicBanner);
  return json({ banners });
}

export async function handleAdminBanners(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  if (path === "/v1/admin/banners" && request.method === "GET") {
    if (url.search) throw new ApiError(400, "横幅列表不接受查询参数。");
    const rows = await env.DB.prepare(`SELECT ${BANNER_COLUMNS} FROM home_banners
      ORDER BY deleted_at IS NOT NULL, position ASC, id`).all<BannerRow>();
    return json({ accountId: user.id, banners: rows.results.map(adminBanner) });
  }
  if (path === "/v1/admin/banners" && request.method === "POST") {
    if (url.search) throw new ApiError(400, "横幅保存不接受查询参数。");
    const body = await readJson(request) as { accountId?: unknown; audience?: unknown; position?: unknown; title?: unknown; body?: unknown; href?: unknown; desktopImage?: unknown; mobileImage?: unknown; enabled?: unknown; orientationId?: unknown };
    if (body.accountId !== user.id) throw new ApiError(403, "账号已切换，请刷新后台。");
    const next = bannerInput(body);
    const now = Date.now();
    const inserted = await env.DB.prepare(`INSERT INTO home_banners(id,audience,position,title,body,href,desktop_image,mobile_image,enabled,orientation_id,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (
        SELECT 1 FROM home_banners WHERE position=? AND deleted_at IS NULL
      )`).bind(next.id, next.audience, next.position, next.title, next.body, next.href, next.desktopImage, next.mobileImage, next.enabled, next.orientationId, now, now, next.position).run();
    if (inserted.meta.changes !== 1) throw new ApiError(409, "该展示位置已被占用");
    return json({ accountId: user.id, banner: { ...next, deletedAt: null, enabled: next.enabled === 1 } }, 201);
  }
  const edit = /^\/v1\/admin\/banners\/([^/]+)$/.exec(path);
  if (edit && request.method === "POST") {
    if (url.search) throw new ApiError(400, "横幅保存不接受查询参数。");
    if (!UUID.test(edit[1])) throw new ApiError(400, "横幅编号无效。");
    const id = edit[1].toLowerCase();
    const body = await readJson(request) as { accountId?: unknown; audience?: unknown; position?: unknown; title?: unknown; body?: unknown; href?: unknown; desktopImage?: unknown; mobileImage?: unknown; enabled?: unknown; orientationId?: unknown };
    if (body.accountId !== user.id) throw new ApiError(403, "账号已切换，请刷新后台。");
    const next = bannerInput(body, id);
    const now = Date.now();
    const updated = await env.DB.prepare(`UPDATE home_banners SET audience=?, position=?, title=?, body=?, href=?, desktop_image=?, mobile_image=?, enabled=?, orientation_id=?, updated_at=?
      WHERE id=? AND deleted_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM home_banners other WHERE other.position=? AND other.deleted_at IS NULL AND other.id<>?
      )`).bind(next.audience, next.position, next.title, next.body, next.href, next.desktopImage, next.mobileImage, next.enabled, next.orientationId, now, id, next.position, id).run();
    if (updated.meta.changes !== 1) {
      const row = await env.DB.prepare(`SELECT id FROM home_banners WHERE id=? AND deleted_at IS NULL`).bind(id).first();
      throw new ApiError(row ? 409 : 404, row ? "该展示位置已被占用" : "横幅不存在。");
    }
    const row = await env.DB.prepare(`SELECT ${BANNER_COLUMNS} FROM home_banners WHERE id=?`).bind(id).first<BannerRow>();
    return json({ accountId: user.id, banner: adminBanner(row!) });
  }
  const removal = /^\/v1\/admin\/banners\/([^/]+)\/delete$/.exec(path);
  if (removal && request.method === "POST") {
    if (url.search) throw new ApiError(400, "横幅删除不接受查询参数。");
    if (!UUID.test(removal[1])) throw new ApiError(400, "横幅编号无效。");
    const id = removal[1].toLowerCase();
    const body = await readJson(request) as { accountId?: unknown };
    if (body.accountId !== user.id) throw new ApiError(403, "账号已切换，请刷新后台。");
    const now = Date.now();
    const updated = await env.DB.prepare(`UPDATE home_banners SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`).bind(now, now, id).run();
    const row = await env.DB.prepare(`SELECT ${BANNER_COLUMNS} FROM home_banners WHERE id=?`).bind(id).first<BannerRow>();
    if (!row) throw new ApiError(404, "横幅不存在。");
    return json({ accountId: user.id, banner: adminBanner(row), removed: updated.meta.changes === 1 });
  }
  if (path === "/v1/admin/banners" || path.startsWith("/v1/admin/banners/")) throw new ApiError(405, "横幅接口不支持此操作。");
  return null;
}
