export type DzmmTaskId = "daily_checkin" | "first_conversation" | "publish_character" | "follow_authors" | "complete_profile" | "forum_reply";
export type DzmmTaskClaim = {
  taskId: DzmmTaskId; period: string; points: number; claimedAt: number; expiresAt: number | null;
};
export type DzmmTask = {
  id: DzmmTaskId; title: string; description: string; rewardPoints: number;
  repeat: "daily" | "once"; expiresAfterDays: number | null; period: string;
  progress: number; target: number; eligible: boolean; claimed: boolean; claimable: boolean;
  claimedAt: number | null; rewardExpiresAt: number | null;
};
export type DzmmTaskCenter = {
  accountId: string; isGuest: boolean; serverTime: number; resetAt: number; timezone: "UTC";
  pointsKind: "credit"; modelBillingLinked: true; rewardUnit?: "Credit"; note: string;
  points: { balance: number; totalEarned: number; expired: number; expiringSoon: number; earliestExpiryAt: number | null };
  tasks: DzmmTask[]; recentClaims: DzmmTaskClaim[];
};
export type DzmmTaskClaimResult = DzmmTaskCenter & { claim: DzmmTaskClaim };

export class DzmmTaskError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "DzmmTaskError"; }
}
const API = "/api/backend/v1/tasks";
async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    const options = { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) };
    response = await fetch(`${API}${path}`, options as Parameters<typeof fetch>[1]);
  } catch { throw new DzmmTaskError(503, "任务中心暂时无法连接，请稍后重试。"); }
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new DzmmTaskError(response.status, typeof result?.error === "string" ? result.error : "任务请求失败，请刷新任务进度后重试。");
  return result as T;
}
export function fetchDzmmTasks(): Promise<DzmmTaskCenter> { return request(""); }
export function claimDzmmTask(id: DzmmTaskId, accountId: string): Promise<DzmmTaskClaimResult> {
  return request(`/${encodeURIComponent(id)}/claim`, { accountId });
}
