#!/usr/bin/env node
// H3 换脸视频 skill 的执行脚本。
// 用法：
//   node h3-face-swap-video.mjs --face face.jpg --video clip.mp4 --out output/run --route both
// 做的事：上传素材 → 跑 H3 全能参考 / huanlian 像素换脸 → 轮询 → 下载 → 转存 → 抽帧 → 写 result.json
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const LOCAL_ENV = path.join(REPO_ROOT, "xumeng-gen", ".env.local");
const MEDIA_FALLBACK = "https://channel-media.xumengchat.top";
const H3_DEFAULT = {
  duration: 5,
  resolution: "720P",
  ratio: "adaptive",
  removeAudio: false,
};
const HUANLIAN_PROMPT =
  "把参考图里的人脸换到视频里的人物脸上。保留视频原有的动作、姿势、服装、场景、镜头和背景，只改五官、脸型和发型，并让新脸贴合原来的角度和光线。人物是虚构的成年人，二十一岁以上。";

function fail(message) {
  console.error(`\n[失败] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { route: "both", duration: 0, resolution: "720P" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--face") { args.face = value; i += 1; }
    else if (key === "--video") { args.video = value; i += 1; }
    else if (key === "--out") { args.out = value; i += 1; }
    else if (key === "--route") { args.route = value; i += 1; }
    else if (key === "--duration") { args.duration = Number(value); i += 1; }
    else if (key === "--resolution") { args.resolution = value; i += 1; }
    else if (key === "--h3-prompt") { args.h3Prompt = value; i += 1; }
    else if (key === "--huanlian-prompt") { args.huanlianPrompt = value; i += 1; }
    else if (key === "--skip-frames") { args.skipFrames = true; }
    else if (key === "--help" || key === "-h") {
      console.log("用法: node h3-face-swap-video.mjs --face <人脸图> --video <参考视频> --out <输出目录> [--route h3|huanlian|both] [--duration 4-15] [--resolution 720P]");
      process.exit(0);
    }
  }
  if (!args.face || !args.video || !args.out) fail("--face、--video、--out 都是必填");
  if (!["h3", "huanlian", "both"].includes(args.route)) fail("--route 只能是 h3、huanlian 或 both");
  return args;
}

function loadEnv() {
  const env = { ...process.env };
  if (fs.existsSync(LOCAL_ENV)) {
    for (const line of fs.readFileSync(LOCAL_ENV, "utf8").split(/\r?\n/)) {
      if (!line.includes("=") || line.trim().startsWith("#")) continue;
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      if (!env[key]) env[key] = line.slice(index + 1).trim();
    }
  }
  const media = (env.CREATE_MEDIA_ORIGIN || MEDIA_FALLBACK).replace(/\/+$/, "");
  for (const key of ["H3_BASE_URL", "H3_API_KEY", "AIAPI_BASE_URL", "AIAPI_APIKEY", "AIAPI_SECRETKEY"]) {
    if (!env[key]) fail(`缺少环境变量 ${key}（检查 xumeng-gen/.env.local 或 process.env）`);
  }
  return { env, media };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(url, options, label) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`${label} 网络失败：${error.message}`);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}：${JSON.stringify(payload).slice(0, 300)}`);
  return payload;
}

async function hostImage(env, media, bytes, type) {
  const payload = await request(`${media}/api/studio/channel-reference`, {
    method: "POST",
    headers: { "Content-Type": type, "x-aiapi-relay": env.AIAPI_SECRETKEY },
    body: bytes,
  }, "上传参考图");
  if (typeof payload.url !== "string") throw new Error("上传参考图没有返回地址");
  return payload.url;
}

async function hostVideo(env, media, bytes) {
  const { uploadTicket } = await import(path.join(REPO_ROOT, "xumeng-gen/lib/channel-upload.mjs"));
  const ticket = uploadTicket(env.AIAPI_SECRETKEY, media, bytes.length);
  const payload = await request(ticket.url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: bytes,
  }, "上传参考视频");
  if (typeof payload.url !== "string") throw new Error("上传参考视频没有返回地址");
  return payload.url;
}

