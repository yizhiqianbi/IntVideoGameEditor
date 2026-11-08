import { DZMM_MODEL_OPTIONS } from "../../../src/lib/dzmm-models";
import { XUMENG_SPEECH_VOICES } from "../../../src/lib/xumeng-voices";
import type { Character } from "../../../src/lib/dzmm-characters";
import { ApiError, json, readJson } from "./http";
import type { Env, UserRecord } from "./types";
import { shanghaiDay, shanghaiDayStart } from "./visits";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const RATIO = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/;
const EVENT_NAMES = new Set(["landing", "chat_open", "chat_send", "character_detail", "character_chat", "suggestion_shown", "suggestion_accepted", "share_click", "ttft"]);
const SCENES = ["suggestion", "image", "video", "character", "voice"] as const;
type Scene = (typeof SCENES)[number];
type CardType = "tavern" | "companion";
type Shelf = "listed" | "unlisted" | "deleted";
type PackageRow = {
  id: string; amount_minor: number; credits: number; bonus_credits: number; bonus_ratio: string;
  weight: number; enabled: number; created_at: number; updated_at: number; deleted_at: number | null; purchases?: number;
};
export type CheckoutPackage = { id: string; amountMinor: number; currency: "cny"; credits: number; catalogId?: string };

const LEGACY = [
  { id: "cny_28", amountMinor: 2800, credits: 2800 },
  { id: "cny_88", amountMinor: 8800, credits: 10000 },
  { id: "cny_188", amountMinor: 18800, credits: 30000 },
] as const;

function text(value: unknown, max: number, label: string, required = true): string {
  if (typeof value !== "string") throw new ApiError(400, `${label}无效。`);
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max || /[\u0000-\u001f\u007f]/u.test(trimmed)) throw new ApiError(400, `${label}无效。`);
  return trimmed;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new ApiError(400, `${label}无效。`);
  return value as number;
}
function flag(value: unknown, label: string): 0 | 1 {
  if (value !== true && value !== false && value !== 0 && value !== 1) throw new ApiError(400, `${label}无效。`);
  return value === true || value === 1 ? 1 : 0;
}
function confirm(body: Record<string, unknown>) {
  if (body.confirmed !== true) throw new ApiError(400, "请二次确认后再保存。");
}
function sameAccount(body: Record<string, unknown>, user: UserRecord) {
  if (body.accountId !== user.id) throw new ApiError(403, "账号已切换，请刷新后台。");
}
function cardType(value: unknown): CardType {
  if (value !== "tavern" && value !== "companion") throw new ApiError(400, "角色类型无效。");
  return value;
}
function cents(value: unknown, whole: boolean, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100_000_000) throw new ApiError(400, `${label}无效。`);
  const scaled = Math.round(value * 100);
  if (Math.abs(value * 100 - scaled) > 1e-6) throw new ApiError(400, `${label}最多保留两位小数。`);
  if (whole && scaled % 100 !== 0) throw new ApiError(400, `${label}只能是整数。`);
  return scaled;
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
async function audit(env: Env, user: UserRecord, action: string, targetId: string, summary: string) {
  await env.DB.prepare("INSERT INTO ops_audit(id,actor_id,action,target_id,summary,created_at) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), user.id, action, targetId, summary.slice(0, 200), Date.now()).run();
}
function publicPackage(row: PackageRow) {
  return {
    id: row.id, amountMinor: row.amount_minor, credits: row.credits, bonusCredits: row.bonus_credits, bonusRatio: row.bonus_ratio,
    weight: row.weight, enabled: row.enabled === 1, createdAt: row.created_at, updatedAt: row.updated_at,
    purchases: Number(row.purchases ?? 0), checkoutReady: legalPackage(row) !== null,
  };
}
function legalPackage(row: { id: string; amount_minor: number; credits: number }): CheckoutPackage | null {
  if (row.id === "cny_28" && row.amount_minor === 2800 && row.credits === 2800) return { id: "cny_28", amountMinor: 2800, currency: "cny", credits: 2800, catalogId: row.id };
  if (row.id === "cny_88" && row.amount_minor === 8800 && (row.credits === 8800 || row.credits === 10000)) return { id: "cny_88", amountMinor: 8800, currency: "cny", credits: row.credits, catalogId: row.id };
  if (row.id === "cny_188" && row.amount_minor === 18800 && (row.credits === 18800 || row.credits === 30000)) return { id: "cny_188", amountMinor: 18800, currency: "cny", credits: row.credits, catalogId: row.id };
  if (row.credits === row.amount_minor && row.amount_minor >= 100 && row.amount_minor <= 200_000 && row.amount_minor % 100 === 0) {
    return { id: "cny_custom", amountMinor: row.amount_minor, currency: "cny", credits: row.credits, catalogId: row.id };
  }
  return null;
}
function legacyPackage(id: string): CheckoutPackage | undefined {
  const found = LEGACY.find(item => item.id === id);
  return found ? { ...found, currency: "cny" } : undefined;
}

export async function listCheckoutPackages(env: Pick<Env, "DB">) {
  try {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM recharge_packages WHERE deleted_at IS NULL").first<{ n: number }>();
    if (!count || Number(count.n) === 0) return null;
    const rows = await env.DB.prepare(`SELECT id, amount_minor, credits, bonus_credits, bonus_ratio FROM recharge_packages
      WHERE deleted_at IS NULL AND enabled=1 ORDER BY weight ASC, created_at ASC, id`).all<PackageRow>();
    return rows.results.flatMap(row => legalPackage(row) ? [{
      id: row.id, amountMinor: row.amount_minor, currency: "cny" as const, credits: row.credits,
      bonusCredits: row.bonus_credits, bonusRatio: row.bonus_ratio,
    }] : []);
  } catch { return null; }
}

export async function resolveGuaguaPackage(env: Pick<Env, "DB">, packageId: unknown, amount: unknown): Promise<CheckoutPackage | undefined> {
  if (packageId === "cny_custom") {
    if (!Number.isSafeInteger(amount) || (amount as number) < 100 || (amount as number) > 200_000 || (amount as number) % 100 !== 0) {
      throw new ApiError(400, "自定义金额需为 1 至 2000 元之间的整数。");
    }
    return { id: "cny_custom", amountMinor: amount as number, currency: "cny", credits: amount as number };
  }
  if (typeof packageId !== "string" || amount !== undefined) return undefined;
  let row: PackageRow | null = null;
  try { row = await env.DB.prepare("SELECT id, amount_minor, credits, enabled, deleted_at FROM recharge_packages WHERE id=?").bind(packageId).first<PackageRow>(); }
  catch { row = null; }
  if (!row) return legacyPackage(packageId);
  if (row.deleted_at !== null || row.enabled !== 1) throw new ApiError(400, "这个充值套餐已下架。");
  const legal = legalPackage(row);
  if (!legal) throw new ApiError(409, "这个套餐的到手积分还不能通过当前支付通道入账。到手积分需要与实付等额，或继续使用 28、88、188 元现有档。");
  return legal;
}

export function makePublicNo(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let value = "";
  for (let index = 0; index < 6; index += 1) value += letters[bytes[index] % letters.length];
  for (let index = 6; index < 12; index += 1) value += String(bytes[index] % 10);
  return value;
}

export async function rememberRechargePackage(env: Pick<Env, "DB">, orderId: string, packageId: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await env.DB.prepare("INSERT INTO recharge_order_labels(order_id, public_no, package_id, created_at) VALUES(?,?,?,?) ON CONFLICT(order_id) DO NOTHING")
        .bind(orderId, makePublicNo(), packageId, Date.now()).run();
      return;
    } catch { /* retry when the display number collides */ }
  }
}

