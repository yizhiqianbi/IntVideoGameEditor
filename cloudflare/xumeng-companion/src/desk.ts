import { DurableObject } from "cloudflare:workers";
import { clipOutreach, reviveDue, reviveIntent, type ReviveLane } from "./outreach";

type Env = {
  COMPANIONS: DurableObjectNamespace;
};

const KEY = /^[a-z0-9:-]{1,80}$/;

function laneKey(accountId: string, profile: string) {
  return `${accountId}:${profile}`;
}

function cleanLane(value: unknown): ReviveLane | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const lane = value as ReviveLane;
  if (!/^[a-f0-9-]{36}$/.test(lane.accountId) || !KEY.test(lane.profile) || !/^[a-f0-9-]{36}$/.test(lane.sessionId)) return null;
  if (![lane.lastUserAt, lane.lastSeenAt].every(item => Number.isSafeInteger(item) && item >= 0)) return null;
  return {
    accountId: lane.accountId,
    profile: lane.profile,
    sessionId: lane.sessionId,
    lastUserAt: lane.lastUserAt,
    lastUserText: clipOutreach(lane.lastUserText || "", 80),
    lastSeenAt: lane.lastSeenAt,
    lastRevivedAt: Number.isSafeInteger(lane.lastRevivedAt) && lane.lastRevivedAt >= 0 ? lane.lastRevivedAt : 0,
    lastAttemptAt: Number.isSafeInteger(lane.lastAttemptAt) && lane.lastAttemptAt >= 0 ? lane.lastAttemptAt : 0,
    quiet: lane.quiet === true,
  };
}

export class CompanionDesk extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const accountId = (request.headers.get("x-xumeng-account-id") || "").toLowerCase();
    const profile = request.headers.get("x-xumeng-companion-profile") || "";
    if (!/^[a-f0-9-]{36}$/.test(accountId) || !KEY.test(profile)) {
      return Response.json({ error: "无法访问这段聊天。" }, { status: 403 });
    }
    const key = laneKey(accountId, profile);
    if (request.method !== "POST") return Response.json({ error: "请求方法不支持。" }, { status: 405 });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) return Response.json({ error: "请求内容无效。" }, { status: 400 });
    await this.ensureAlarm();
    if (url.pathname === "/api/desk/seen") return Response.json(await this.seen(key));
    if (url.pathname === "/api/desk/touch") return Response.json(await this.touch(key, accountId, profile, body));
    if (url.pathname === "/api/desk/revived") return Response.json(await this.revived(key));
    return Response.json({ error: "聊天接口不存在。" }, { status: 404 });
  }

  alarm(): Promise<void> {
    return this.sweep();
  }

  private async sweep() {
    try {
      const listed = await this.ctx.storage.list<ReviveLane>({ prefix: "lane:" });
      const due = reviveDue([...listed.values()].flatMap(value => {
        const lane = cleanLane(value);
        return lane ? [lane] : [];
      }));
      const lane = due[0];
      if (lane) await this.wake(lane);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
  }

  /** Start the account runtime and let the native companion decide the line. */
  private async wake(lane: ReviveLane) {
    const key = laneKey(lane.accountId, lane.profile);
    lane.lastAttemptAt = Date.now();
    await this.putLane(key, lane);
    const id = this.env.COMPANIONS.idFromName(lane.profile === "classic" ? lane.accountId : `${lane.accountId}:${lane.profile}`);
    try {
      const response = await this.env.COMPANIONS.get(id).fetch(new Request(`https://companion.internal/api/sessions/${lane.sessionId}/proactive`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-xumeng-account-id": lane.accountId,
          "x-xumeng-companion-profile": lane.profile,
        },
        body: JSON.stringify({
          intent: reviveIntent(lane.profile),
          reason: "offline_session_revive",
          userMessageId: `desk:${lane.lastUserAt}`,
          metadata: { source: "xumeng-companion-desk" },
        }),
        signal: AbortSignal.timeout(150_000),
      }));
      await response.body?.cancel();
      if (!response.ok) return;
      lane.lastRevivedAt = Date.now();
      await this.putLane(key, lane);
    } catch {
      /* The next sweep retries after the attempt gap. The container is not kept warm. */
    }
  }

  private async seen(key: string) {
    const lane = await this.lane(key);
    if (lane) { lane.lastSeenAt = Date.now(); await this.putLane(key, lane); }
    return { ok: true };
  }

  private async touch(key: string, accountId: string, profile: string, body: Record<string, unknown>) {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.toLowerCase() : "";
    const text = typeof body.text === "string" ? clipOutreach(body.text, 80) : "";
    if (!/^[a-f0-9-]{36}$/.test(sessionId) || !text) return { ok: false };
    const now = Date.now();
    const current = await this.lane(key);
    await this.putLane(key, {
      accountId, profile, sessionId,
      lastUserAt: now,
      lastUserText: text,
      lastSeenAt: now,
      lastRevivedAt: current?.lastRevivedAt || 0,
      lastAttemptAt: 0,
      quiet: false,
    });
    return { ok: true };
  }

  private async revived(key: string) {
    const lane = await this.lane(key);
    if (!lane) return { ok: false };
    lane.lastRevivedAt = Date.now();
    lane.lastAttemptAt = lane.lastRevivedAt;
    await this.putLane(key, lane);
    return { ok: true };
  }

  private async lane(key: string) {
    return cleanLane(await this.ctx.storage.get(`lane:${key}`));
  }

  private putLane(key: string, lane: ReviveLane) {
    return this.ctx.storage.put(`lane:${key}`, lane);
  }

  private async ensureAlarm() {
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 60_000);
  }
}
