import { generateReply, providerConfig } from "../../../lib/chat-service.mjs";
import { checkOrigin, InputError, readBody, validateChatBody } from "../../../lib/validation.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json({ mode: providerConfig() ? "model" : "demo", brand: "PAWTALE" }); }
  catch { return Response.json({ mode: "unavailable", error: "模型配置有误，请检查尾语的独立环境变量。" }, { status: 503 }); }
}
export async function POST(request) {
  try {
    checkOrigin(request);
    const input = validateChatBody(await readBody(request));
    return Response.json(await generateReply(input));
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : "居民暂时没能收到消息，请稍后重试，并检查尾语的模型配置。" }, { status: error instanceof InputError ? 400 : 502 });
  }
}