async function packageBody(body: Record<string, unknown>) {
  confirm(body);
  const amountMinor = integer(body.amountMinor, 100, 200_000, "充值金额");
  if (amountMinor % 100 !== 0) throw new ApiError(400, "充值金额需要是整元。");
  const credits = integer(body.credits, 1, 100_000_000, "到手积分");
  const bonusCredits = body.bonusCredits === undefined || body.bonusCredits === null || body.bonusCredits === "" ? 0 : integer(body.bonusCredits, 0, credits, "额外赠送积分");
  const bonusRatio = body.bonusRatio === undefined || body.bonusRatio === null || body.bonusRatio === "" ? "" : text(body.bonusRatio, 16, "赠送比例");
  if (bonusRatio && !RATIO.test(bonusRatio)) throw new ApiError(400, "赠送比例最多保留两位小数。");
  if (bonusCredits === 0 && bonusRatio) throw new ApiError(400, "没有赠送积分时请留空赠送比例。");
  return { amountMinor, credits, bonusCredits, bonusRatio, weight: integer(body.weight, 1, 9999, "展示权重"), enabled: flag(body.enabled ?? true, "启用状态") };
}

async function packages(request: Request, env: Env, user: UserRecord, url: URL) {
  if (request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM guagua_orders o WHERE o.paid_at IS NOT NULL AND o.package_id=p.id)
      +(SELECT COUNT(*) FROM recharge_order_labels l JOIN guagua_orders o ON o.id=l.order_id
        WHERE o.paid_at IS NOT NULL AND l.package_id=p.id AND o.package_id<>p.id) AS purchases
      FROM recharge_packages p WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC, p.id DESC`).all<PackageRow>();
    return json({ accountId: user.id, packages: rows.results.map(publicPackage) });
  }
  if (request.method !== "POST") throw new ApiError(405, "套餐接口不支持此操作。");
  const body = await readJson(request) as Record<string, unknown>;
  sameAccount(body, user);
  const next = await packageBody(body);
  const now = Date.now();
  if (url.pathname === "/v1/admin/ops/packages") {
    const id = `pkg_${crypto.randomUUID().replace(/-/g, "")}`;
    await env.DB.prepare(`INSERT INTO recharge_packages(id, amount_minor, credits, bonus_credits, bonus_ratio, weight, enabled, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(id, next.amountMinor, next.credits, next.bonusCredits, next.bonusRatio, next.weight, next.enabled, now, now).run();
    await audit(env, user, "package_create", id, `新增套餐 ${next.amountMinor / 100} 元`);
    const row = await env.DB.prepare("SELECT *, 0 AS purchases FROM recharge_packages WHERE id=?").bind(id).first<PackageRow>();
    return json({ accountId: user.id, package: publicPackage(row!) }, 201);
  }
  const match = /^\/v1\/admin\/ops\/packages\/([^/]+)$/.exec(url.pathname);
  if (!match) throw new ApiError(404, "套餐不存在。");
  const id = decodeURIComponent(match[1]);
  const updated = await env.DB.prepare(`UPDATE recharge_packages SET amount_minor=?, credits=?, bonus_credits=?, bonus_ratio=?, weight=?, enabled=?, updated_at=?
    WHERE id=? AND deleted_at IS NULL`).bind(next.amountMinor, next.credits, next.bonusCredits, next.bonusRatio, next.weight, next.enabled, now, id).run();
  if (updated.meta.changes !== 1) throw new ApiError(404, "套餐不存在。");
  await audit(env, user, "package_update", id, `更新套餐 ${next.amountMinor / 100} 元`);
  const row = await env.DB.prepare(`SELECT p.*,
    (SELECT COUNT(*) FROM guagua_orders o WHERE o.paid_at IS NOT NULL AND o.package_id=p.id) AS purchases
    FROM recharge_packages p WHERE p.id=?`).bind(id).first<PackageRow>();
  return json({ accountId: user.id, package: publicPackage(row!) });
}

async function scenePrices(request: Request, env: Env, user: UserRecord) {
  if (request.method === "GET") return json({ accountId: user.id, prices: await readScenePrices(env) });
  if (request.method !== "POST") throw new ApiError(405, "单价接口不支持此操作。");
  const body = await readJson(request) as Record<string, unknown>;
  sameAccount(body, user);
  if (!SCENES.includes(body.scene as Scene)) throw new ApiError(400, "计费场景无效。");
  const scene = body.scene as Scene;
  const whole = scene !== "suggestion";
  const amount = cents(body.amount, whole, "单价");
  const now = Date.now();
  await env.DB.prepare(`UPDATE credit_scene_prices SET amount_cents=?, revision=revision+1, updated_at=? WHERE scene=?`).bind(amount, now, scene).run();
  await audit(env, user, "scene_price", scene, `${scene} 单价改为 ${amount / 100}`);
  return json({ accountId: user.id, prices: await readScenePrices(env) });
}

async function readScenePrices(env: Pick<Env, "DB">) {
  const rows = await env.DB.prepare("SELECT scene, unit, amount_cents, revision, updated_at FROM credit_scene_prices ORDER BY scene").all<{
    scene: Scene; unit: string; amount_cents: number; revision: number; updated_at: number;
  }>();
  return rows.results.map(row => ({ scene: row.scene, unit: row.unit, amount: row.amount_cents / 100, revision: row.revision, updatedAt: row.updated_at }));
}

