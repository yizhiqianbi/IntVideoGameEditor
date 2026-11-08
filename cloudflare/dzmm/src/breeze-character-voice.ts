import { BREEZE_TTS_MODEL, type BreezeSpeechRoute } from "../../../src/lib/xumeng-breeze-voices";

const MAX_BYTES = 8 * 1024 * 1024;

export type BreezeVoiceEnvironment = { BREEZE_API_KEY?: string };

export function breezeVoiceConfigured(env: BreezeVoiceEnvironment): boolean {
  return Boolean(env.BREEZE_API_KEY?.trim());
}

export async function generateBreezeCharacterVoice(
  env: BreezeVoiceEnvironment,
  input: BreezeSpeechRoute & { text: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: ArrayBuffer; mimeType: "audio/mpeg" }> {
  if (!breezeVoiceConfigured(env)) throw new Error("Breeze voice provider unavailable");
  const response = await fetchImpl(`https://api.breeze.blue/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_24000_128`, {
    method: "POST",
    headers: {
      "user-agent": "BreezeBlue-SDK/1.0",
      "xi-api-key": env.BREEZE_API_KEY!.trim(),
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: input.text,
      model_id: BREEZE_TTS_MODEL,
      language_code: "zh",
      ...(input.instructions ? { instructions: input.instructions, voice_settings: { guidance_scale: 4 } } : {}),
    }),
  });
  if (!response.ok) throw new Error("Voice provider failed");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 64 || bytes.byteLength > MAX_BYTES) throw new Error("Invalid voice provider result");
  return { bytes, mimeType: "audio/mpeg" };
}
