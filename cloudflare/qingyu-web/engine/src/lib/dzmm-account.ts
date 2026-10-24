"use client";

import { dzmmCloudRequest } from "./dzmm-cloud";

export async function changeDzmmPassword(accountId: string, currentPassword: string, newPassword: string): Promise<void> {
  if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 200 || accountId.includes("\0")) {
    throw new Error("账号信息无效，请重新加载账号后再修改密码。");
  }
  const result = await dzmmCloudRequest<{ passwordChanged: boolean; accountId: string }>("/auth/password", "POST", { accountId, currentPassword, newPassword });
  if (result?.passwordChanged !== true || result.accountId !== accountId) throw new Error("密码修改结果未通过验证，请重新加载账号后核对。");
}
