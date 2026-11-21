import { channelFailure } from "@/lib/channel";
import { jsonError, sameOrigin } from "@/lib/http";
import { buildNovelPayload } from "@/lib/novel-request.mjs";
import { parseNovelOutput } from "@/lib/novel-format.mjs";
import { connectNovel, connectNovelContinue } from "@/lib/studio-connect";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能使用小说接口。", 403);
  if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: unknown;
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  const built = buildNovelPayload(body);
  if (!built.ok || !built.values) return jsonError(built.error || "请求格式无效。", built.status || 400);
  const values = built.values as unknown as Record<string, string>;
  try {
    const rendered = built.id === "continue-novel"
      ? await connectNovelContinue(
        Buffer.from(built.files.file_url.data, "base64").toString("utf8"),
        values.count ?? "",
        values,
      )
      : await connectNovel(
        values.description,
        values.character_setting ?? "",
        values.count ?? "",
        values.location_scene ?? "",
        values.details ?? "",
      );
    const raw = Buffer.from(rendered.bytes).toString("utf8");
    const mode = built.id === "continue-novel" ? "continue" : "new";
    const parsed = parseNovelOutput(raw, { deriveTitle: mode === "new" });
    return Response.json({
      ok: true,
      mode,
      title: parsed.title,
      sections: parsed.sections,
      plain: parsed.plain,
      wordCount: parsed.wordCount,
      text: parsed.plain,
    }, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    return channelFailure(error);
  }
}
