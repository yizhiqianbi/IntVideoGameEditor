import { KREA2_STYLES } from "./xumeng-krea2-styles.ts";
import { STUDIO_STILL_CREDITS } from "./xumeng-studio-still-billing.ts";

const TEMPLATE_ID = /^krea2-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STYLE_IDS = new Set<string>(KREA2_STYLES.map(item => item.id));
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type Krea2StillRequest = { templateId: string; prompt: string; image: string; style?: string };

function jsonResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function serviceUrl(base: string, path: string): URL | null {
  let root: URL;
  try { root = new URL(base); } catch { return null; }
  if (root.protocol !== "http:" && root.protocol !== "https:") return null;
  return new URL(path, root);
}

function outputName(templateId: string, value: unknown): string | null {
  if (typeof value !== "string" || !new RegExp(`^${templateId}-\\d{1,10}\\.png$`).test(value)) return null;
  return value;
}

export async function requestKrea2Still(input: Krea2StillRequest, signal?: AbortSignal): Promise<{ image: Blob; chargedCredits: number }> {
  const response = await fetch("/api/krea2/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId: input.templateId, prompt: input.prompt, image: input.image, style: input.style ?? "photo" }),
    signal,
  });
  if (!response.ok || !response.headers.get("Content-Type")?.includes("image/png")) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof payload?.error === "string" ? payload.error : "出图没有完成。");
  }
  const chargedCredits = Number(response.headers.get("X-Charged-Credits"));
  if (chargedCredits !== STUDIO_STILL_CREDITS) throw new Error("扣费没有完成，这次没有出图。");
  return { image: await response.blob(), chargedCredits };
}

export async function renderKrea2Still(base: string, body: unknown, fetchImpl: typeof fetch = fetch, templateImage = ""): Promise<Response> {
  const record = body && typeof body === "object" ? body as { templateId?: unknown; prompt?: unknown; image?: unknown } : {};
  const templateId = typeof record.templateId === "string" ? record.templateId : "";
  if (!TEMPLATE_ID.test(templateId)) return jsonResponse("没有这个画面模板。", 400);
  const supplied = typeof record.image === "string" ? record.image.trim() : "";
  const image = supplied.includes(",") ? supplied.slice(supplied.indexOf(",") + 1) : supplied;
  if (!/^[A-Za-z0-9+/=]+$/.test(image) || image.length < 32) return jsonResponse("请先上传参考图。", 400);
  const prompt = typeof record.prompt === "string" ? record.prompt.slice(0, 4000) : "";
  const requestedStyle = typeof (record as { style?: unknown }).style === "string" ? (record as { style: string }).style : "";
  const style = STYLE_IDS.has(requestedStyle) ? requestedStyle : "photo";
  const generateUrl = serviceUrl(base, "/generate");
  if (!generateUrl) return jsonResponse("出图服务还没接上。", 503);
  let generated: Response;
  try {
    generated = await fetchImpl(generateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, prompt, image, style, ...(templateImage ? { templateImage } : {}) }),
      redirect: "manual",
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    return jsonResponse("出图服务暂时连不上。", 503);
  }
  if (generated.status >= 300 && generated.status < 400) return jsonResponse("出图服务暂时连不上。", 503);
  const payload = await generated.json().catch(() => null) as { error?: unknown; file?: unknown } | null;
  if (!generated.ok) return jsonResponse(typeof payload?.error === "string" ? payload.error : "出图没有完成。", generated.status === 422 ? 422 : 502);
  const file = outputName(templateId, payload?.file);
  const imageUrl = file ? serviceUrl(base, `/output/${file}`) : null;
  if (!imageUrl) return jsonResponse("出图服务没有返回图片。", 502);
  let rendered: Response;
  try {
    rendered = await fetchImpl(imageUrl, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
  } catch {
    return jsonResponse("图片没有取回来。", 502);
  }
  const bytes = new Uint8Array(await rendered.arrayBuffer());
  if (!rendered.ok || bytes.byteLength < PNG.byteLength || bytes.byteLength > 20_000_000 || !PNG.every((value, index) => bytes[index] === value)) {
    return jsonResponse("出图服务返回的不是图片。", 502);
  }
  return new Response(bytes, {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
