import { DzmmAdminError } from "./dzmm-admin-client";

const API = "/api/backend/v1/admin/ops";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 500): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\0");

async function ops(path: string, accountId: string, body?: unknown): Promise<Record<string, unknown>> {
  if (!UUID.test(accountId)) throw new DzmmAdminError(401, "管理账号无效，请重新登录。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify({ accountId, ...body }),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new DzmmAdminError(response.status, record(value) && text(value.error, 500) ? value.error : "运营请求失败，请稍后重试。");
    if (!record(value) || value.accountId !== accountId) throw new DzmmAdminError(502, "运营服务返回的数据无效，请刷新后重试。");
    return value;
  } catch (error) {
    if (error instanceof DzmmAdminError) throw error;
    throw new DzmmAdminError(503, "运营服务暂时无法连接，请重试。");
  } finally { clearTimeout(timer); }
}

export type OpsPackage = {
  id: string; amountMinor: number; credits: number; bonusCredits: number; bonusRatio: string;
  weight: number; enabled: boolean; createdAt: number; purchases: number; checkoutReady: boolean;
};
export type OpsScenePrice = { scene: string; unit: string; amount: number; revision: number; updatedAt: number };
export type OpsModelPrice = { id: string; model: string; name: string; catalogIntro: string; intro: string; amount: number | null; revision: number | null; updatedAt: number | null };
export type OpsOrientation = { id: string; name: string; explanation: string; icon: string; updatedAt: number };
export type OpsSubtag = { id: string; cardType: "tavern" | "companion"; orientationId: string; orientationName: string; name: string; homeFilter: boolean; updatedAt: number };
export type OpsVoice = { id: string; gender: "male" | "female"; intro: string; previewUrl: string; enabled: boolean; updatedAt: number };
export type OpsCharacter = {
  id: string; name: string; cardType: "tavern" | "companion"; orientationId: string | null; subtagIds: string[];
  status: "listed" | "unlisted" | "deleted"; createdAt: number; updatedAt: number; listedAt: number | null;
  story: string; opening: string; scene: string; core: string; aiName: string; replyStyle: string;
  cover: string; suggestions: string[]; gallery: string[]; voiceId: string; tags: string[];
};
export type OpsReview = {
  id: string; publicationId: string; publicationVersion: number; name: string; status: string; label: string;
  authorId: string; author: string; reason: string | null; createdAt: number; reviewedAt: number | null;
};
export type OpsRecharge = {
  id: string; publicNo: string; userId: string; nickname: string; kind: string; currency: string;
  channel: string; amountMinor: number; credits: number; paidAt: number;
};
export type OpsDay = {
  day: string; newUsers: number; newGuests: number; dau: number; landingUv: number;
  registerRate: number | null; guestConvertRate: number | null; firstChatRate: number | null; firstMessageRate: number | null;
  d1Retention: number | null; d7Retention: number | null; chatters: number; images: number; videos: number;
  suggestionUses: number | null; suggestionAdoption: number | null; ttftMs: number | null; detailToChat: number | null;
  creditsIssued: number; checkinCredits: number; inviteCredits: number; creditsSpent: number; spendRatio: number | null;
  checkins: number; checkinRate: number | null; inviteBinds: number; shareClicks: number | null; inviteRate: number | null;
};

function list<T>(value: Record<string, unknown>, key: string): T[] {
  const items = value[key];
  if (!Array.isArray(items)) throw new DzmmAdminError(502, "运营服务返回的数据无效，请刷新后重试。");
  return items as T[];
}

