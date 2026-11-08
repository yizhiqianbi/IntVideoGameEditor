/** Recharge started on the studio returns there, never to an arbitrary host. */
export const CREATE_ORIGIN = "https://create.xumengchat.top";
export const MAIN_ORIGIN = "https://xumengchat.top";
export const CREATE_RETURN_COOKIE = "xumeng_create_return";
const RETURN_PATH = "/api/payments/guagua/return";
const ORDER_ID = /^gg_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAY_HOST = "alipay.dthzf001.cn";

export type RechargeLanding = { orderId: string | null; paid: boolean };
export type CustomAmountRule = { minMinor: number; maxMinor: number; stepMinor: number };

export function createReturnSetCookie(): string {
  return `${CREATE_RETURN_COOKIE}=1; Domain=.xumengchat.top; Path=${RETURN_PATH}; Max-Age=1800; Secure; SameSite=Lax`;
}

export function createReturnClearCookie(): string {
  return `${CREATE_RETURN_COOKIE}=; Domain=.xumengchat.top; Path=${RETURN_PATH}; Max-Age=0; Secure; SameSite=Lax`;
}

export function hasCreateReturnCookie(header: string | null): boolean {
  return (header ?? "").split(";").some((part) => part.trim() === `${CREATE_RETURN_COOKIE}=1`);
}

/** Only the main site's own recharge landing may be rewritten onto the studio. */
export function mainSiteRechargeLanding(location: string | null): RechargeLanding | null {
  if (!location) return null;
  let url: URL;
  try { url = new URL(location); } catch { return null; }
  if (url.origin !== MAIN_ORIGIN || url.username || url.password || url.pathname !== "/" || url.hash !== "#recharge") return null;
  const names = [...url.searchParams.keys()];
  if (names.some((name) => name !== "payment_order" && name !== "payment")) return null;
  if (url.searchParams.getAll("payment_order").length > 1 || url.searchParams.getAll("payment").length > 1) return null;
  const orderId = url.searchParams.get("payment_order");
  const payment = url.searchParams.get("payment");
  if ((orderId === null) !== (payment === null)) return null;
  if (orderId !== null && !ORDER_ID.test(orderId)) return null;
  if (payment !== null && payment !== "success") return null;
  return { orderId, paid: payment === "success" };
}

export function createRechargeLocation(landing: RechargeLanding): string {
  const next = new URL("/", CREATE_ORIGIN);
  next.searchParams.set("recharge", "1");
  if (landing.orderId && landing.paid) {
    next.searchParams.set("payment_order", landing.orderId);
    next.searchParams.set("payment", "success");
  }
  return next.href;
}

/** Guagua only exposes a same-site order route. The studio visits that path on its own host. */
export function studioCheckoutPath(checkoutUrl: unknown): string | null {
  if (typeof checkoutUrl !== "string" || checkoutUrl.length > 2048 || checkoutUrl !== checkoutUrl.trim()) return null;
  let url: URL;
  try { url = new URL(checkoutUrl); } catch { return null; }
  if (url.origin !== MAIN_ORIGIN || url.username || url.password || url.port || url.search || url.hash) return null;
  if (checkoutUrl !== `${url.origin}${url.pathname}`) return null;
  const match = /^\/api\/payments\/guagua\/checkout\/(gg_[0-9a-f-]+)$/.exec(url.pathname);
  if (!match || !UUID.test(match[1].slice(3))) return null;
  return url.pathname;
}

export function guaguaCashierLocation(location: string | null): string | null {
  if (!location) return null;
  let url: URL;
  try { url = new URL(location); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== PAY_HOST || url.port || url.username || url.password || url.hash
    || !url.pathname.startsWith("/pay/")) return null;
  return url.href;
}

/** Whole yuan only. Non-digits stay in the field and do not become an amount. */
export function customAmountMinor(raw: string, rule: CustomAmountRule): number | null {
  if (!/^\d{1,6}$/.test(raw)) return null;
  const minor = Number(raw) * 100;
  if (!Number.isSafeInteger(minor) || minor < rule.minMinor || minor > rule.maxMinor || minor % rule.stepMinor !== 0) return null;
  return minor;
}

/** A path remembered on this tab before leaving for the cashier. */
export function studioReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 300 || !value.startsWith("/") || value.startsWith("//")) return "/";
  let url: URL;
  try { url = new URL(value, CREATE_ORIGIN); } catch { return "/"; }
  if (url.origin !== CREATE_ORIGIN) return "/";
  url.searchParams.delete("recharge");
  url.searchParams.delete("payment");
  url.searchParams.delete("payment_order");
  return `${url.pathname}${url.search}${url.hash}`;
}
