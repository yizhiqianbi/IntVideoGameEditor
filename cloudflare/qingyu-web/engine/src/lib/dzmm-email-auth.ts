export type DzmmEmailAuthConfig = {
  enabled: boolean; expiresIn: 600; resendAfter: 60; note: string;
};
export type DzmmEmailCodeValues = { email: string; challengeId: string; code: string; nickname?: string; accountId?: string; referralCode?: string };
export type DzmmEmailCodeRequestResult = { challengeId: string; expiresIn: 600; resendAfter: 60 };
export type DzmmEmailAuthUser = {
  id: string; email: string; nickname: string; isGuest: false; role: "user" | "super"; passwordSetupRequired?: boolean;
};
export type DzmmEmailCodeVerifyResult = {
  user: DzmmEmailAuthUser; authenticated: true; registered: boolean; passwordSetupRequired?: boolean;
};
export type DzmmPasswordResetValues = { email: string; challengeId: string; code: string; newPassword: string };
export type DzmmPasswordResetResult = { user: DzmmEmailAuthUser; authenticated: true; passwordChanged: true };

export class DzmmEmailAuthError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "DzmmEmailAuthError"; }
}

const API = "/api/backend/v1/auth/email";
const PASSWORD_RESET_API = "/api/backend/v1/auth/password";
const EXPIRES_IN = 600;
const RESEND_AFTER = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const malformed = () => new DzmmEmailAuthError(502, "邮箱验证码服务返回的数据无效，请稍后重试。");
const unavailable = () => new DzmmEmailAuthError(503, "邮箱验证码服务暂时不可用，请稍后重试。");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit && !value.includes("\0");

export function normalizeDzmmEmail(email: string): string {
  if (typeof email !== "string") throw new DzmmEmailAuthError(400, "请输入有效的邮箱地址。");
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.includes("\0")) {
    throw new DzmmEmailAuthError(400, "请输入有效的邮箱地址。");
  }
  return normalized;
}

function rejectExposedSecrets(value: unknown) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (Array.isArray(item)) { pending.push(...item); continue; }
    if (!record(item)) continue;
    for (const [key, field] of Object.entries(item)) {
      if (["code", "password", "newpassword", "currentpassword", "passwordhash", "tokenhash"].includes(key.replace(/[_-]/g, "").toLowerCase())) throw malformed();
      if (field !== null && typeof field === "object") pending.push(field);
    }
  }
}

function parseTiming(value: Record<string, unknown>): { expiresIn: 600; resendAfter: 60 } {
  if (value.expiresIn !== EXPIRES_IN || value.resendAfter !== RESEND_AFTER) throw malformed();
  return { expiresIn: EXPIRES_IN, resendAfter: RESEND_AFTER };
}

function requestFailure(status: number, operation: "email" | "password-reset" = "email"): DzmmEmailAuthError {
  const message = status === 400 ? "邮箱或验证码格式无效，请检查后重试。"
    : status === 401 ? "验证码无效或已过期，请重新获取。"
    : status === 403 ? operation === "password-reset" ? "密码重置服务暂时不可用，请稍后重试。" : "邮箱验证码登录暂时不可用，请使用邮箱和密码登录。"
    : status === 409 ? "验证信息已变更，请重新获取验证码。"
    : status === 429 ? "请求过于频繁，请稍后重试。"
    : status === 503 ? unavailable().message : "邮箱验证码请求失败，请稍后重试。";
  return new DzmmEmailAuthError(status, message);
}

async function request(path: string, body?: unknown, signal?: AbortSignal, base = API, operation: "email" | "password-reset" = "email"): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  let rejectCancellation: (reason: unknown) => void = () => undefined;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const canceled = () => rejectCancellation(signal?.aborted ? signal.reason : unavailable());
  controller.signal.addEventListener("abort", canceled, { once: true });
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const transport = (async () => {
      const response = await fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        signal: controller.signal, headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      controller.signal.throwIfAborted();
      const data: unknown = await response.json().catch(() => null);
      controller.signal.throwIfAborted();
      if (!response.ok) throw requestFailure(response.status, operation);
      if (!record(data)) throw malformed();
      rejectExposedSecrets(data);
      return data;
    })();
    return await Promise.race([transport, cancellation]);
  } catch (failure) {
    signal?.throwIfAborted();
    if (failure instanceof DzmmEmailAuthError) throw failure;
    throw unavailable();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", canceled);
  }
}

async function requestPasswordReset(path: string, body: unknown, signal?: AbortSignal) {
  return request(path, body, signal, PASSWORD_RESET_API, "password-reset");
}

export async function fetchDzmmEmailAuthConfig(signal?: AbortSignal): Promise<DzmmEmailAuthConfig> {
  const value = await request("/config", undefined, signal);
  if (typeof value.enabled !== "boolean" || typeof value.note !== "string" || value.note.length > 1000) throw malformed();
  return { enabled: value.enabled, ...parseTiming(value), note: value.note };
}

