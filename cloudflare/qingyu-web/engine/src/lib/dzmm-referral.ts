export type DzmmReferralInfo = {
  accountId: string;
  isGuest: boolean;
  inviteCode: string | null;
  inviteUrl: string | null;
  invitedCount: number;
  earnedPoints: number;
  earnedCredits?: number;
  rewardPoints: number;
  rewardCredits?: number;
  totalRewardCredits?: number;
  pointsKind: "credit";
  modelBillingLinked: true;
  rewardUnit?: "Credit";
};

export class DzmmReferralError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "DzmmReferralError";
  }
}

export async function fetchDzmmReferral(): Promise<DzmmReferralInfo> {
  let response: Response;
  try {
    response = await fetch("/api/backend/v1/referral", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new DzmmReferralError(503, "邀请码服务暂时无法连接，请稍后重试。");
  }
  const value = await response.json().catch(() => null) as Partial<DzmmReferralInfo> & { error?: unknown } | null;
  if (!response.ok) {
    throw new DzmmReferralError(response.status, typeof value?.error === "string" ? value.error : "邀请码服务暂时不可用，请稍后重试。");
  }
  if (!value || typeof value.accountId !== "string" || typeof value.isGuest !== "boolean"
    || (value.inviteCode !== null && typeof value.inviteCode !== "string")
    || (value.inviteUrl !== null && typeof value.inviteUrl !== "string")
    || !Number.isInteger(value.invitedCount) || !Number.isInteger(value.earnedPoints)
    || !Number.isInteger(value.rewardPoints) || value.pointsKind !== "credit" || value.modelBillingLinked !== true) {
    throw new DzmmReferralError(502, "邀请码服务返回的数据无效，请稍后重试。");
  }
  return value as DzmmReferralInfo;
}
