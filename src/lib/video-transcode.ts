"use client";
/**
 * Client-side video transcoding via ffmpeg.wasm.
 *
 * Converts any browser-readable video to:
 *   - MP4 (H.264 + AAC-silent)
 *   - 24 fps
 *   - Longest side ≤ 512 px  (keeps aspect ratio)
 *   - Duration ≤ MAX_DURATION_S  (hard trim at encode time)
 *
 * Called lazily — the ~30 MB WASM bundle is only fetched when the user
 * actually picks a file.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

export const MAX_DURATION_S = 15;
export const MAX_INPUT_BYTES = 500 * 1024 * 1024; // 500 MB input cap

const CDN = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

let _ffmpeg: FFmpeg | null = null;

async function getFFmpeg(
  onProgress?: (message: string) => void,
): Promise<FFmpeg> {
  if (_ffmpeg?.loaded) return _ffmpeg;
  _ffmpeg = new FFmpeg();
  if (onProgress) {
    _ffmpeg.on("log", ({ message }) => {
      // surface relevant ffmpeg log lines to the caller
      if (/time=|fps=|bitrate=|speed=/.test(message))
        onProgress(message.trim());
    });
  }
  onProgress?.("加载转码引擎…");
  await _ffmpeg.load({
    coreURL: await toBlobURL(`${CDN}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${CDN}/ffmpeg-core.wasm`, "application/wasm"),
  });
  return _ffmpeg;
}

export interface TranscodeResult {
  file: File;
  /** Duration of the output clip in seconds */
  duration: number;
  /** True when transcoding was actually performed */
  transcoded: boolean;
}

/**
 * Returns true when the file needs transcoding before upload.
 * We always transcode if:
 *   - It is not an MP4 container
 *   - OR it is larger than the direct-upload threshold (30 MB), since a
 *     30 MB+ MP4 at full resolution is likely >512 px and/or >24 fps
 */
export function needsTranscode(file: File): boolean {
  const isMP4 = /\.mp4$/i.test(file.name) || file.type === "video/mp4";
  if (!isMP4) return true;
  if (file.size > 30 * 1024 * 1024) return true;
  return false;
}

/**
 * Probe the duration of a local video file using a <video> element.
 * Resolves with the duration in seconds, or Infinity if unknown.
 */
export function probeVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(isFinite(video.duration) ? video.duration : Infinity);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(Infinity);
    };
    video.src = url;
  });
}

/**
 * Transcode `file` into a normalised MP4 suitable for H3 RI2V upload.
 *
 * @param file     Raw video file from <input type="file">
 * @param onProgress  Optional callback for status strings shown in UI
 * @param options.maxDuration  Hard trim in seconds (inspector 15, director 180)
 */
export async function transcodeVideo(
  file: File,
  onProgress?: (message: string) => void,
  options?: { maxDuration?: number },
): Promise<TranscodeResult> {
  if (file.size > MAX_INPUT_BYTES)
    throw new Error(
      `视频文件过大（${(file.size / 1024 / 1024).toFixed(0)} MB），上限 500 MB`,
    );

  const maxDuration = Math.max(
    2,
    Math.min(180, options?.maxDuration ?? MAX_DURATION_S),
  );
  const ff = await getFFmpeg(onProgress);

  const inputName = "input" + (file.name.match(/\.\w+$/)?.[0] ?? ".mp4");
  const outputName = "output.mp4";

  onProgress?.("读取文件…");
  await ff.writeFile(inputName, await fetchFile(file));

  onProgress?.("转码中…");

  // Scale: keep aspect ratio, longest side ≤ 512, divisible by 2
  const scaleFilter =
    "scale='if(gt(iw\\,ih)\\,min(512\\,iw)\\,-2)':'if(gt(iw\\,ih)\\,-2\\,min(512\\,ih))'";

  await ff.exec([
    "-i", inputName,
    "-vf", `${scaleFilter},fps=24`,
    "-c:v", "libx264",
    "-crf", "23",
    "-preset", "ultrafast",
    "-t", String(maxDuration),
    "-an",          // drop audio — H3 RI2V uses reference for visuals only
    "-movflags", "+faststart",
    outputName,
  ]);

  onProgress?.("读取输出…");
  const data = await ff.readFile(outputName);
  // FileData can be Uint8Array (possibly backed by SharedArrayBuffer) or a string path.
  // Copy to a plain ArrayBuffer so Blob constructor is happy.
  let raw: ArrayBuffer;
  if (data instanceof Uint8Array) {
    raw = data.buffer instanceof ArrayBuffer
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : new Uint8Array(data).buffer;
  } else {
    throw new Error("ffmpeg readFile returned unexpected type");
  }
  const blob = new Blob([raw], { type: "video/mp4" });

  // Clean up WASM FS
  try {
    await ff.deleteFile(inputName);
    await ff.deleteFile(outputName);
  } catch {
    // ignore cleanup errors
  }

  // Probe output duration
  const outFile = new File([blob], file.name.replace(/\.\w+$/, "") + "_tc.mp4", {
    type: "video/mp4",
  });
  const duration = await probeVideoDuration(outFile);

  onProgress?.("完成");
  return { file: outFile, duration: Math.min(duration, maxDuration), transcoded: true };
}

/** Keep a call recording's picture and sound, and wrap it as an MP4 file. */
export async function convertRecordingToMp4(blob: Blob): Promise<Blob> {
  if (blob.type.includes("mp4")) return blob;
  if (blob.size > MAX_INPUT_BYTES) throw new Error("录像过大，无法导出为 MP4。");
  const ff = await getFFmpeg();
  const inputName = "call-input.webm";
  const outputName = "call-output.mp4";
  await ff.writeFile(inputName, await fetchFile(new File([blob], inputName, { type: blob.type || "video/webm" })));
  const video = ["-i", inputName, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  const withAudio = await ff.exec([...video, "-c:a", "aac", "-b:a", "128k", outputName]);
  if (withAudio !== 0) {
    try { await ff.deleteFile(outputName); } catch { /* The first pass may not have written a file. */ }
    const silent = await ff.exec([...video, "-an", outputName]);
    if (silent !== 0) throw new Error("录像没能导出为 MP4。");
  }
  const data = await ff.readFile(outputName);
  try { await ff.deleteFile(inputName); await ff.deleteFile(outputName); } catch { /* The exported file is already in memory. */ }
  if (!(data instanceof Uint8Array)) throw new Error("录像没能导出为 MP4。");
  const raw = data.buffer instanceof ArrayBuffer
    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    : new Uint8Array(data).buffer;
  return new Blob([raw], { type: "video/mp4" });
}
