import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const MAX_BYTES = 8 * 1024 * 1024;

export type ElevenLabsVoiceEnvironment = { ELEVENLABS_API_KEY?: string };

export function elevenLabsVoiceConfigured(env: ElevenLabsVoiceEnvironment): boolean {
  return Boolean(env.ELEVENLABS_API_KEY?.trim());
}

async function readAudio(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw new Error("voice output too large");
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export async function generateElevenLabsCharacterVoice(
  env: ElevenLabsVoiceEnvironment,
  input: { text: string; voiceId: string },
): Promise<{ bytes: ArrayBuffer; mimeType: "audio/mpeg" }> {
  if (!elevenLabsVoiceConfigured(env)) throw new Error("ElevenLabs voice provider unavailable");
  const client = new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY!.trim() });
  const audio = await client.textToSpeech.convert(input.voiceId, {
    text: input.text,
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
    voiceSettings: { stability: 0.5, similarityBoost: 0.75, useSpeakerBoost: true },
  });
  return { bytes: await readAudio(audio), mimeType: "audio/mpeg" };
}