export async function fetchOpsPackages(accountId: string) {
  return list<OpsPackage>(await ops("/packages", accountId), "packages");
}
export async function saveOpsPackage(accountId: string, id: string | null, body: Omit<OpsPackage, "id" | "createdAt" | "purchases" | "checkoutReady">) {
  const value = await ops(id ? `/packages/${encodeURIComponent(id)}` : "/packages", accountId, { ...body, confirmed: true });
  return value.package as OpsPackage;
}
export async function fetchOpsScenePrices(accountId: string) {
  return list<OpsScenePrice>(await ops("/scene-prices", accountId), "prices");
}
export async function saveOpsScenePrice(accountId: string, scene: string, amount: number) {
  return list<OpsScenePrice>(await ops("/scene-prices", accountId, { scene, amount }), "prices");
}
export async function fetchOpsModelPrices(accountId: string) {
  return list<OpsModelPrice>(await ops("/model-prices", accountId), "models");
}
export async function saveOpsModelPrice(accountId: string, model: string, intro: string, amount: number) {
  return list<OpsModelPrice>(await ops("/model-prices", accountId, { model, intro, amount }), "models");
}
export async function fetchOpsOrientations(accountId: string) {
  return list<OpsOrientation>(await ops("/orientations", accountId), "orientations");
}
export async function saveOpsOrientation(accountId: string, id: string | null, body: { name: string; explanation: string; icon: string }) {
  await ops(id ? `/orientations/${encodeURIComponent(id)}` : "/orientations", accountId, body);
}
export async function deleteOpsOrientation(accountId: string, id: string) {
  await ops(`/orientations/${encodeURIComponent(id)}/delete`, accountId, { confirmed: true });
}
export async function fetchOpsSubtags(accountId: string) {
  return list<OpsSubtag>(await ops("/subtags", accountId), "subtags");
}
export async function saveOpsSubtag(accountId: string, id: string | null, body: { name: string; homeFilter: boolean; cardType?: string; orientationId?: string }) {
  await ops(id ? `/subtags/${encodeURIComponent(id)}` : "/subtags", accountId, body);
}
export async function deleteOpsSubtag(accountId: string, id: string) {
  await ops(`/subtags/${encodeURIComponent(id)}/delete`, accountId, { confirmed: true });
}
export async function fetchOpsVoices(accountId: string) {
  return list<OpsVoice>(await ops("/voices", accountId), "voices");
}
export async function syncOpsVoices(accountId: string) {
  return list<OpsVoice>(await ops("/voices/sync", accountId, {}), "voices");
}
export async function saveOpsVoice(accountId: string, id: string, body: { gender: "male" | "female"; intro: string; previewUrl: string; enabled: boolean }) {
  await ops(`/voices/${encodeURIComponent(id)}`, accountId, body);
}
export async function fetchOpsCharacters(accountId: string, query = "") {
  return list<OpsCharacter>(await ops(`/characters${query}`, accountId), "characters");
}
export async function saveOpsCharacter(accountId: string, id: string | null, body: Record<string, unknown>) {
  await ops(id ? `/characters/${encodeURIComponent(id)}` : "/characters", accountId, { ...body, confirmed: true });
}
export async function actOpsCharacter(accountId: string, id: string, action: "list" | "unlist" | "delete") {
  await ops(`/characters/${encodeURIComponent(id)}/${action}`, accountId, { confirmed: true });
}
export async function fetchOpsReviews(accountId: string, status: string, q = "") {
  const params = new URLSearchParams({ status });
  if (q) params.set("q", q);
  const value = await ops(`/reviews?${params}`, accountId);
  return { pending: Number(value.pending ?? 0), items: list<OpsReview>(value, "items") };
}
export async function fetchOpsRejectReasons(accountId: string) {
  return list<{ id: string; label: string }>(await ops("/reject-reasons", accountId), "reasons");
}
export async function fetchOpsRecharges(accountId: string, query: { userId?: string; orderNo?: string; channels?: string; from?: string; to?: string }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  const value = await ops(`/recharges?${params}`, accountId);
  const totals = record(value.totals) ? value.totals : {};
  return {
    feeNote: typeof value.feeNote === "string" ? value.feeNote : "",
    totals: { all: Number(totals.all ?? 0), month: Number(totals.month ?? 0), week: Number(totals.week ?? 0), day: Number(totals.day ?? 0) },
    items: list<OpsRecharge>(value, "items"),
  };
}
export async function fetchOpsAnalytics(accountId: string, from: string, to: string) {
  const value = await ops(`/analytics?from=${from}&to=${to}`, accountId);
  const balance = record(value.balance) ? value.balance : {};
  return {
    note: typeof value.note === "string" ? value.note : "",
    balance: { total: Number(balance.total ?? 0), users: Number(balance.users ?? 0), perUser: Number(balance.perUser ?? 0) },
    days: list<OpsDay>(value, "days"),
  };
}
