const MODEL = "seedream-5-0-flash-NSFW";
const ORIGIN = "https://www.whatstoken.ai";
const SIZES: Record<string, string> = {
  "9:16": "1152x2048",
  "3:4": "1536x2048",
  "1:1": "2048x2048",
  "4:3": "2048x1536",
  "16:9": "2048x1152",
};

export type SeedreamStill = { bytes: Uint8Array; mime: "image/jpeg" | "image/png" | "image/webp" };

function dataUrl(image: string): string {
  const trimmed = image.trim();
  if (/^https:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) return trimmed;
  const payload = trimmed.includes(",") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
  return `data:image/jpeg;base64,${payload}`;
}

function allowedDownload(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && !url.username && !url.password && !url.port
    && ["volces.com", "byteimg.com", "bytepluses.com"].some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

function sniff(bytes: Uint8Array): SeedreamStill["mime"] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  return null;
}

export async function generateSeedreamFlash(input: {
  apiKey: string;
  prompt: string;
  image?: string;
  ratio?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<SeedreamStill> {
  const key = input.apiKey.trim();
  const prompt = input.prompt.trim().slice(0, 2000);
  if (!key || !prompt) throw new Error("出图服务还没接上。");
  const fetcher = input.fetchImpl ?? fetch;
  const size = input.ratio && SIZES[input.ratio] ? SIZES[input.ratio] : "2K";
  const body: Record<string, unknown> = { model: MODEL, prompt, size, watermark: false };
  if (input.image?.trim()) body.image = dataUrl(input.image);
  const generated = await fetcher(`${ORIGIN}/v1/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "manual",
    signal: input.signal ?? AbortSignal.timeout(110_000),
  });
  const payload = await generated.json().catch(() => null) as { data?: { url?: unknown }[]; error?: { message?: unknown } } | null;
  if (!generated.ok || generated.status >= 300 && generated.status < 400) {
    const message = typeof payload?.error?.message === "string" ? payload.error.message : "";
    throw new Error(message.includes("balance") || message.toLowerCase().includes("quota") ? "出图额度不足，请稍后再试。" : "出图没有完成。");
  }
  const href = payload?.data?.[0]?.url;
  if (typeof href !== "string") throw new Error("出图服务没有返回图片。");
  const url = new URL(href);
  if (!allowedDownload(url)) throw new Error("出图服务没有返回图片。");
  const rendered = await fetcher(url.href, { redirect: "manual", signal: input.signal ?? AbortSignal.timeout(60_000) });
  if (!rendered.ok || rendered.status >= 300 && rendered.status < 400) throw new Error("图片没有取回来。");
  const bytes = new Uint8Array(await rendered.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime || bytes.byteLength > 20_000_000) throw new Error("出图服务返回的不是图片。");
  return { bytes, mime };
}