async function download(url, maxBytes, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label}下载失败 HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`${label}太大（${bytes.length} bytes）`);
  if (bytes.length < 1024 || !(bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70)) {
    throw new Error(`${label}不是 MP4 文件`);
  }
  return bytes;
}

function imageType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function probeDuration(videoPath) {
  try {
    const output = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath], { encoding: "utf8" });
    return Math.round(Number(output.trim()) * 10) / 10;
  } catch {
    return 0;
  }
}

function clampDuration(seconds) {
  const value = Math.round(Number(seconds) || H3_DEFAULT.duration);
  return Math.min(15, Math.max(4, value));
}

function extractFrames(videoPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const outputs = [];
  for (const second of [0.5, 1.5, 3, 4.5]) {
    const target = path.join(outDir, `frame-${String(second).replace(".", "_")}s.jpg`);
    try {
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(second), "-i", videoPath, "-frames:v", "1", target]);
      if (fs.existsSync(target)) outputs.push(target);
    } catch {
      // 视频比抽帧时间点短时跳过。
    }
  }
  return outputs;
}

async function storeResult(env, media, bytes, outputPath) {
  fs.writeFileSync(outputPath, bytes);
  const { uploadTicket } = await import(path.join(REPO_ROOT, "xumeng-gen/lib/channel-upload.mjs"));
  const ticket = uploadTicket(env.AIAPI_SECRETKEY, media, bytes.length);
  const payload = await request(ticket.url, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: bytes }, "转存成片");
  if (typeof payload.url !== "string") throw new Error("成片转存没有返回地址");
  return payload.url;
}

async function runH3({ env, media, faceUrl, videoUrl, duration, resolution, prompt }) {
  const startedAt = Date.now();
  const base = env.H3_BASE_URL.replace(/\/+$/, "");
  const submit = await request(`${base}/minimax/v2/video_generation/fast`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.H3_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: faceUrl }, role: "reference_image" },
        { type: "video_url", video_url: { url: videoUrl }, role: "reference_video" },
      ],
      duration,
      resolution,
      ratio: "adaptive",
      remove_audio: false,
    }),
  }, "H3 提交");
  const taskId = submit.task_id || submit.taskId;
  if (!taskId) throw new Error("H3 没有返回 task_id");
  for (let i = 0; i < 40; i += 1) {
    await sleep(8000);
    const payload = await request(`${base}/minimax/query/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${env.H3_API_KEY}` },
    }, "H3 查询");
    const task = payload.task || payload;
    if (task.status === "succeeded") {
      const url = task.content && task.content.url;
      if (!url) throw new Error("H3 成功但没有成片地址");
      const bytes = await download(url, 80 * 1024 * 1024, "H3 成片");
      return { taskId, bytes, elapsed: Math.round((Date.now() - startedAt) / 1000) };
    }
    if (task.status === "failed") throw new Error(`H3 失败：${task.fail_reason || task.error || "未知原因"}`);
  }
  throw new Error("H3 超时（task 一直 running，保留 task id 继续查）");
}

