import { readFile } from "node:fs/promises";
import path from "node:path";
import { XUMENG_VIDEO_CATALOG_URL } from "@/lib/xumeng-video-catalog";

async function catalogBody() {
  try {
    const upstream = await fetch(XUMENG_VIDEO_CATALOG_URL, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw new Error("upstream");
    }
    const body = await upstream.text();
    JSON.parse(body);
    return body;
  } catch {
    const file = path.join(process.cwd(), "cloudflare/video-web/public/catalog.json");
    const body = await readFile(file, "utf8");
    JSON.parse(body);
    return body;
  }
}

export async function GET() {
  try {
    return new Response(await catalogBody(), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "视频目录暂时读不出来。" }, { status: 404 });
  }
}
