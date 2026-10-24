import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { readFile, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { NextResponse } from "next/server";
import { comfyFetch } from "@/lib/drama-comfy";

export const maxDuration = 60;

function allowedRemote(url: string) {
  try {
    const host = new URL(url).hostname;
    return /(^|\.)fal\.media$/i.test(host) || /(^|\.)fal\.ai$/i.test(host);
  } catch {
    return false;
  }
}

async function loadVideo(videoUrl: string) {
  if (videoUrl.startsWith("/api/drama/ltx-media")) {
    const id = new URL(videoUrl, "https://pencil.local").searchParams.get("id") || "";
    if (!/^[a-f0-9]{12}$/.test(id)) throw new Error("视频地址无效");
    const response = await comfyFetch(`/pencil/ltx/jobs/${id}/video`);
    if (!response.ok) throw new Error("LTX 视频读取失败");
    return Buffer.from(await response.arrayBuffer());
  }
  if (videoUrl.startsWith("/api/drama/media")) {
    const params = new URL(videoUrl, "https://pencil.local").searchParams;
    const filename = params.get("filename") || "";
    const subfolder = params.get("subfolder") || "";
    if (
      !/^[\w.-]+\.mp4$/i.test(filename) ||
      !/^pencil(?:\/[\w-]+)*$/.test(subfolder)
    )
      throw new Error("视频地址无效");
    const response = await comfyFetch(
      `/view?${new URLSearchParams({ filename, subfolder, type: "output" })}`,
    );
    if (!response.ok) throw new Error("H3 视频读取失败");
    return Buffer.from(await response.arrayBuffer());
  }
  if (allowedRemote(videoUrl)) {
    const response = await fetch(videoUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("远程视频读取失败");
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("不支持从该地址抽帧");
}

function extractJpeg(input: string, output: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-sseof",
      "-0.08",
      "-i",
      input,
      "-frames:v",
      "1",
      "-q:v",
      "4",
      output,
    ]);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("抽帧超时"));
    }, 20000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        error.message.includes("ENOENT")
          ? new Error("服务器未安装 ffmpeg，无法抽帧")
          : error,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("ffmpeg 抽帧失败"));
    });
  });
}

export async function POST(request: Request) {
  const input = join(tmpdir(), `pencil-frame-${randomUUID()}.mp4`);
  const output = join(tmpdir(), `pencil-frame-${randomUUID()}.jpg`);
  try {
    const body = await request.json();
    if (typeof body.videoUrl !== "string" || !body.videoUrl.trim())
      return NextResponse.json({ error: "请提供视频地址" }, { status: 400 });
    const bytes = await loadVideo(body.videoUrl.trim());
    if (bytes.length > 80 * 1024 * 1024)
      return NextResponse.json({ error: "视频过大，无法抽帧" }, { status: 400 });
    await writeFile(input, bytes);
    await extractJpeg(input, output);
    const jpeg = await readFile(output);
    return NextResponse.json({
      mimeType: "image/jpeg",
      b64Json: jpeg.toString("base64"),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "抽帧失败" },
      { status: 502 },
    );
  } finally {
    await Promise.allSettled([unlink(input), unlink(output)]);
  }
}
