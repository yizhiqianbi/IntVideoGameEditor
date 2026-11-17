import { rateLimit } from "./auth";
import { ApiError, json } from "./http";
import { SPEECH_INPUT_MAX_BYTES, speechTranscript, wavLooksValid } from "../../../src/lib/dzmm-speech-input";
import type { Env, UserRecord } from "./types";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

export async function handleSpeechInput(request: Request, env: Env, user: UserRecord): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/v1/speech-input") return null;
  if (request.method !== "POST") throw new ApiError(405, "此接口仅支持 POST。");
  if (!env.AI) throw new ApiError(503, "语音输入暂未启用。");
  const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "audio/wav") throw new ApiError(400, "请上传语音文件。");
  if (Number(request.headers.get("Content-Length") || 0) > SPEECH_INPUT_MAX_BYTES) throw new ApiError(413, "语音太长，请说短一点。");
  await rateLimit(request, env, "speech-input", 30, user.id);
  const bytes = await readAudio(request);
  if (!wavLooksValid(bytes)) throw new ApiError(400, "语音文件无效。");
  let result: unknown;
  try {
    result = await Promise.race([
      env.AI.run("@cf/openai/whisper-large-v3-turbo", { audio: bytesToBase64(bytes), task: "transcribe" }),
      new Promise((_, reject) => setTimeout(() => reject(new ApiError(504, "语音识别超时，请再说短一点。")), 25_000)),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "语音识别失败，请稍后再试。");
  }
  return json({ text: speechTranscript(result) });
}

async function readAudio(request: Request): Promise<Uint8Array> {
  if (!request.body) throw new ApiError(400, "请上传语音文件。");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > SPEECH_INPUT_MAX_BYTES) {
      await reader.cancel();
      throw new ApiError(413, "语音太长，请说短一点。");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
