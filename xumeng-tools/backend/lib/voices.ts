import { channelCredentials } from "./channel-env";
import { orderVoices, PRESET_VOICES } from "./voice-options";

let cache: { at: number; voices: string[] } | null = null;

export async function listVoices(): Promise<string[]> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.voices;
  const env = channelCredentials();
  const base = env.baseUrl?.trim().replace(/\/+$/, "") ?? "";
  const apiKey = env.apiKey?.trim() ?? "";
  const secretKey = env.secretKey?.trim() ?? "";
  if (!base || !apiKey || !secretKey) return [...PRESET_VOICES];
  try {
    const response = await fetch(`${base}/api/public/generate/audio/list`, {
      headers: { apikey: apiKey, SECRETKEY: secretKey },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null);
    const names = Array.isArray(payload) ? payload.filter((item): item is string => typeof item === "string") : [];
    const voices = orderVoices(names);
    if (response.ok && names.length) cache = { at: Date.now(), voices };
    return voices;
  } catch {
    return cache?.voices ?? [...PRESET_VOICES];
  }
}
