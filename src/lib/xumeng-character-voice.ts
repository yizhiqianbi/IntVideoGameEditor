import { getXumengSpeechVoice, type XumengSpeechVoiceId, XUMENG_SPEECH_VOICES } from "./xumeng-voices";

export const XUMENG_CHARACTER_VOICE_MODEL = "@cf/myshell-ai/melotts";
const API = "/api/backend/v1/character-voice";
export type XumengCharacterVoiceAsset = {
  id: string; name: string; sourceKey: string; sourceHash: string; model: typeof XUMENG_SPEECH_VOICES[number]["model"]; voiceId: XumengSpeechVoiceId;
  url: string; createdAt: number; mimeType: "audio/mpeg" | "audio/wav"; audioTextChars: number; totalTextChars: number;
};
export type XumengCharacterVoiceOverview = {
  accountId: string; vip: { active: boolean; expiresAt: number | null; adminPreview: boolean; unlimited: boolean };
  quotaUnlimited: boolean; enabled: boolean; model: typeof XUMENG_CHARACTER_VOICE_MODEL;
  speechVoices: XumengSpeechVoiceId[];
  limits: { audio: number; maxVoiceChars: number }; usage: { audio: number };
};
export class XumengCharacterVoiceError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); this.name = "XumengCharacterVoiceError"; }
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const timestamp = (value: unknown): value is number => count(value) && value <= 8_640_000_000_000_000;
const invalid = () => new XumengCharacterVoiceError(502, "朗读返回格式无效，请刷新状态后重试。");
export function parseXumengCharacterVoiceOverview(value: unknown, accountId: string): XumengCharacterVoiceOverview {
  if (!object(value) || value.accountId !== accountId || !object(value.vip) || typeof value.vip.active !== "boolean"
    || typeof value.vip.adminPreview !== "boolean" || typeof value.vip.unlimited !== "boolean"
    || (value.vip.expiresAt !== null && !timestamp(value.vip.expiresAt))
    || typeof value.quotaUnlimited !== "boolean" || value.quotaUnlimited !== value.vip.unlimited
    || typeof value.enabled !== "boolean" || value.model !== XUMENG_CHARACTER_VOICE_MODEL
    || !object(value.limits) || value.limits.audio !== 20 || value.limits.maxVoiceChars !== 800
    || !object(value.usage) || !count(value.usage.audio)) throw invalid();
  const voices = value.speechVoices === undefined ? (value.enabled ? ["melotts"] : []) : value.speechVoices;
  if (!Array.isArray(voices) || voices.some(id => !getXumengSpeechVoice(id)) || new Set(voices).size !== voices.length
    || value.enabled !== (voices.length > 0)) throw invalid();
  return { accountId, vip: { active: value.vip.active, expiresAt: value.vip.expiresAt as number | null,
    adminPreview: value.vip.adminPreview, unlimited: value.vip.unlimited }, quotaUnlimited: value.quotaUnlimited,
    enabled: value.enabled, model: XUMENG_CHARACTER_VOICE_MODEL, speechVoices: voices as XumengSpeechVoiceId[],
    limits: { audio: 20, maxVoiceChars: 800 }, usage: { audio: value.usage.audio } };
}
export function parseXumengCharacterVoiceAsset(value: unknown): XumengCharacterVoiceAsset {
  const voice = object(value) ? getXumengSpeechVoice(value.voiceId === undefined ? "melotts" : value.voiceId) : undefined;
  if (!object(value) || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)
    || typeof value.name !== "string" || !value.name.trim() || value.name.length > 120
    || typeof value.sourceKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,279}$/.test(value.sourceKey)
    || typeof value.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceHash)
    || value.url !== `${API}/assets/${value.id}` || !voice || value.model !== voice.model || !timestamp(value.createdAt)
    || (value.mimeType !== "audio/mpeg" && value.mimeType !== "audio/wav")
    || !count(value.audioTextChars) || value.audioTextChars === 0 || value.audioTextChars > 800
    || !count(value.totalTextChars) || value.totalTextChars < value.audioTextChars || value.totalTextChars > 800) throw invalid();
  return { id: value.id, name: value.name, sourceKey: value.sourceKey, sourceHash: value.sourceHash, model: voice.model, voiceId: voice.id,
    url: value.url, createdAt: value.createdAt, mimeType: value.mimeType, audioTextChars: value.audioTextChars, totalTextChars: value.totalTextChars };
}
export async function fingerprintXumengCharacterVoice(name: string, sourceKey: string, text: string, voiceId: XumengSpeechVoiceId = "melotts"): Promise<string> {
  const voice = getXumengSpeechVoice(voiceId);
  if (!voice) throw new XumengCharacterVoiceError(400, "请选择可用的朗读音色。", "invalid_voice_request");
  const value = JSON.stringify(voice.id === "melotts" ? { name: name.trim(), sourceKey, text, model: XUMENG_CHARACTER_VOICE_MODEL }
    : { name: name.trim(), sourceKey, text, model: voice.model, voiceId: voice.id });
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
async function request(path: string, signal?: AbortSignal, body?: unknown): Promise<unknown> {
  const abort = new AbortController(); let timedOut = false;
  const stop = () => abort.abort();
  if (signal?.aborted) stop(); else signal?.addEventListener("abort", stop, { once: true });
  const deadline = setTimeout(() => { timedOut = true; stop(); }, body === undefined ? 15_000 : 125_000);
  try {
    const response = await fetch(`${API}${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: abort.signal,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new XumengCharacterVoiceError(response.status,
      object(value) && typeof value.error === "string" && value.error.length <= 500 ? value.error : "角色朗读暂时不可用，请稍后重试。",
      object(value) && typeof value.code === "string" && value.code.length <= 100 ? value.code : undefined);
    return value;
  } catch (error) {
    if (timedOut && !signal?.aborted) throw new XumengCharacterVoiceError(504, "朗读请求超时，台词已保留。请稍后重试，同一台词会复用已完成的结果。");
    throw error;
  } finally { clearTimeout(deadline); signal?.removeEventListener("abort", stop); }
}
export async function fetchXumengCharacterVoice(accountId: string, signal?: AbortSignal): Promise<XumengCharacterVoiceOverview> {
  return parseXumengCharacterVoiceOverview(await request("", signal), accountId);
}
export async function generateXumengCharacterVoice(accountId: string, name: string, sourceKey: string, text: string, signal?: AbortSignal,
  voiceId: XumengSpeechVoiceId = "melotts"): Promise<XumengCharacterVoiceAsset> {
  const expected = await fingerprintXumengCharacterVoice(name, sourceKey, text, voiceId);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const value = await request("/generate", signal, { accountId, name: name.trim(), sourceKey, text, ...(voiceId === "melotts" ? {} : { voiceId }) });
  if (!object(value) || value.accountId !== accountId) throw invalid();
  const asset = parseXumengCharacterVoiceAsset(value.asset);
  if (asset.sourceKey !== sourceKey || asset.name !== name.trim() || asset.sourceHash !== expected || asset.voiceId !== voiceId) throw invalid();
  return asset;
}
