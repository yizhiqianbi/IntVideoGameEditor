import {
  isRetryableNetworkError,
  readApiJson,
  translateDramaNetworkError,
} from "./drama-api";

const CHUNK = 1024 * 1024;
const MAX_BYTES = 20 * 1024 * 1024;

function extFromMime(mime: string) {
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestSignal(signal?: AbortSignal, ms = 120000) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const any = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  return any ? any([signal, timeout]) : timeout;
}

async function bytesFromSource(source: string) {
  if (source.startsWith("data:image/") && source.includes(";base64,")) {
    const [prefix, data] = source.split(";base64,");
    const raw = atob(data);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return { bytes, ext: extFromMime(prefix) };
  }
  if (source.startsWith("blob:")) {
    try {
      const blob = await (await fetch(source)).blob();
      if (!blob.size) throw new Error("empty");
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        ext: extFromMime(blob.type),
      };
    } catch {
      throw new Error("参考图已失效，请重新导入图片后再生成。");
    }
  }
  throw new Error("只能上传本地或生成的参考图");
}

async function postInputChunk(body: unknown, signal?: AbortSignal) {
  try {
    const response = await fetch("/api/drama/input-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: requestSignal(signal, 120000),
    });
    return await readApiJson(response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(translateDramaNetworkError(error, "input-image"));
  }
}

async function uploadInputImageOnce(
  bytes: Uint8Array,
  ext: string,
  signal?: AbortSignal,
) {
  const id = crypto.randomUUID().replaceAll("-", "");
  const total = Math.ceil(bytes.length / CHUNK);
  let file = "";
  for (let index = 0; index < total; index++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const slice = bytes.subarray(index * CHUNK, (index + 1) * CHUNK);
    let binary = "";
    for (let i = 0; i < slice.length; i += 8192)
      binary += String.fromCharCode(...slice.subarray(i, i + 8192));
    const result = await postInputChunk(
      {
        id,
        index,
        total,
        ext,
        data: btoa(binary),
      },
      signal,
    );
    if (result.file) file = String(result.file);
  }
  if (!file) throw new Error("参考图上传未完成");
  return `comfy-input:${file}`;
}

export async function uploadInputImage(source: string, signal?: AbortSignal) {
  const { bytes, ext } = await bytesFromSource(source);
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw new Error("参考图不能超过 20MB");
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await uploadInputImageOnce(bytes, ext, signal);
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("参考图上传失败");
      if (
        lastError.name === "AbortError" ||
        (!isRetryableNetworkError(error) &&
          !/上传中断|上传超时/.test(lastError.message))
      )
        throw lastError;
      await delay(400 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function hostDramaImage(url: string, signal?: AbortSignal) {
  const value = url.trim();
  if (!value) return "";
  if (value.startsWith("comfy-input:")) return value;
  if (/^https?:\/\//.test(value) || value.startsWith("/api/")) return value;
  return uploadInputImage(value, signal);
}

export async function hostDramaImages(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
) {
  const cache = new Map<string, string>();
  const hosted: string[] = [];
  const pending = urls.filter((url) => url.trim()).length;
  let done = 0;
  for (const url of urls) {
    const value = url.trim();
    if (!value) {
      hosted.push("");
      continue;
    }
    const cached = cache.get(value);
    if (cached !== undefined) {
      hosted.push(cached);
      continue;
    }
    const next = await hostDramaImage(value, signal);
    cache.set(value, next);
    hosted.push(next);
    done += 1;
    onProgress?.(done, pending);
  }
  return hosted;
}

function hostedImageFile(url: string, existing?: string) {
  if (existing) return existing;
  if (url.startsWith("comfy-input:")) return url.slice("comfy-input:".length);
}

export async function hostDirectorImages<
  T extends { images: { id: string; name: string; url: string; file?: string }[] },
>(director: T, signal?: AbortSignal): Promise<T> {
  const images = [];
  for (const image of director.images) {
    const url = await hostDramaImage(image.url, signal);
    if (!url) continue;
    const file = hostedImageFile(url, image.file);
    images.push({
      id: image.id,
      name: image.name,
      url:
        image.url.startsWith("data:") || image.url.startsWith("blob:")
          ? url
          : image.url,
      ...(file ? { file } : {}),
    });
  }
  return { ...director, images };
}
