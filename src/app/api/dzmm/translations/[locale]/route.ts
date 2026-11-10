import { NextResponse } from "next/server";

const SUPPORTED = new Set(["en", "zh-Hant", "ja", "ko"]);

/**
 * Backend-owned entry point for the public card translation shards.
 * The shard remains CDN/static-file backed, while clients only depend on this
 * server route and can be moved to D1/R2 without changing the UI contract.
 */
export const dynamic = "force-static";

export async function GET(
  request: Request,
  context: { params: Promise<{ locale: string }> },
) {
  const { locale } = await context.params;
  if (!SUPPORTED.has(locale)) return NextResponse.json({ error: "不支持的语言。" }, { status: 404 });
  const target = new URL(`/dzmm/i18n/cards-${locale}.json`, request.url);
  return NextResponse.redirect(target, 307);
}
