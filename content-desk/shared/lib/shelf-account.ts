"use client";

import { shelfCloudRequest, type ShelfCloudUser } from "./shelf-cloud";

export async function changeShelfPassword(accountId: string, currentPassword: string, newPassword: string): Promise<void> {
  if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 200 || accountId.includes("\0")) {
    throw new Error("账号信息无效，请重新加载账号后再修改密码。");
  }
  const result = await shelfCloudRequest<{ passwordChanged: boolean; accountId: string }>("/auth/password", "POST", { accountId, currentPassword, newPassword });
  if (result?.passwordChanged !== true || result.accountId !== accountId) throw new Error("密码修改结果未通过验证，请重新加载账号后核对。");
}

export async function requestShelfEmailBind(accountId: string, email: string) {
  if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 200 || accountId.includes("\0")) {
    throw new Error("账号信息无效，请重新加载后再绑定邮箱。");
  }
  const result = await shelfCloudRequest<{ challengeId: string; expiresIn: number; resendAfter: number }>("/auth/email/bind/request", "POST", { accountId, email });
  if (typeof result?.challengeId !== "string" || !result.challengeId) throw new Error("验证码发送结果无效，请重试。");
  return result;
}

export async function verifyShelfEmailBind(accountId: string, email: string, challengeId: string, code: string): Promise<ShelfCloudUser> {
  const result = await shelfCloudRequest<{ user: ShelfCloudUser }>("/auth/email/bind", "POST", { accountId, email, challengeId, code });
  const boundEmail = email.trim().toLowerCase();
  if (!result?.user || result.user.id !== accountId || result.user.email !== boundEmail || result.user.isGuest) {
    throw new Error("邮箱绑定结果未通过验证，请重新加载账号后核对。");
  }
  return result.user;
}
