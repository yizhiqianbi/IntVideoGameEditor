/** Composer dictation: 16 kHz mono PCM WAV in, plain text out. No chat send. */
export const SPEECH_INPUT_PATH = "/api/backend/v1/speech-input";
export const SPEECH_INPUT_SAMPLE_RATE = 16_000;
export const SPEECH_INPUT_MAX_MS = 20_000;
export const SPEECH_INPUT_MAX_BYTES = 700_000;

export function speechTranscript(payload: unknown): string {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.result && typeof record.result === "object" ? record.result as Record<string, unknown> : null;
  const text = typeof record.text === "string" ? record.text : typeof nested?.text === "string" ? nested.text : "";
  return text.replace(/\s+/g, " ").trim().slice(0, 4000);
}

export function downsampleMono(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  if (fromRate < toRate || toRate < 1) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

export function pcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  bytes.set([82, 73, 70, 70], 0);
  view.setUint32(4, 36 + samples.length * 2, true);
  bytes.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set([100, 97, 116, 97], 36);
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

export function wavLooksValid(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 46 || bytes.byteLength > SPEECH_INPUT_MAX_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, text: string) => text.split("").every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (!tag(0, "RIFF") || !tag(8, "WAVE") || !tag(12, "fmt ") || !tag(36, "data")) return false;
  if (view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1) return false;
  if (view.getUint32(24, true) !== SPEECH_INPUT_SAMPLE_RATE || view.getUint16(34, true) !== 16) return false;
  const data = view.getUint32(40, true);
  return data === bytes.byteLength - 44 && data % 2 === 0;
}

export function samplesToSpeechWav(chunks: Float32Array[], sampleRate: number): Uint8Array | null {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (total < sampleRate * 0.35) return null;
  const mixed = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    mixed.set(chunk, offset);
    offset += chunk.length;
  }
  const speech = downsampleMono(mixed, sampleRate, SPEECH_INPUT_SAMPLE_RATE);
  const maxSamples = Math.floor((SPEECH_INPUT_MAX_BYTES - 44) / 2);
  const clipped = speech.length > maxSamples ? speech.subarray(0, maxSamples) : speech;
  const wav = pcm16Wav(clipped, SPEECH_INPUT_SAMPLE_RATE);
  return wavLooksValid(wav) ? wav : null;
}
