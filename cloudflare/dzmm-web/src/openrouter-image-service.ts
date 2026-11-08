/**
 * Server-side OpenRouter Image API adapter for the companion media layer.
 *
 * The browser never receives the OpenRouter key.  Keep model selection in a
 * Worker variable because OpenRouter's image catalog changes over time.
 * See https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 */

export type OpenRouterImageEnvironment = {
  /** Preferred name for a dedicated image key. */
  OPENROUTER_API_KEY?: string;
  /** Existing XUMENG secret is accepted for compatibility with chat. */
  DZMM_API_KEY?: string;
  /** Native companion container naming, when the adapter is bundled there. */
  COMPANION_OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  DZMM_BASE_URL?: string;
  COMPANION_OPENROUTER_BASE_URL?: string;
  OPENROUTER_IMAGE_MODEL?: string;
  DZMM_IMAGE_MODEL?: string;
  COMPANION_IMAGE_MODEL?: string;
  OPENROUTER_IMAGE_QUALITY?: string;
  OPENROUTER_IMAGE_RESOLUTION?: string;
  OPENROUTER_IMAGE_ASPECT_RATIO?: string;
  OPENROUTER_IMAGE_OUTPUT_FORMAT?: string;
  /** Optional comma-separated provider preference, forwarded to OpenRouter. */
  OPENROUTER_IMAGE_PROVIDER_ORDER?: string;
};

export type OpenRouterImageRequest = {
  prompt: string;
  model?: string;
  quality?: string;
  resolution?: string;
  aspectRatio?: string;
  outputFormat?: string;
  inputReferences?: string[];
};

export type OpenRouterImageResult = {
  bytes: ArrayBuffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  model: string;
  index: number;
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MAX_PROMPT_CHARS = 4000;
const MAX_REFERENCE_CHARS = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_PROVIDER_JSON_BYTES = 24 * 1024 * 1024;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$/;
const QUALITY = new Set(["auto", "low", "medium", "high"]);
const RESOLUTION = new Set(["512", "1K", "2K", "4K"]);
const OUTPUT_FORMATS = new Set(["png", "jpeg", "webp", "svg"]);
const ASPECT_RATIO = /^(?:[1-9]\d?):(?:[1-9]\d?)$/;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function config(env: OpenRouterImageEnvironment, requestedModel?: string) {
  const key = text(env.OPENROUTER_API_KEY) ?? text(env.DZMM_API_KEY) ?? text(env.COMPANION_OPENROUTER_API_KEY);
  const base = text(env.OPENROUTER_BASE_URL) ?? text(env.DZMM_BASE_URL) ?? text(env.COMPANION_OPENROUTER_BASE_URL) ?? OPENROUTER_BASE;
  const model = text(requestedModel) ?? text(env.OPENROUTER_IMAGE_MODEL) ?? text(env.DZMM_IMAGE_MODEL) ?? text(env.COMPANION_IMAGE_MODEL);
  if (!key || !model || !MODEL_PATTERN.test(model)) return null;
  let url: URL;
  try { url = new URL(base); } catch { return null; }
  // This adapter intentionally targets OpenRouter.  An arbitrary base URL
  // would turn a user-controlled Worker variable into an SSRF primitive.
  if (url.protocol !== "https:" || url.hostname !== "openrouter.ai" || url.pathname.replace(/\/+$/, "") !== "/api/v1") return null;
  return { key, endpoint: `${url.href.replace(/\/+$/, "")}/images`, model };
}

function safeInput(input: unknown): OpenRouterImageRequest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const keys = ["prompt", "model", "quality", "resolution", "aspectRatio", "outputFormat", "inputReferences"];
  if (Object.keys(value).some(key => !keys.includes(key))) return null;
  const prompt = text(value.prompt);
  if (!prompt || prompt.length > MAX_PROMPT_CHARS || prompt.includes("\0")) return null;
  const model = value.model === undefined ? undefined : text(value.model);
  if (value.model !== undefined && (!model || !MODEL_PATTERN.test(model))) return null;
  const quality = value.quality === undefined ? undefined : text(value.quality);
  if (value.quality !== undefined && (!quality || !QUALITY.has(quality))) return null;
  const resolution = value.resolution === undefined ? undefined : text(value.resolution);
  if (value.resolution !== undefined && (!resolution || !RESOLUTION.has(resolution))) return null;
  const aspectRatio = value.aspectRatio === undefined ? undefined : text(value.aspectRatio);
  if (value.aspectRatio !== undefined && (!aspectRatio || !ASPECT_RATIO.test(aspectRatio))) return null;
  const outputFormat = value.outputFormat === undefined ? undefined : text(value.outputFormat)?.toLowerCase();
  if (value.outputFormat !== undefined && (!outputFormat || !OUTPUT_FORMATS.has(outputFormat))) return null;
  let inputReferences: string[] | undefined;
  if (value.inputReferences !== undefined) {
    if (!Array.isArray(value.inputReferences) || value.inputReferences.length > 4) return null;
    inputReferences = [];
    let total = 0;
    for (const reference of value.inputReferences) {
      if (typeof reference !== "string" || reference.length < 12 || reference.length > MAX_REFERENCE_CHARS
        || (!reference.startsWith("https://") && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(reference))) return null;
      total += reference.length;
      if (total > MAX_REFERENCE_CHARS) return null;
      inputReferences.push(reference);
    }
  }
  return { prompt, ...(model ? { model } : {}), ...(quality ? { quality } : {}), ...(resolution ? { resolution } : {}),
    ...(aspectRatio ? { aspectRatio } : {}), ...(outputFormat ? { outputFormat } : {}), ...(inputReferences ? { inputReferences } : {}) };
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body || Number(response.headers.get("Content-Length")) > limit) throw new Error("provider response too large");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("provider response too large"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function decodeBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length < 16 || value.length > Math.ceil(MAX_OUTPUT_BYTES * 4 / 3) + 64
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) return null;
  try {
    const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
    return bytes.length > 0 && bytes.length <= MAX_OUTPUT_BYTES ? bytes : null;
  } catch { return null; }
}