async function runHuanlian({ env, faceUrl, videoUrl, prompt }) {
  const startedAt = Date.now();
  const base = env.AIAPI_BASE_URL.replace(/\/+$/, "");
  const headers = { apikey: env.AIAPI_APIKEY, SECRETKEY: env.AIAPI_SECRETKEY };
  const taskId = `skill-huanlian-${crypto.randomUUID()}`;
  const form = new URLSearchParams();
  form.set("task_id", taskId);
  form.set("video_url", videoUrl);
  form.set("img_url", faceUrl);
  form.set("positive_prompt", prompt);
  form.set("video_format", "video/h264-mp4");
  const submit = await request(`${base}/api/public/huanlian`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  }, "huanlian 提交");
  const id = submit.task_id || submit.taskId || taskId;
  for (let i = 0; i < 70; i += 1) {
    await sleep(4000);
    const payload = await request(`${base}/api/public/task?task_id=${encodeURIComponent(id)}`, { headers }, "huanlian 查询");
    const task = payload.data && typeof payload.data === "object" ? { ...payload, ...payload.data } : payload;
    const status = Number(task.status);
    if (status === 3) throw new Error(`huanlian 失败：${task.error || task.fail_reason || "未知原因"}`);
    if (status === 2) {
      const list = Array.isArray(task.out_data) ? task.out_data : [];
      const url = list.find(item => typeof item === "string" && item.startsWith("https://"));
      if (!url) throw new Error("huanlian 成功但没有成片地址");
      const bytes = await download(url, 80 * 1024 * 1024, "huanlian 成片");
      return { taskId: id, bytes, elapsed: Math.round((Date.now() - startedAt) / 1000) };
    }
  }
  throw new Error("huanlian 超时（保留 task id 继续查）");
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const { env, media } = loadEnv();
  for (const file of [args.face, args.video]) {
    if (!fs.existsSync(file)) fail(`文件不存在：${file}`);
  }
  const videoBytes = fs.readFileSync(args.video);
  const faceBytes = fs.readFileSync(args.face);
  if (videoBytes.length > 64 * 1024 * 1024) fail("参考视频超过 64MB");
  const sourceSeconds = probeDuration(args.video);
  const duration = clampDuration(args.duration || sourceSeconds || H3_DEFAULT.duration);
  const h3Prompt = args.h3Prompt || (await import(path.join(REPO_ROOT, "xumeng-gen/lib/face-video.mjs"))).FACE_VIDEO_PROMPT;
  const huanlianPrompt = args.huanlianPrompt || HUANLIAN_PROMPT;

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const framesDir = path.join(outDir, "frames");
  const result = { createdAt: new Date().toISOString(), inputs: { face: path.resolve(args.face), video: path.resolve(args.video), sourceSeconds }, duration, routes: {} };

  console.log(`[1/3] 上传素材（参考视频 ${(videoBytes.length / 1024 / 1024).toFixed(1)}MB，源视频 ${sourceSeconds || "?"} 秒）`);
  const faceUrl = await hostImage(env, media, faceBytes, imageType(args.face));
  const videoUrl = await hostVideo(env, media, videoBytes);
  result.inputs.faceUrl = faceUrl;
  result.inputs.videoUrl = videoUrl;
  console.log(`      人脸 ${faceUrl}`);
  console.log(`      视频 ${videoUrl}`);

  if (args.route === "h3" || args.route === "both") {
    console.log("[2/3] H3 全能参考…");
    const outcome = await runH3({ env, media, faceUrl, videoUrl, duration, resolution: args.resolution, prompt: h3Prompt });
    const local = path.join(outDir, "result-h3.mp4");
    const storedUrl = await storeResult(env, media, outcome.bytes, local);
    const frames = args.skipFrames ? [] : extractFrames(local, path.join(framesDir, "h3"));
    result.routes.h3 = { taskId: outcome.taskId, file: local, bytes: outcome.bytes.length, elapsedSeconds: outcome.elapsed, url: storedUrl, frames };
    console.log(`      H3 完成：${local}（${outcome.elapsed}s，已转存）`);
  }

  if (args.route === "huanlian" || args.route === "both") {
    console.log("[3/3] huanlian 像素换脸…");
    const outcome = await runHuanlian({ env, faceUrl, videoUrl, prompt: huanlianPrompt });
    const local = path.join(outDir, "result-huanlian.mp4");
    const storedUrl = await storeResult(env, media, outcome.bytes, local);
    const frames = args.skipFrames ? [] : extractFrames(local, path.join(framesDir, "huanlian"));
    result.routes.huanlian = { taskId: outcome.taskId, file: local, bytes: outcome.bytes.length, elapsedSeconds: outcome.elapsed, url: storedUrl, frames };
    console.log(`      huanlian 完成：${local}（${outcome.elapsed}s，已转存）`);
  }

  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(`\n结果写入 ${path.join(outDir, "result.json")}`);
  if (result.routes.h3 && result.routes.huanlian) {
    console.log("提示：对比 frames/h3 与 frames/huanlian 的人脸；H3 身份漂移是模型限制，身份要求高时交付 huanlian 结果。");
  }
})().catch(error => fail(error.message));
