const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const CANONICAL_HOST = "xumengchat.top";
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export type IndexNowEnv = {
  INDEXNOW_KEY?: string;
};

export type IndexNowSubmissionResult = {
  ok: boolean;
  submitted: number;
  status: number;
  skippedReason?: string;
};

export function validIndexNowKey(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  return KEY_PATTERN.test(trimmed) ? trimmed : null;
}

/** Serve the IndexNow ownership verification file at /{INDEXNOW_KEY}.txt when configured. */
export function indexNowKeyResponse(request: Request, rawPath: string, env: IndexNowEnv): Response | null {
  const key = validIndexNowKey(env.INDEXNOW_KEY);
  if (!key) return null;
  if (rawPath !== `/${key}.txt`) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "请求方法不支持。" }), {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return new Response(request.method === "HEAD" ? null : key, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function normalizeIndexNowUrls(urls: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const candidate of urls) {
    if (typeof candidate !== "string") continue;
    let parsed: URL;
    try {
      parsed = new URL(candidate, CANONICAL_ORIGIN);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== CANONICAL_HOST) continue;
    parsed.hash = "";
    unique.add(parsed.href);
    if (unique.size >= 10_000) break;
  }
  return [...unique];
}

export async function submitIndexNowUrls(
  urls: readonly string[],
  env: IndexNowEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<IndexNowSubmissionResult> {
  const key = validIndexNowKey(env.INDEXNOW_KEY);
  if (!key) return { ok: false, submitted: 0, status: 0, skippedReason: "INDEXNOW_KEY not configured" };
  const urlList = normalizeIndexNowUrls(urls);
  if (urlList.length === 0) return { ok: false, submitted: 0, status: 0, skippedReason: "No valid canonical URLs" };
  const payload = {
    host: CANONICAL_HOST,
    key,
    keyLocation: `${CANONICAL_ORIGIN}/${key}.txt`,
    urlList,
  };
  const response = await fetchImpl(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8_000),
  });
  await response.body?.cancel();
  return {
    ok: response.status >= 200 && response.status < 300,
    submitted: urlList.length,
    status: response.status,
  };
}
