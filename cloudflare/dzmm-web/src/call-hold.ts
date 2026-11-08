const BACKEND = "https://dzmm-backend.850587960.workers.dev";
export const CALL_CREDITS = 200;

type Backend = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
type Hold = { id: string; claimToken: string };

function headers(request: Request): Headers {
  const headers = new Headers({ "Content-Type": "application/json", Accept: "application/json", Origin: BACKEND });
  const session = (request.headers.get("Cookie") || "").split(";").map(part => part.trim()).find(part => /^dzmm_session=[^;\s]+$/.test(part));
  if (session) headers.set("Cookie", session);
  return headers;
}

function failure(status: number, error: string): Response {
  return Response.json({ error, ...(status === 402 ? { code: "insufficient_credits", requiredCredits: CALL_CREDITS } : {}) }, {
    status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function reserveCall(env: { BACKEND: Backend }, request: Request, kind: "phone" | "video"): Promise<Hold | Response> {
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND}/v1/calls`, {
    method: "POST", headers: headers(request), redirect: "manual",
    body: JSON.stringify({ kind, requestId: crypto.randomUUID() }),
  }));
  const payload = await upstream.json().catch(() => null) as { error?: unknown; reservationId?: unknown; claimToken?: unknown; credits?: unknown } | null;
  if (upstream.status === 401) return failure(401, "请先登录正式账号，再使用通话。");
  if (upstream.status === 403) return failure(403, "请先登录正式账号，再使用通话。");
  if (upstream.status === 402) return failure(402, typeof payload?.error === "string" ? payload.error : `可用 Credit 不足，语音和视频通话需要至少 ${CALL_CREDITS} Credit。`);
  if (upstream.status === 429) return failure(429, typeof payload?.error === "string" ? payload.error : "已有一通预扣中的通话，请先结束再拨。");
  if (!upstream.ok || payload?.credits !== CALL_CREDITS || typeof payload.reservationId !== "string" || typeof payload.claimToken !== "string") {
    return failure(502, "扣费没有完成，通话没有接通。");
  }
  return { id: payload.reservationId, claimToken: payload.claimToken };
}

export async function settleCall(env: { BACKEND: Backend }, request: Request, hold: Hold, outcome: "charge" | "release"): Promise<boolean> {
  const upstream = await env.BACKEND.fetch(new Request(`${BACKEND}/v1/calls/${hold.id}/${outcome}`, {
    method: "POST", headers: headers(request), redirect: "manual",
    body: JSON.stringify({ claimToken: hold.claimToken }),
  })).catch(() => null);
  if (!upstream?.ok) return false;
  if (outcome === "release") return true;
  const payload = await upstream.json().catch(() => null) as { status?: unknown; credits?: unknown } | null;
  return payload?.status === "charged" && payload.credits === CALL_CREDITS;
}