export async function publicScenePrices(env: Pick<Env, "DB">) {
  return json({ prices: await readScenePrices(env) });
}

async function modelPrices(request: Request, env: Env, user: UserRecord) {
  if (request.method === "GET") return json({ accountId: user.id, models: await readModelPrices(env) });
  if (request.method !== "POST") throw new ApiError(405, "模型单价接口不支持此操作。");
  const body = await readJson(request) as Record<string, unknown>;
  sameAccount(body, user);
  const model = text(body.model, 120, "模型名称");
  if (!DZMM_MODEL_OPTIONS.some(option => option.providerModel === model || option.id === model)) throw new ApiError(400, "模型不在当前目录中。");
  const intro = text(typeof body.intro === "string" ? body.intro : "", 200, "模型介绍", false);
  const price = cents(body.amount, false, "模型单价");
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO credit_model_prices(model, intro, price_cents, revision, updated_at) VALUES(?,?,?,1,?)
    ON CONFLICT(model) DO UPDATE SET intro=excluded.intro, price_cents=excluded.price_cents, revision=credit_model_prices.revision+1, updated_at=excluded.updated_at`)
    .bind(model, intro, price, now).run();
  await audit(env, user, "model_price", model, `${model} 单价改为 ${price / 100}`);
  return json({ accountId: user.id, models: await readModelPrices(env) });
}

async function readModelPrices(env: Pick<Env, "DB">) {
  const rows = await env.DB.prepare("SELECT model, intro, price_cents, revision, updated_at FROM credit_model_prices").all<{
    model: string; intro: string; price_cents: number; revision: number; updated_at: number;
  }>();
  const saved = new Map(rows.results.map(row => [row.model, row]));
  return DZMM_MODEL_OPTIONS.map(option => {
    const row = saved.get(option.providerModel) ?? saved.get(option.id);
    return {
      id: option.id, model: option.providerModel, name: option.label, catalogIntro: option.description,
      intro: row?.intro ?? option.description, amount: row ? row.price_cents / 100 : null, revision: row?.revision ?? null, updatedAt: row?.updated_at ?? null,
    };
  });
}

async function orientations(request: Request, env: Env, user: UserRecord, url: URL) {
  if (request.method === "GET" && url.pathname === "/v1/admin/ops/orientations") {
    const rows = await env.DB.prepare("SELECT * FROM content_orientations WHERE deleted_at IS NULL ORDER BY updated_at DESC, id").all();
    return json({ accountId: user.id, orientations: rows.results.map(publicOrientation) });
  }
  const body = await readJson(request) as Record<string, unknown>;
  sameAccount(body, user);
  const removal = /^\/v1\/admin\/ops\/orientations\/([^/]+)\/delete$/.exec(url.pathname);
  if (removal && request.method === "POST") {
    confirm(body);
    const id = decodeURIComponent(removal[1]);
    const now = Date.now();
    const updated = await env.DB.prepare("UPDATE content_orientations SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL").bind(now, now, id).run();
    if (updated.meta.changes !== 1) throw new ApiError(404, "性向不存在。");
    await audit(env, user, "orientation_delete", id, "软删除性向");
    return json({ accountId: user.id, removed: true });
  }
  if (request.method !== "POST") throw new ApiError(405, "性向接口不支持此操作。");
  const name = text(body.name, 20, "性向名称");
  const explanation = text(body.explanation, 200, "性向解释");
  const icon = imageRef(body.icon, "性向图标") ?? "";
  const now = Date.now();
  const edit = /^\/v1\/admin\/ops\/orientations\/([^/]+)$/.exec(url.pathname);
  if (!edit) {
    const id = `ori_${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare("INSERT INTO content_orientations(id, name, explanation, icon, created_at, updated_at) VALUES(?,?,?,?,?,?)")
      .bind(id, name, explanation, icon, now, now).run();
    await audit(env, user, "orientation_create", id, name);
    return json({ accountId: user.id, orientation: { id, name, explanation, icon, updatedAt: now } }, 201);
  }
  const id = decodeURIComponent(edit[1]);
  const updated = await env.DB.prepare("UPDATE content_orientations SET name=?, explanation=?, icon=?, updated_at=? WHERE id=? AND deleted_at IS NULL")
    .bind(name, explanation, icon, now, id).run();
  if (updated.meta.changes !== 1) throw new ApiError(404, "性向不存在。");
  await audit(env, user, "orientation_update", id, name);
  return json({ accountId: user.id, orientation: { id, name, explanation, icon, updatedAt: now } });
}
function publicOrientation(row: Record<string, unknown>) {
  return { id: row.id, name: row.name, explanation: row.explanation, icon: row.icon, updatedAt: row.updated_at };
}

