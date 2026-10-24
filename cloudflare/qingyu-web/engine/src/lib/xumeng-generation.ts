export type GenerationKind = "image" | "video";
export type GenerationModel = { id: string; label: string; kind: GenerationKind; aspectRatios: string[]; resolutions: string[]; durations: number[]; estimatedCredits?: number; supportsReferenceImage: boolean };
export type GenerationConfig = { accountId: string; enabled: boolean; models: GenerationModel[]; costMultiplier: 3 };
export type GenerationReference = { id: string; name: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; byteLength: number; width: number; height: number; assetUrl: string };
export type GenerationInput = { accountId: string; kind: GenerationKind; modelId: string; prompt: string; aspectRatio: string; duration?: number; templateId?: string; referenceImageId?: string };
export type GenerationQuote = { estimatedCredits: number; maxCredits: number };
export type GenerationJob = { id: string; kind: GenerationKind; modelId: string; prompt: string; templateId?: string; aspectRatio: string; duration?: number;
  status: "pending" | "processing" | "ready" | "failed" | "unknown"; createdAt: number; updatedAt: number; reservedCredits: number; chargedCredits: number; expiresAt: number; finalizedAt: number | null; costBasis: "provider_usage" | "frozen_sku" | "released" | null; providerCostUsd?: number; exceedsReservation: boolean; error?: string; assetUrl?: string; mimeType?: string; referenceImage?: GenerationReference };
