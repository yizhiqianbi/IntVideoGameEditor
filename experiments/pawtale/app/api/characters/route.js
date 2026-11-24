import { validateCustomResident, checkOrigin, readBody, InputError } from "../../../lib/validation.mjs";
import { providerConfig, semanticCheck } from "../../../lib/chat-service.mjs";
export const runtime = "nodejs";
export async function POST(request) {
  try {
    checkOrigin(request);
    const resident = validateCustomResident(await readBody(request));
    const config = providerConfig();
    if (config && !await semanticCheck(config, JSON.stringify(resident))) throw new InputError("请把居民写成适合全年龄的日常角色。");
    return Response.json({ resident });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : "暂时无法检查居民资料，请稍后重试。" }, { status: error instanceof InputError ? 400 : 502 });
  }
}