export async function requestDzmmEmailCode(email: string, signal?: AbortSignal): Promise<DzmmEmailCodeRequestResult> {
  const value = await request("/request", { email: normalizeDzmmEmail(email) }, signal);
  if (typeof value.challengeId !== "string" || !UUID.test(value.challengeId)) throw malformed();
  return { challengeId: value.challengeId, ...parseTiming(value) };
}

export async function verifyDzmmEmailCode(values: DzmmEmailCodeValues, signal?: AbortSignal): Promise<DzmmEmailCodeVerifyResult> {
  if (!record(values) || typeof values.challengeId !== "string" || !UUID.test(values.challengeId) || typeof values.code !== "string" || !/^\d{6}$/.test(values.code)) {
    throw new DzmmEmailAuthError(400, "请输入有效的六位验证码，或重新获取验证码。");
  }
  const email = normalizeDzmmEmail(values.email);
  if (values.nickname !== undefined && !text(values.nickname, 30)) throw new DzmmEmailAuthError(400, "昵称应为 1 至 30 个字符。");
  if (values.accountId !== undefined && !text(values.accountId, 200)) throw new DzmmEmailAuthError(400, "当前账号信息无效，请刷新页面后重试。");
  if (values.referralCode !== undefined && (!text(values.referralCode, 32) || !/^[a-z0-9]+$/i.test(values.referralCode.trim()))) throw new DzmmEmailAuthError(400, "邀请码格式不正确。");
  const body = { email, challengeId: values.challengeId, code: values.code,
    ...(values.nickname === undefined ? {} : { nickname: values.nickname.trim() }),
    ...(values.accountId === undefined ? {} : { accountId: values.accountId }),
    ...(values.referralCode === undefined ? {} : { referralCode: values.referralCode.trim().toUpperCase() }) };
  const value = await request("/verify", body, signal);
  if (value.authenticated !== true || typeof value.registered !== "boolean" || !record(value.user)
    || !text(value.user.id, 200) || value.user.email !== email || !text(value.user.nickname, 30)
    || value.user.isGuest !== false || (value.user.role !== "user" && value.user.role !== "super")
    || (value.passwordSetupRequired !== undefined && typeof value.passwordSetupRequired !== "boolean")
    || (value.user.passwordSetupRequired !== undefined && typeof value.user.passwordSetupRequired !== "boolean")
    || (value.passwordSetupRequired !== undefined && value.user.passwordSetupRequired !== undefined && value.passwordSetupRequired !== value.user.passwordSetupRequired)) throw malformed();
  const user: DzmmEmailAuthUser = { id: value.user.id, email, nickname: value.user.nickname, isGuest: false, role: value.user.role,
    ...(value.user.passwordSetupRequired === undefined ? {} : { passwordSetupRequired: value.user.passwordSetupRequired as boolean }) };
  return { user, authenticated: true, registered: value.registered,
    ...(value.passwordSetupRequired === undefined ? {} : { passwordSetupRequired: value.passwordSetupRequired as boolean }) };
}

export async function requestDzmmPasswordResetCode(email: string, signal?: AbortSignal): Promise<DzmmEmailCodeRequestResult> {
  const value = await requestPasswordReset("/forgot/request", { email: normalizeDzmmEmail(email) }, signal);
  if (typeof value.challengeId !== "string" || !UUID.test(value.challengeId)) throw malformed();
  return { challengeId: value.challengeId, ...parseTiming(value) };
}

export async function resetDzmmPassword(values: DzmmPasswordResetValues, signal?: AbortSignal): Promise<DzmmPasswordResetResult> {
  if (!record(values) || typeof values.challengeId !== "string" || !UUID.test(values.challengeId)
    || typeof values.code !== "string" || !/^\d{6}$/.test(values.code)) {
    throw new DzmmEmailAuthError(400, "请输入有效的六位验证码，或重新获取验证码。");
  }
  const email = normalizeDzmmEmail(values.email);
  if (typeof values.newPassword !== "string" || values.newPassword.length < 12 || values.newPassword.length > 256 || values.newPassword.includes("\0")) {
    throw new DzmmEmailAuthError(400, "新密码需要 12 至 256 个字符。");
  }
  const value = await requestPasswordReset("/forgot/reset", {
    email, challengeId: values.challengeId, code: values.code, newPassword: values.newPassword,
  }, signal);
  if (value.passwordChanged !== true || value.authenticated !== true || !record(value.user)
    || !text(value.user.id, 200) || value.user.email !== email || !text(value.user.nickname, 30)
    || value.user.isGuest !== false || (value.user.role !== "user" && value.user.role !== "super")
    || (value.user.passwordSetupRequired !== undefined && typeof value.user.passwordSetupRequired !== "boolean")) throw malformed();
  const user: DzmmEmailAuthUser = { id: value.user.id, email, nickname: value.user.nickname, isGuest: false, role: value.user.role,
    ...(value.user.passwordSetupRequired === undefined ? {} : { passwordSetupRequired: value.user.passwordSetupRequired as boolean }) };
  return { user, authenticated: true, passwordChanged: true };
}