export class GenerationError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
const API = "/api/backend/v1/generation";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const amount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const referenceId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const malformed = () => new GenerationError(502, "生成服务返回的数据无效，请刷新任务核对。");
async function request(path: string, accountId: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, { method,  cache: "no-store", signal,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new GenerationError(response.status, record(value) && typeof value.error === "string" ? value.error : "生成服务暂时无法连接，请刷新任务核对。",
    record(value) && typeof value.code === "string" ? value.code : undefined);
  if (!record(value) || value.accountId !== accountId) throw malformed();
  return value;
}
export function parseGenerationJob(value: unknown): GenerationJob {
  if (!record(value) || typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
    || !["image", "video"].includes(value.kind as string) || typeof value.modelId !== "string" || typeof value.prompt !== "string"
    || typeof value.aspectRatio !== "string" || !["pending", "processing", "ready", "failed", "unknown"].includes(value.status as string)
    || !amount(value.createdAt) || !amount(value.updatedAt) || !amount(value.reservedCredits) || !amount(value.chargedCredits)
    || !amount(value.expiresAt) || (value.finalizedAt !== null && !amount(value.finalizedAt)) || typeof value.exceedsReservation !== "boolean"
    || ![null, "provider_usage", "frozen_sku", "released"].includes(value.costBasis as string | null)
    || (value.duration !== undefined && (!amount(value.duration) || value.duration > 30))
    || (value.error !== undefined && typeof value.error !== "string")
    || (value.assetUrl !== undefined && (typeof value.assetUrl !== "string" || value.assetUrl !== `${API}/assets/${value.id}`))
    || (value.status === "ready" && typeof value.assetUrl !== "string")) throw malformed();
  if (value.referenceImage !== undefined) parseGenerationReference(value.referenceImage);
  return value as unknown as GenerationJob;
}
export function parseGenerationReference(value: unknown): GenerationReference {
  if (!record(value) || !referenceId(value.id)
    || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 || /[\x00-\x1f\x7f/\\]/.test(value.name)
    || !["image/png", "image/jpeg", "image/webp"].includes(value.mimeType as string)
    || !amount(value.byteLength) || value.byteLength < 1
    || !amount(value.width) || !amount(value.height) || value.width < 1 || value.height < 1 || value.width > 8192 || value.height > 8192 || value.width * value.height > 20_000_000
    || value.assetUrl !== `${API}/reference-assets/${value.id}`) throw malformed();
  return value as unknown as GenerationReference;
}
export async function uploadGenerationReference(accountId: string, file: File, signal?: AbortSignal): Promise<GenerationReference> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new GenerationError(400, "参考图仅支持 PNG、JPEG 或 WebP。");
  if (!file.size) throw new GenerationError(400, "请选择一张参考图。");
  if (!file.name.trim() || file.name.length > 100 || /[\x00-\x1f\x7f/\\]/.test(file.name)) throw new GenerationError(400, "参考图文件名须在 100 字以内。");
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const value = await request("/references", accountId, "POST", { accountId, name: file.name, dataUrl: `data:${file.type};base64,${btoa(binary)}` }, signal);
  return parseGenerationReference(value.reference);
}
export async function fetchGenerationReference(accountId: string, id: string, signal?: AbortSignal): Promise<GenerationReference> {
  if (!referenceId(id)) throw malformed();
  const value = await request(`/references/${encodeURIComponent(id)}`, accountId, "GET", undefined, signal);
  const reference = parseGenerationReference(value.reference); if (reference.id !== id) throw malformed(); return reference;
}
export async function deleteGenerationReference(accountId: string, id: string, signal?: AbortSignal): Promise<void> {
  if (!referenceId(id)) throw malformed();
  const value = await request(`/references/${encodeURIComponent(id)}`, accountId, "DELETE", { accountId }, signal);
  if (value.deleted !== true) throw malformed();
}
export async function fetchGenerationConfig(accountId: string, signal?: AbortSignal): Promise<GenerationConfig> {
  const value = await request("/config", accountId, "GET", undefined, signal);
  if (typeof value.enabled !== "boolean" || value.costMultiplier !== 3 || !Array.isArray(value.models) || value.models.some(v => !record(v)
    || typeof v.id !== "string" || typeof v.label !== "string" || !["image", "video"].includes(v.kind as string)
    || !Array.isArray(v.aspectRatios) || !v.aspectRatios.every(x => typeof x === "string") || !Array.isArray(v.resolutions)
    || !Array.isArray(v.durations) || !v.durations.every(x => amount(x) && x > 0) || typeof v.supportsReferenceImage !== "boolean")) throw malformed();
  return value as unknown as GenerationConfig;
}
export async function fetchGenerationJobs(accountId: string, signal?: AbortSignal): Promise<GenerationJob[]> {
  const value = await request("/jobs", accountId, "GET", undefined, signal);
  if (!Array.isArray(value.jobs) || value.jobs.length > 100) throw malformed();
  return value.jobs.map(parseGenerationJob);
}
export async function quoteGeneration(input: GenerationInput, signal?: AbortSignal): Promise<GenerationQuote> {
  const value = await request("/quote", input.accountId, "POST", input, signal);
  if (!record(value.quote) || !amount(value.quote.estimatedCredits) || !amount(value.quote.maxCredits) || value.quote.maxCredits < value.quote.estimatedCredits) throw malformed();
  return value.quote as GenerationQuote;
}
export async function createGeneration(input: GenerationInput, requestId: string, expectedMaxCredits: number, signal?: AbortSignal): Promise<GenerationJob> {
  const value = await request("/jobs", input.accountId, "POST", { ...input, requestId, expectedMaxCredits }, signal);
  return parseGenerationJob(value.job);
}
/** Read-only recovery never reserves Credit or submits another supplier job. */
export async function recoverGeneration(accountId: string, requestId: string, signal?: AbortSignal): Promise<GenerationJob> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw malformed();
  const value = await request(`/requests/${encodeURIComponent(requestId)}`, accountId, "GET", undefined, signal);
  return parseGenerationJob(value.job);
}
export async function refreshGeneration(accountId: string, id: string, signal?: AbortSignal): Promise<GenerationJob> {
  const value = await request(`/jobs/${encodeURIComponent(id)}`, accountId, "GET", undefined, signal);
  const job = parseGenerationJob(value.job); if (job.id !== id) throw malformed(); return job;
}
export async function deleteGeneration(accountId: string, id: string, signal?: AbortSignal): Promise<void> {
  const value = await request(`/jobs/${encodeURIComponent(id)}`, accountId, "DELETE", { accountId }, signal);
  if (value.deleted !== true) throw malformed();
}
