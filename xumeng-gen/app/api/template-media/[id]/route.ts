import { customImage, customImageBytes } from "@/lib/custom-templates";
import { localCover } from "@/lib/live-edits";
import { jsonError } from "@/lib/http";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const item = customImage(id);
  const file = item ? customImageBytes(item) : null;
  const cover = file ?? localCover("image", id) ?? localCover("video", id);
  if (!cover) return jsonError("没有这个模板。", 404);
  return new NextResponse(new Uint8Array(cover.bytes), {
    headers: {
      "Content-Type": cover.type,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
