import { jsonError, sameOrigin } from "@/lib/http";
import { optimizePrompt } from "@/lib/prompt-optimize.mjs";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能优化提示词。", 403);
  if (request.headers.get("x-adult-confirmed") !== "1") return jsonError("需要先确认已满 18 岁。", 403);
  let body: { text?: unknown; kind?: unknown };
  try { body = await request.json(); } catch { return jsonError("请求格式无效。", 400); }
  if (body.text != null && typeof body.text !== "string") return jsonError("请求格式无效。", 400);
  const kind = body.kind === "character" || body.kind === "image" || body.kind === "story" || body.kind === "video" ? body.kind : body.kind == null ? "video" : "";
  if (!kind) return jsonError("优化类型无效。", 400);
  const result = await optimizePrompt(typeof body.text === "string" ? body.text : "", { kind });
  if (!result.ok) return jsonError(result.error || "提示词没有优化完。", result.error?.includes("还没配上") ? 503 : 502);
  return Response.json({ prompt: result.prompt }, { headers: { "cache-control": "no-store" } });
}
