/** Stop inherited money endpoints before reaching a provider or the ledger. */
export async function editionBoundary(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const backendPath = path.replace(/^\/api\/(?:dzmm\/)?backend(?=\/)/, "");
  let commerce = /^\/api\/payments(?:\/|$)/.test(path)
    || /^\/v1\/(?:payments|nowpayments|subscriptions|dream-coin|referrals?)(?:\/|$)/.test(backendPath)
    || /^\/v1\/admin\/(?:orders|subscriptions)(?:\/|$)/.test(backendPath)
    || /^\/v1\/admin\/users\/[^/]+\/credits\/?$/.test(backendPath);
  // Registration must not silently credit an inviter through an old shared URL
  // or a hand-written request while the referral feature is closed.
  if (!commerce && request.method === "POST" && /^\/v1\/auth(?:\/|$)/.test(backendPath)
    && request.headers.get("Content-Type")?.includes("application/json")) {
    try {
      const body = await request.clone().json() as Record<string, unknown>;
      commerce = Boolean(body && typeof body === "object" && (body.referralCode || body.inviteCode));
    } catch { /* The auth handler owns normal malformed-body errors. */ }
  }
  const externalCall = /^\/api\/(?:phone|live)(?:\/|$)/.test(path);
  if (!commerce && !externalCall) return null;
  return Response.json({ error: "当前版本暂未开放此功能。", code: "FEATURE_UNAVAILABLE" }, {
    status: 404, headers: { "Cache-Control": "no-store" },
  });
}