async function subtags(request: Request, env: Env, user: UserRecord, url: URL) {
  if (request.method === "GET" && url.pathname === "/v1/admin/ops/subtags") {
    const rows = await env.DB.prepare(`SELECT s.*, o.name AS orientation_name FROM content_subtags s
      JOIN content_orientations o ON o.id=s.orientation_id WHERE s.deleted_at IS NULL ORDER BY s.updated_at DESC, s.id`).all();
    return json({ accountId: user.id, subtags: rows.results.map(publicSubtag) });
  }
  const body = await readJson(request) as Record<string, unknown>;
  sameAccount(body, user);
  const removal = /^\/v1\/admin\/ops\/subtags\/([^/]+)\/delete$/.exec(url.pathname);
  if (removal && request.method === "POST") {
    confirm(body);
    const id = decodeURIComponent(removal[1]);
    const now = Date.now();
    const updated = await env.DB.prepare("UPDATE content_subtags SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL").bind(now, now, id).run();
    if (updated.meta.changes !== 1) throw new ApiError(404, "子标签不存在。");
    await audit(env, user, "subtag_delete", id, "软删除子标签");
    return json({ accountId: user.id, removed: true });
  }
  if (request.method !== "POST") throw new ApiError(405, "子标签接口不支持此操作。");
  const name = text(body.name, 16, "标签名称");
  const homeFilter = flag(body.homeFilter ?? false, "首页筛选项");
  const now = Date.now();
  const edit = /^\/v1\/admin\/ops\/subtags\/([^/]+)$/.exec(url.pathname);
  if (!edit) {
    const type = cardType(body.cardType);
    const orientationId = text(body.orientationId, 40, "性向");
    const orientation = await env.DB.prepare("SELECT id FROM content_orientations WHERE id=? AND deleted_at IS NULL").bind(orientationId).first();
    if (!orientation) throw new ApiError(400, "性向不存在。");
    const id = `tag_${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare("INSERT INTO content_subtags(id, card_type, orientation_id, name, home_filter, created_at, updated_at) VALUES(?,?,?,?,?,?,?)")
      .bind(id, type, orientationId, name, homeFilter, now, now).run();
    await audit(env, user, "subtag_create", id, name);
    return json({ accountId: user.id, subtag: { id, cardType: type, orientationId, name, homeFilter: homeFilter === 1, updatedAt: now } }, 201);
  }
  const id = decodeURIComponent(edit[1]);
  const updated = await env.DB.prepare("UPDATE content_subtags SET name=?, home_filter=?, updated_at=? WHERE id=? AND deleted_at IS NULL")
    .bind(name, homeFilter, now, id).run();
  if (updated.meta.changes !== 1) throw new ApiError(404, "子标签不存在。");
  await audit(env, user, "subtag_update", id, name);
  return json({ accountId: user.id, updated: true });
}
function publicSubtag(row: Record<string, unknown>) {
  return { id: row.id, cardType: row.card_type, orientationId: row.orientation_id, orientationName: row.orientation_name, name: row.name, homeFilter: row.home_filter === 1, updatedAt: row.updated_at };
}

export async function publicCatalogFilters(env: Pick<Env, "DB">) {
  const orientations = await env.DB.prepare("SELECT id, name, explanation, icon FROM content_orientations WHERE deleted_at IS NULL ORDER BY updated_at DESC, id").all();
  const subtags = await env.DB.prepare(`SELECT s.id, s.name, s.card_type, s.orientation_id, s.home_filter, o.name AS orientation_name
    FROM content_subtags s JOIN content_orientations o ON o.id=s.orientation_id AND o.deleted_at IS NULL
    WHERE s.deleted_at IS NULL ORDER BY s.updated_at DESC, s.id`).all();
  return json({
    orientations: orientations.results,
    subtags: subtags.results.map(row => ({ id: row.id, name: row.name, cardType: row.card_type, orientationId: row.orientation_id, orientationName: row.orientation_name, homeFilter: row.home_filter === 1 })),
  });
}

async function voices(request: Request, env: Env, user: UserRecord, url: URL) {
  if (request.method === "POST" && url.pathname === "/v1/admin/ops/voices/sync") {
    const body = await readJson(request) as Record<string, unknown>;
    sameAccount(body, user);
    const now = Date.now();
    for (const voice of XUMENG_SPEECH_VOICES) {
      const gender = voice.group === "男声" ? "male" : "female";
      await env.DB.prepare(`INSERT INTO content_voices(id, gender, intro, preview_url, enabled, updated_at) VALUES(?,?,?,?,1,?)
        ON CONFLICT(id) DO NOTHING`).bind(voice.id, gender, voice.description, "previewUrl" in voice ? voice.previewUrl : "", now).run();
    }
    await audit(env, user, "voice_sync", "voices", "同步音色目录");
  }
  if (request.method === "GET" || url.pathname === "/v1/admin/ops/voices/sync") {
    const rows = await env.DB.prepare("SELECT * FROM content_voices ORDER BY gender, id").all();
    return json({ accountId: user.id, voices: rows.results.map(publicVoice) });
  }
  const match = /^\/v1\/admin\/ops\/voices\/([^/]+)$/.exec(url.pathname);
  if (!match || request.method !== "POST") throw new ApiError(405, "语音接口不支持此操作。");
  const body = await readJson(request) as Record<string, unknown>;
  sameAccount(body, user);
  const id = decodeURIComponent(match[1]);
  const gender = body.gender === "male" || body.gender === "female" ? body.gender : null;
  if (!gender) throw new ApiError(400, "语音类型无效。");
  const intro = text(typeof body.intro === "string" ? body.intro : "", 200, "语音介绍", false);
  const preview = body.previewUrl === undefined || body.previewUrl === null || body.previewUrl === "" ? "" : text(body.previewUrl, 500, "试听地址");
  const enabled = flag(body.enabled ?? true, "启用状态");
  const updated = await env.DB.prepare("UPDATE content_voices SET gender=?, intro=?, preview_url=?, enabled=?, updated_at=? WHERE id=?")
    .bind(gender, intro, preview, enabled, Date.now(), id).run();
  if (updated.meta.changes !== 1) throw new ApiError(404, "语音不存在。");
  await audit(env, user, "voice_update", id, intro || id);
  return json({ accountId: user.id, updated: true });
}
function publicVoice(row: Record<string, unknown>) {
  return { id: row.id, gender: row.gender, intro: row.intro, previewUrl: row.preview_url, enabled: row.enabled === 1, updatedAt: row.updated_at };
}

function snapshot(body: Record<string, unknown>) {
  const story = text(typeof body.story === "string" ? body.story : "", 4000, "故事介绍", false);
  const opening = text(typeof body.opening === "string" ? body.opening : "", 4000, "开场白", false);
  const scene = text(typeof body.scene === "string" ? body.scene : "", 4000, "当前场景", false);
  const core = text(typeof body.core === "string" ? body.core : "", 4000, "核心设定", false);
  const aiName = text(typeof body.aiName === "string" ? body.aiName : "", 40, "AI 角色名称", false);
  const replyStyle = text(typeof body.replyStyle === "string" ? body.replyStyle : "", 1000, "回复风格", false);
  const cover = imageRef(body.cover, "封面");
  const suggestions = Array.isArray(body.suggestions) ? body.suggestions.slice(0, 8).map(item => text(item, 80, "首轮建议")) : [];
  const gallery = Array.isArray(body.gallery) ? body.gallery.slice(0, 12).map(item => imageRef(item, "相册图片")).filter((item): item is string => item !== null) : [];
  const voiceId = body.voiceId === undefined || body.voiceId === null || body.voiceId === "" ? "" : text(body.voiceId, 80, "音色");
  const tags = Array.isArray(body.tags) ? body.tags.slice(0, 12).map(item => text(item, 16, "标签")) : [];
  return { story, opening, scene, core, aiName, replyStyle, cover: cover ?? "", suggestions, gallery, voiceId, tags };
}

async function officialCharacters(request: Request, env: Env, user: UserRecord, url: URL) {
  if (request.method === "GET" && url.pathname === "/v1/admin/ops/characters") return json({ accountId: user.id, ...(await listOfficial(env, url)) });
  const body = await readJson(request) as Record<string, unknown>;
  sameAccount(body, user);
  const action = /^\/v1\/admin\/ops\/characters\/([^/]+)\/(list|unlist|delete)$/.exec(url.pathname);
  if (action && request.method === "POST") {
    confirm(body);
    const id = decodeURIComponent(action[1]);
    const now = Date.now();
    const next = action[2] === "list" ? "listed" : action[2] === "unlist" ? "unlisted" : "deleted";
    const updated = await env.DB.prepare(`UPDATE official_characters SET status=?, updated_at=?,
      listed_at=CASE WHEN ?='listed' AND listed_at IS NULL THEN ? ELSE listed_at END,
      deleted_at=CASE WHEN ?='deleted' THEN ? ELSE NULL END
      WHERE id=? AND (?='deleted' OR status<>'deleted')`).bind(next, now, next, now, next, now, id, next).run();
    if (updated.meta.changes !== 1) throw new ApiError(404, "官方角色不存在。");
    await audit(env, user, `character_${action[2]}`, id, next === "listed" ? "上架官方角色" : next === "unlisted" ? "下架官方角色" : "软删除官方角色");
    return json({ accountId: user.id, id, status: next });
  }
  if (request.method !== "POST") throw new ApiError(405, "官方角色接口不支持此操作。");
  confirm(body);
  const name = text(body.name, 40, "角色卡名称");
  const type = cardType(body.cardType);
  const orientationId = body.orientationId === undefined || body.orientationId === null || body.orientationId === "" ? null : text(body.orientationId, 40, "性向");
  if (orientationId) {
    const orientation = await env.DB.prepare("SELECT id FROM content_orientations WHERE id=? AND deleted_at IS NULL").bind(orientationId).first();
    if (!orientation) throw new ApiError(400, "性向不存在。");
  }
  const subtags = Array.isArray(body.subtagIds) ? body.subtagIds.slice(0, 12).map(item => text(item, 40, "子标签")) : [];
  const card = snapshot(body);
  const now = Date.now();
  const edit = /^\/v1\/admin\/ops\/characters\/([^/]+)$/.exec(url.pathname);
  if (!edit) {
    const id = `official_${crypto.randomUUID()}`;
    await env.DB.prepare(`INSERT INTO official_characters(id, name, card_type, orientation_id, subtags_json, status, snapshot_json, created_at, updated_at)
      VALUES(?,?,?,?,?,'unlisted',?,?,?)`).bind(id, name, type, orientationId, JSON.stringify(subtags), JSON.stringify(card), now, now).run();
    await audit(env, user, "character_create", id, name);
    return json({ accountId: user.id, character: { id, name, cardType: type, status: "unlisted", createdAt: now } }, 201);
  }
  const id = decodeURIComponent(edit[1]);
  const updated = await env.DB.prepare(`UPDATE official_characters SET name=?, card_type=?, orientation_id=?, subtags_json=?, snapshot_json=?, updated_at=?
    WHERE id=? AND status<>'deleted'`).bind(name, type, orientationId, JSON.stringify(subtags), JSON.stringify(card), now, id).run();
  if (updated.meta.changes !== 1) throw new ApiError(404, "官方角色不存在。");
  await audit(env, user, "character_update", id, name);
  return json({ accountId: user.id, updated: true });
}

async function listOfficial(env: Env, url: URL) {
  const status = url.searchParams.get("status");
  if (status !== null && status !== "listed" && status !== "unlisted" && status !== "deleted") throw new ApiError(400, "状态无效。");
  const type = url.searchParams.get("cardType");
  if (type !== null && type !== "tavern" && type !== "companion") throw new ApiError(400, "角色类型无效。");
  const q = url.searchParams.get("q") ?? "";
  if (q.length > 40) throw new ApiError(400, "搜索词过长。");
  const rows = await env.DB.prepare(`SELECT * FROM official_characters
    WHERE ((? IS NULL AND status<>'deleted') OR status=?) AND (? IS NULL OR card_type=?) AND (?='' OR instr(lower(name), lower(?))>0 OR id=?)
    ORDER BY created_at DESC, id DESC LIMIT 50`).bind(status, status, type, type, q, q, q).all();
  return { characters: rows.results.map(publicOfficial) };
}
function publicOfficial(row: Record<string, unknown>) {
  const card = JSON.parse(String(row.snapshot_json)) as Record<string, unknown>;
  return {
    id: row.id, name: row.name, cardType: row.card_type, orientationId: row.orientation_id,
    subtagIds: JSON.parse(String(row.subtags_json)), status: row.status, createdAt: row.created_at,
    updatedAt: row.updated_at, listedAt: row.listed_at, ...card,
  };
}

export async function listedOfficialCards(env: Pick<Env, "DB">): Promise<Character[]> {
  const rows = await env.DB.prepare("SELECT * FROM official_characters WHERE status='listed' ORDER BY listed_at DESC, id LIMIT 50").all();
  return rows.results.map(row => {
    const card = JSON.parse(String(row.snapshot_json)) as Record<string, unknown>;
    const tags = Array.isArray(card.tags) ? card.tags.filter((item): item is string => typeof item === "string") : [];
    return {
      id: String(row.id), name: String(row.name), author: "叙梦官方", heat: "0", likes: "0",
      cover: typeof card.cover === "string" && card.cover ? card.cover : "/dzmm/brand/xumeng-character-placeholder.svg",
      tags: [row.card_type === "companion" ? "心动陪伴" : "幻想剧场", ...tags],
      description: typeof card.story === "string" ? card.story : "",
      personality: typeof card.core === "string" ? card.core : "",
      scenario: typeof card.scene === "string" ? card.scene : "",
      firstMessage: typeof card.opening === "string" ? card.opening : "",
      sourceUrl: "", sourceKind: "original", promptOrigin: "original",
      createdAt: new Date(Number(row.listed_at ?? row.created_at)).toISOString(),
      ...(Array.isArray(card.gallery) ? { gallery: card.gallery.filter((item): item is string => typeof item === "string") } : {}),
      ...(Array.isArray(card.suggestions) ? { suggestedReplies: card.suggestions.filter((item): item is string => typeof item === "string") } : {}),
    };
  });
}

async function reviews(request: Request, env: Env, user: UserRecord, url: URL) {
  if (request.method === "GET" && url.pathname === "/v1/admin/ops/reject-reasons") {
    const rows = await env.DB.prepare("SELECT id, label FROM review_reject_reasons WHERE deleted_at IS NULL ORDER BY created_at, id").all();
    return json({ accountId: user.id, reasons: rows.results });
  }
  if (request.method !== "GET") throw new ApiError(405, "审核列表仅支持读取。通过或拒绝仍使用原有审核接口。");
  const status = url.searchParams.get("status") ?? "pending";
  if (!["pending", "approved", "rejected", "withdrawn", "all"].includes(status)) throw new ApiError(400, "审核状态无效。");
  const q = url.searchParams.get("q") ?? "";
  const owner = url.searchParams.get("userId");
  if (owner !== null && !UUID.test(owner)) throw new ApiError(400, "创建者用户 ID 需要完整匹配。");
  const rows = await env.DB.prepare(`SELECT s.id, s.status, s.review_reason, s.created_at, s.reviewed_at, s.snapshot_json,
    p.id AS publication_id, p.version, p.user_id, p.is_listed, u.nickname
    FROM character_submissions s JOIN character_publications p ON p.id=s.publication_id JOIN users u ON u.id=p.user_id
    WHERE (?='all' OR s.status=?) AND (? IS NULL OR p.user_id=?) AND (?='' OR instr(lower(u.nickname), lower(?))>0 OR p.id=? OR s.id=?)
    ORDER BY s.created_at DESC LIMIT 40`).bind(status, status, owner, owner, q, q, q, q).all();
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM character_submissions WHERE status='pending'").first<{ n: number }>();
  return json({
    accountId: user.id, pending: Number(pending?.n ?? 0),
    items: rows.results.map(row => {
      let name = "";
      try { name = String(JSON.parse(String(row.snapshot_json)).name ?? ""); } catch { name = ""; }
      const label = row.status === "pending" ? "审核中" : row.status === "rejected" ? "审核拒绝" : row.status === "withdrawn" ? "已撤回" : row.is_listed === 1 ? "已公开" : "未上架";
      return {
        id: row.id, publicationId: row.publication_id, publicationVersion: row.version, name, status: row.status, label,
        authorId: row.user_id, author: row.nickname, reason: row.review_reason, createdAt: row.created_at, reviewedAt: row.reviewed_at,
      };
    }),
  });
}

function shanghaiBounds(now = Date.now()) {
  const day = shanghaiDay(now);
  const start = shanghaiDayStart(day);
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  const monthStart = Date.parse(`${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00+08:00`);
  const weekStart = start - ((shifted.getUTCDay() + 6) % 7) * 86_400_000;
  return { start, monthStart, weekStart };
}

async function recharges(env: Env, user: UserRecord, url: URL) {
  const userId = url.searchParams.get("userId");
  const orderNo = url.searchParams.get("orderNo");
  if (userId !== null && !UUID.test(userId)) throw new ApiError(400, "用户 ID 需要完整匹配。");
  if (orderNo !== null && !/^[A-Za-z0-9]{12}$/.test(orderNo)) throw new ApiError(400, "订单号需要是 12 位展示编号。");
  const channels = (url.searchParams.get("channels") ?? "").split(",").filter(Boolean);
  if (channels.some(channel => channel !== "alipay" && channel !== "wxpay")) throw new ApiError(400, "充值渠道无效。");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const fromMs = from === null || from === "" ? null : Number(from);
  const toMs = to === null || to === "" ? null : Number(to);
  if ((fromMs !== null && !Number.isSafeInteger(fromMs)) || (toMs !== null && !Number.isSafeInteger(toMs))) throw new ApiError(400, "充值时间无效。");
  const bounds = shanghaiBounds();
  const paid = `SELECT o.id, o.user_id, u.nickname, 'wxpay' AS channel, o.amount_minor, o.credits, o.paid_at, o.package_id
    FROM guagua_orders o JOIN users u ON u.id=o.user_id WHERE o.paid_at IS NOT NULL
    UNION ALL SELECT o.id, o.user_id, u.nickname, o.method, o.amount_minor, o.credits, o.paid_at, o.package_id
    FROM zpay_orders o JOIN users u ON u.id=o.user_id WHERE o.paid_at IS NOT NULL AND o.currency='cny'`;
  const totals = await env.DB.prepare(`SELECT
    COALESCE(SUM(amount_minor),0) AS all_time,
    COALESCE(SUM(CASE WHEN paid_at>=? THEN amount_minor ELSE 0 END),0) AS month,
    COALESCE(SUM(CASE WHEN paid_at>=? THEN amount_minor ELSE 0 END),0) AS week,
    COALESCE(SUM(CASE WHEN paid_at>=? THEN amount_minor ELSE 0 END),0) AS day
    FROM (${paid})`).bind(bounds.monthStart, bounds.weekStart, bounds.start).first<{ all_time: number; month: number; week: number; day: number }>();
  const channelSql = channels.length ? ` AND channel IN (${channels.map(() => "?").join(",")})` : "";
  const rows = await env.DB.prepare(`SELECT p.*, l.public_no FROM (${paid}) p
    LEFT JOIN recharge_order_labels l ON l.order_id=p.id
    WHERE (? IS NULL OR user_id=?) AND (? IS NULL OR l.public_no=?) AND (? IS NULL OR paid_at>=?) AND (? IS NULL OR paid_at<=?) ${channelSql}
    ORDER BY paid_at DESC, id DESC LIMIT 40`).bind(userId, userId, orderNo, orderNo, fromMs, fromMs, toMs, toMs, ...channels).all();
  const items = [];
  for (const row of rows.results as Record<string, unknown>[]) {
    let publicNo = typeof row.public_no === "string" ? row.public_no : "";
    if (!publicNo) {
      await rememberRechargePackage(env, String(row.id), String(row.package_id));
      const label = await env.DB.prepare("SELECT public_no FROM recharge_order_labels WHERE order_id=?").bind(row.id).first<{ public_no: string }>();
      publicNo = label?.public_no ?? "";
    }
    items.push({
      id: row.id, publicNo, userId: row.user_id, nickname: row.nickname, kind: "法币", currency: "人民币",
      channel: row.channel === "alipay" ? "支付宝" : "微信", amountMinor: row.amount_minor, credits: row.credits, paidAt: row.paid_at,
    });
  }
  return json({
    accountId: user.id, timezone: "Asia/Shanghai", feeNote: "手续费尚未配置，以下金额是用户实付。",
    totals: { all: Number(totals?.all_time ?? 0), month: Number(totals?.month ?? 0), week: Number(totals?.week ?? 0), day: Number(totals?.day ?? 0) },
    items,
  });
}

function daysOf(from: string, to: string) {
  const start = shanghaiDayStart(from);
  const end = shanghaiDayStart(to) + 86_400_000;
  const days: string[] = [];
  for (let time = start; time < end; time += 86_400_000) days.push(shanghaiDay(time));
  return { start, end, days };
}
function grouped(rows: Record<string, unknown>[], key = "day") {
  return new Map(rows.map(row => [String(row[key]), row]));
}
const rate = (part: number, total: number) => total > 0 ? Math.round(part * 10_000 / total) / 100 : null;

async function analytics(env: Env, user: UserRecord, url: URL) {
  const from = url.searchParams.get("from") ?? shanghaiDay(Date.now() - 6 * 86_400_000);
  const to = url.searchParams.get("to") ?? shanghaiDay();
  if (!DAY.test(from) || !DAY.test(to) || from > to) throw new ApiError(400, "日期范围无效。");
  const { start, end, days } = daysOf(from, to);
  if (days.length > 31) throw new ApiError(400, "一次最多查看 31 天。");
  const daySql = "strftime('%Y-%m-%d', created_at/1000.0, 'unixepoch', '+8 hours')";
  const [created, visits, chats, media, issued, spent, checkins, invites, events, balance] = await Promise.all([
    env.DB.prepare(`SELECT ${daySql} AS day, SUM(is_guest=0) AS registered, SUM(is_guest=1) AS guests FROM users
      WHERE is_demo=0 AND created_at>=? AND created_at<? GROUP BY day`).bind(start, end).all(),
    env.DB.prepare("SELECT day_key AS day, COUNT(*) AS dau FROM daily_visits WHERE day_key>=? AND day_key<=? GROUP BY day_key").bind(from, to).all(),
    env.DB.prepare(`SELECT ${daySql} AS day, COUNT(DISTINCT user_id) AS chatters FROM credit_usage_requests
      WHERE operation='chat' AND outcome='completed' AND created_at>=? AND created_at<? GROUP BY day`).bind(start, end).all(),
    env.DB.prepare(`SELECT ${daySql} AS day, kind, COUNT(*) AS n FROM generation_jobs
      WHERE status='ready' AND finalized_at>=? AND finalized_at<? GROUP BY day, kind`).bind(start, end).all(),
    env.DB.prepare(`SELECT ${daySql} AS day, source_type, SUM(credits) AS credits FROM community_credit_ledger
      WHERE created_at>=? AND created_at<? GROUP BY day, source_type`).bind(start, end).all(),
    env.DB.prepare(`SELECT ${daySql} AS day, COALESCE(SUM(credits),0) AS credits FROM credit_usage_ledger
      WHERE created_at>=? AND created_at<? GROUP BY day`).bind(start, end).all(),
    env.DB.prepare(`SELECT strftime('%Y-%m-%d', claimed_at/1000.0, 'unixepoch', '+8 hours') AS day, COUNT(DISTINCT user_id) AS users, COALESCE(SUM(points),0) AS credits
      FROM task_claims WHERE task_id='daily_checkin' AND claimed_at>=? AND claimed_at<? GROUP BY day`).bind(start, end).all(),
    env.DB.prepare(`SELECT ${daySql} AS day, COUNT(*) AS binds FROM referral_events WHERE created_at>=? AND created_at<? GROUP BY day`).bind(start, end).all(),
    env.DB.prepare("SELECT day_key AS day, name, COUNT(*) AS n, AVG(CASE WHEN name='ttft' THEN json_extract(detail_json,'$.ms') END) AS ttft FROM product_events WHERE day_key>=? AND day_key<=? GROUP BY day_key, name").bind(from, to).all(),
    env.DB.prepare("SELECT COALESCE(SUM(balance),0) AS balance, COUNT(*) AS users FROM credit_usage_balances").first<{ balance: number; users: number }>(),
  ]);
  const firstChats = await env.DB.prepare(`SELECT strftime('%Y-%m-%d', u.created_at/1000.0, 'unixepoch', '+8 hours') AS day, COUNT(DISTINCT u.id) AS n
    FROM users u JOIN credit_usage_requests r ON r.user_id=u.id AND r.operation='chat' AND r.outcome='completed'
    WHERE u.created_at>=? AND u.created_at<? AND strftime('%Y-%m-%d', r.created_at/1000.0, 'unixepoch', '+8 hours')=strftime('%Y-%m-%d', u.created_at/1000.0, 'unixepoch', '+8 hours')
    GROUP BY day`).bind(start, end).all();
  const createdMap = grouped(created.results as Record<string, unknown>[]);
  const visitMap = grouped(visits.results as Record<string, unknown>[]);
  const chatMap = grouped(chats.results as Record<string, unknown>[]);
  const firstMap = grouped(firstChats.results as Record<string, unknown>[]);
  const checkinMap = grouped(checkins.results as Record<string, unknown>[]);
  const inviteMap = grouped(invites.results as Record<string, unknown>[]);
  const spentMap = grouped(spent.results as Record<string, unknown>[]);
  const mediaMap = new Map<string, { image: number; video: number }>();
  for (const row of media.results as Record<string, unknown>[]) {
    const current = mediaMap.get(String(row.day)) ?? { image: 0, video: 0 };
    if (row.kind === "image") current.image = Number(row.n);
    if (row.kind === "video") current.video = Number(row.n);
    mediaMap.set(String(row.day), current);
  }
  const creditMap = new Map<string, { task: number; checkin: number; invite: number }>();
  for (const row of issued.results as Record<string, unknown>[]) {
    const current = creditMap.get(String(row.day)) ?? { task: 0, checkin: 0, invite: 0 };
    const credits = Number(row.credits);
    if (row.source_type === "referral_reward") current.invite += credits;
    else current.task += credits;
    creditMap.set(String(row.day), current);
  }
  const eventMap = new Map<string, Record<string, number>>();
  const ttftMap = new Map<string, number | null>();
  for (const row of events.results as Record<string, unknown>[]) {
    const bucket = eventMap.get(String(row.day)) ?? {};
    bucket[String(row.name)] = Number(row.n);
    eventMap.set(String(row.day), bucket);
    if (row.name === "ttft" && row.ttft !== null) ttftMap.set(String(row.day), Math.round(Number(row.ttft)));
  }
  const cohort = await env.DB.prepare(`SELECT strftime('%Y-%m-%d', created_at/1000.0, 'unixepoch', '+8 hours') AS day, COUNT(*) AS n
    FROM users WHERE is_demo=0 AND created_at>=? AND created_at<? GROUP BY day`).bind(start - 7 * 86_400_000, end).all();
  const cohortMap = grouped(cohort.results as Record<string, unknown>[]);
  const retained = await env.DB.prepare(`SELECT v.day_key AS day, strftime('%Y-%m-%d', u.created_at/1000.0, 'unixepoch', '+8 hours') AS born, COUNT(*) AS n
    FROM daily_visits v JOIN users u ON u.id=v.user_id WHERE v.day_key>=? AND v.day_key<=? GROUP BY v.day_key, born`).bind(from, to).all();
  return json({
    accountId: user.id, timezone: "Asia/Shanghai", from, to,
    note: "首字延迟、分享点击、建议回复和详情转聊依赖打点。没有打点时这些格子为空。金额类看板不在这里，充值金额见充值记录，且尚未扣手续费。",
    balance: { total: Number(balance?.balance ?? 0), users: Number(balance?.users ?? 0), perUser: Number(balance?.users) > 0 ? Math.round(Number(balance?.balance) * 100 / Number(balance?.users)) / 100 : 0 },
    days: days.map(day => {
      const born = createdMap.get(day);
      const registered = Number(born?.registered ?? 0);
      const guests = Number(born?.guests ?? 0);
      const arrivals = registered + guests;
      const dau = Number(visitMap.get(day)?.dau ?? 0);
      const previous = shanghaiDay(shanghaiDayStart(day) - 86_400_000);
      const week = shanghaiDay(shanghaiDayStart(day) - 7 * 86_400_000);
      const retainedRows = (retained.results as Record<string, unknown>[]).filter(row => row.day === day);
      const d1 = Number(retainedRows.find(row => row.born === previous)?.n ?? 0);
      const d7 = Number(retainedRows.find(row => row.born === week)?.n ?? 0);
      const credits = creditMap.get(day) ?? { task: 0, checkin: 0, invite: 0 };
      const spentCredits = Math.abs(Number(spentMap.get(day)?.credits ?? 0));
      const eventsForDay = eventMap.get(day) ?? {};
      const suggestionShown = eventsForDay.suggestion_shown ?? 0;
      const detailOpens = eventsForDay.character_detail ?? 0;
      return {
        day, newUsers: registered, newGuests: guests, dau, landingUv: dau,
        registerRate: rate(registered, dau), guestConvertRate: rate(registered, guests),
        firstChatRate: rate(Number(firstMap.get(day)?.n ?? 0), arrivals),
        firstMessageRate: eventsForDay.chat_open ? rate(eventsForDay.chat_send ?? 0, eventsForDay.chat_open) : null,
        d1Retention: rate(d1, Number(cohortMap.get(previous)?.n ?? 0)),
        d7Retention: rate(d7, Number(cohortMap.get(week)?.n ?? 0)),
        chatters: Number(chatMap.get(day)?.chatters ?? 0),
        images: mediaMap.get(day)?.image ?? 0, videos: mediaMap.get(day)?.video ?? 0,
        suggestionUses: suggestionShown || null, suggestionAdoption: suggestionShown ? rate(eventsForDay.suggestion_accepted ?? 0, suggestionShown) : null,
        ttftMs: ttftMap.get(day) ?? null,
        detailToChat: detailOpens ? rate(eventsForDay.character_chat ?? 0, detailOpens) : null,
        creditsIssued: credits.task + credits.invite, checkinCredits: Number(checkinMap.get(day)?.credits ?? 0), inviteCredits: credits.invite, creditsSpent: spentCredits,
        spendRatio: credits.task + credits.invite > 0 ? Math.round(spentCredits * 10 / (credits.task + credits.invite)) / 10 : null,
        checkins: Number(checkinMap.get(day)?.users ?? 0), checkinRate: rate(Number(checkinMap.get(day)?.users ?? 0), dau),
        inviteBinds: Number(inviteMap.get(day)?.binds ?? 0),
        shareClicks: eventsForDay.share_click ?? null,
        inviteRate: eventsForDay.share_click ? rate(Number(inviteMap.get(day)?.binds ?? 0), eventsForDay.share_click) : null,
      };
    }),
  });
}

export async function handleProductEvent(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/metrics/events") return null;
  if (request.method !== "POST") throw new ApiError(405, "事件上报仅支持 POST。");
  const body = await readJson(request, 2000);
  if (body.accountId !== user.id || typeof body.name !== "string" || !EVENT_NAMES.has(body.name)) throw new ApiError(400, "事件无效。");
  const characterId = body.characterId === undefined || body.characterId === null || body.characterId === "" ? null : text(body.characterId, 80, "角色");
  const type = body.cardType === undefined || body.cardType === null || body.cardType === "" ? null : cardType(body.cardType);
  const detail = body.name === "ttft" ? { ms: integer(body.ms, 0, 120_000, "首字延迟") } : {};
  const now = Date.now();
  await env.DB.prepare("INSERT INTO product_events(id,name,user_id,character_id,card_type,day_key,created_at,detail_json) VALUES(?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), body.name, user.id, characterId, type, shanghaiDay(now), now, JSON.stringify(detail)).run();
  return json({ ok: true });
}

export async function handleOpsConsole(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/v1/admin/ops")) return null;
  if (path === "/v1/admin/ops/packages" || path.startsWith("/v1/admin/ops/packages/")) return packages(request, env, user, url);
  if (path === "/v1/admin/ops/scene-prices") return scenePrices(request, env, user);
  if (path === "/v1/admin/ops/model-prices") return modelPrices(request, env, user);
  if (path === "/v1/admin/ops/orientations" || path.startsWith("/v1/admin/ops/orientations/")) return orientations(request, env, user, url);
  if (path === "/v1/admin/ops/subtags" || path.startsWith("/v1/admin/ops/subtags/")) return subtags(request, env, user, url);
  if (path === "/v1/admin/ops/voices" || path.startsWith("/v1/admin/ops/voices/")) return voices(request, env, user, url);
  if (path === "/v1/admin/ops/characters" || path.startsWith("/v1/admin/ops/characters/")) return officialCharacters(request, env, user, url);
  if (path === "/v1/admin/ops/reviews" || path === "/v1/admin/ops/reject-reasons") return reviews(request, env, user, url);
  if (path === "/v1/admin/ops/recharges" && request.method === "GET") return recharges(env, user, url);
  if (path === "/v1/admin/ops/analytics" && request.method === "GET") return analytics(env, user, url);
  throw new ApiError(404, "运营接口不存在。");
}
