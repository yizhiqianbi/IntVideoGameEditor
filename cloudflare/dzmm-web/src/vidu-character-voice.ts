import { getXumengSpeechVoice } from "../../../src/lib/xumeng-voices";
export type ViduVoiceEnvironment = { VIDU_API_KEY?: string; VIDU_REGION?: string };
const MAX_BYTES = 8 * 1024 * 1024;
export const viduVoiceConfigured = (env: ViduVoiceEnvironment) => Boolean(env.VIDU_API_KEY?.trim());
async function bounded(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok || !response.body || Number(response.headers.get("Content-Length")) > limit) throw Error("voice provider unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > limit) throw Error("voice output too large"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
export async function generateViduCharacterVoice(env: ViduVoiceEnvironment, input: unknown, request: typeof fetch = fetch) {
  const row = input as Record<string, unknown>, voice = getXumengSpeechVoice(row?.voiceId);
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(row).some(key => !["text", "voiceId"].includes(key))
    || typeof row.text !== "string" || !row.text.trim() || Array.from(row.text).length > 800 || row.text.includes("\0")
    || voice?.provider !== "vidu" || !viduVoiceConfigured(env)) throw Error("voice request unavailable");
  const signal = AbortSignal.timeout(85_000), base = env.VIDU_REGION === "global" ? "https://api.vidu.com" : "https://api.vidu.cn";
  try {
    const response = await request(base + "/ent/v2/audio-tts", { method: "POST", redirect: "manual", signal,
      headers: { Authorization: `Token ${env.VIDU_API_KEY!.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: row.text, voice_setting_voice_id: voice.id, voice_setting_speed: 1, voice_setting_pitch: 0 }) });
    const result = JSON.parse(new TextDecoder().decode(await bounded(response, 256 * 1024))) as Record<string, unknown>;
    if (result.state !== "success" || typeof result.task_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(result.task_id)
      || typeof result.credits !== "number" || !Number.isFinite(result.credits) || result.credits < 0 || !Number.isSafeInteger(result.credits)
      || typeof result.file_url !== "string") throw Error("voice provider response invalid");
    const url = new URL(result.file_url);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".")
      || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith("[") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) throw Error("voice output URL invalid");
    // Provider-owned output URLs are never sent to the browser; download without forwarding credentials or following redirects.
    const bytes = await bounded(await request(url, { redirect: "manual", signal }), MAX_BYTES);
    const wav = bytes.length >= 44 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WAVE";
    const mp3 = bytes.length >= 4 && (new TextDecoder().decode(bytes.slice(0, 3)) === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224));
    if (!wav && !mp3) throw Error("voice output invalid");
    return { bytes: bytes.buffer, mimeType: wav ? "audio/wav" : "audio/mpeg", providerCredits: result.credits, taskId: result.task_id };
  } catch { throw Error("角色音色生成失败，请稍后重试。"); }
}