function mimeFor(bytes: Uint8Array, requested?: string): OpenRouterImageResult["mimeType"] | null {
  if ((requested === "svg" || requested === "image/svg+xml") && new TextDecoder().decode(bytes.slice(0, 256)).trimStart().startsWith("<svg")) return "image/svg+xml";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function openRouterImageConfigured(env: OpenRouterImageEnvironment): boolean {
  return config(env) !== null;
}

/**
 * Generate one image through OpenRouter's dedicated `/api/v1/images` endpoint.
 * The provider's base64 response is decoded at the edge and returned as bytes;
 * provider URLs and credentials never cross into the browser.
 */
export async function generateOpenRouterImage(
  env: OpenRouterImageEnvironment,
  input: unknown,
  request: typeof fetch = fetch,
): Promise<OpenRouterImageResult> {
  const value = safeInput(input);
  if (!value) throw new Error("图片生成请求无效。");
  const selected = config(env, value.model);
  if (!selected) throw new Error("图片生成服务尚未配置。");
  const providerOrder = text(env.OPENROUTER_IMAGE_PROVIDER_ORDER)?.split(",").map(item => item.trim()).filter(Boolean);
  const body: Record<string, unknown> = { model: selected.model, prompt: value.prompt, n: 1 };
  if (value.quality ?? text(env.OPENROUTER_IMAGE_QUALITY)) body.quality = value.quality ?? text(env.OPENROUTER_IMAGE_QUALITY);
  if (value.resolution ?? text(env.OPENROUTER_IMAGE_RESOLUTION)) body.resolution = value.resolution ?? text(env.OPENROUTER_IMAGE_RESOLUTION);
  if (value.aspectRatio ?? text(env.OPENROUTER_IMAGE_ASPECT_RATIO)) body.aspect_ratio = value.aspectRatio ?? text(env.OPENROUTER_IMAGE_ASPECT_RATIO);
  if (value.outputFormat ?? text(env.OPENROUTER_IMAGE_OUTPUT_FORMAT)) body.output_format = value.outputFormat ?? text(env.OPENROUTER_IMAGE_OUTPUT_FORMAT);
  if (value.inputReferences) body.input_references = value.inputReferences;
  if (providerOrder?.length) body.provider = { order: providerOrder, allow_fallbacks: true };
  try {
    const response = await request(selected.endpoint, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${selected.key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const bytes = await boundedBytes(response, MAX_PROVIDER_JSON_BYTES);
    if (!response.ok) throw new Error("image provider failed");
    let result: unknown;
    try { result = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { throw new Error("image provider response invalid"); }
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("image provider response invalid");
    const rows = (result as Record<string, unknown>).data;
    if (!Array.isArray(rows) || !rows.length || !rows[0] || typeof rows[0] !== "object") throw new Error("image provider response invalid");
    const row = rows[0] as Record<string, unknown>;
    const decoded = decodeBase64(row.b64_json);
    const mime = mimeFor(decoded ?? new Uint8Array(), typeof row.mime_type === "string" ? row.mime_type : typeof row.media_type === "string" ? row.media_type : value.outputFormat);
    if (!decoded || !mime) throw new Error("image provider output invalid");
    return { bytes: decoded.buffer as ArrayBuffer, mimeType: mime, model: selected.model, index: 0 };
  } catch (error) {
    if (error instanceof Error && (error.message === "图片生成请求无效。" || error.message === "图片生成服务尚未配置。")) throw error;
    throw new Error("图片生成失败，请稍后重试。");
  }
}
