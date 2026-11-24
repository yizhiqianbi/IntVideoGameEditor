import crypto from "node:crypto";

const HOST = "vod.intl.tencentcloudapi.com";
const SERVICE = "vod";
const VERSION = "2018-07-17";
const REGION = "ap-singapore";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

export function wandCredentials(env = process.env) {
  const secretId = String(env.TENCENT_WAND_SECRET_ID || "").trim();
  const secretKey = String(env.TENCENT_WAND_SECRET_KEY || "").trim();
  const subAppId = Number(env.TENCENT_WAND_SUB_APP_ID);
  if (!secretId || !secretKey || !Number.isInteger(subAppId)) return null;
  return { secretId, secretKey, subAppId };
}

export function videoTaskBody({ subAppId, prompt, assetId, assets, seconds, mode = "first" }) {
  const duration = Math.min(30, Math.max(4, Math.round(Number(seconds) || 8)));
  const ids = Array.isArray(assets) && assets.length ? assets : [assetId];
  const reference = mode === "reference";
  const ext = {
    WandVegaParameters: JSON.stringify({
      EnhancePromptMode: "disable",
      ReturnVegaUsage: true,
      ModerationMode: "Moderation_L1",
    }),
  };
  if (reference) ext.AdditionalParameters = JSON.stringify({ omni_reference_task_type: "reference" });
  return {
    SubAppId: subAppId,
    ModelName: "wand-vega-video",
    ModelVersion: "1.5-pro",
    Prompt: String(prompt || "").slice(0, 2000),
    FileInfos: ids.filter(Boolean).map(id => ({
      Type: "Url",
      Category: "Image",
      Url: String(id).startsWith("asset://") ? String(id) : `asset://${id}`,
      Usage: reference ? "Reference" : "FirstFrame",
    })),
    OutputConfig: {
      StorageMode: "Temporary",
      ExpireTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      Duration: duration,
      Resolution: "720P",
      AspectRatio: reference ? "16:9" : "adaptive",
      AudioGeneration: "Disabled",
    },
    ExtInfo: JSON.stringify(ext),
  };
}

export async function vodCall(action, payload, env = process.env, fetchImpl = fetch) {
  const credentials = wandCredentials(env);
  if (!credentials) throw new Error("视频服务还没配上。");
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = "application/json";
  const canonicalHeaders = `content-type:${contentType}\nhost:${HOST}\n`;
  const signedHeaders = "content-type;host";
  const canonical = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`;
  const scope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonical)}`;
  const signingKey = hmac(hmac(hmac(`TC3${credentials.secretKey}`, date), SERVICE), "tc3_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const response = await fetchImpl(`https://${HOST}`, {
    method: "POST",
    headers: {
      Authorization: `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": contentType,
      Host: HOST,
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": VERSION,
      "X-TC-Region": REGION,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await response.json().catch(() => null);
  const error = json?.Response?.Error;
  if (!response.ok || error) throw new Error(String(error?.Message || "视频没有完成。").replace(/\s+/g, " ").slice(0, 180));
  return json.Response;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(taskId, select, env, fetchImpl) {
  const credentials = wandCredentials(env);
  let emptyFinish = 0;
  for (;;) {
    try {
      const detail = await vodCall("DescribeTaskDetail", { SubAppId: credentials.subAppId, TaskId: taskId }, env, fetchImpl);
      const task = select(detail);
      const status = String(task?.Status || "").toUpperCase();
      if (status === "FAIL" || status === "FAILED" || status === "ABORTED") throw new Error(materialProblem(task));
      if (status === "FINISH" || status === "SUCCESS") {
        if (Number(task?.ErrCode || 0) !== 0) throw new Error(materialProblem(task));
        if (task?.Output?.AssetId) return task;
        emptyFinish += 1;
        if (emptyFinish >= 3) throw new Error(materialProblem(task));
      }
    } catch (error) {
      const name = error && typeof error === "object" ? String(error.name || "") : "";
      if (name !== "TimeoutError" && name !== "AbortError") throw error;
    }
    await delay(3000);
  }
}

export function materialProblem(task) {
  const message = String(task?.Message || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  const ext = String(task?.ErrCodeExt || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  const code = Number(task?.ErrCode || 0);
  const detail = message || ext || (code ? `错误码 ${code}` : "");
  return detail ? `参考图没有登记成功。${detail}`.slice(0, 180) : "参考图没有登记成功。";
}

function videoUrl(task) {
  const files = task?.Output?.FileInfos || task?.Output?.FileInfoSet || [];
  const chosen = files.find(file => {
    const usage = String(file.FileUsage || file.UsageType || file.Usage || "");
    const url = String(file.FileUrl || file.Url || "");
    return url.startsWith("http") && !/last_frame/i.test(usage);
  });
  return chosen ? String(chosen.FileUrl || chosen.Url) : "";
}

/**
 * @param {{ prompt?: string, imageUrl?: string, imageUrls?: string[], seconds?: number, mode?: string }} [input]
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} [options]
 */
export async function startWandVideo(input = {}, options = {}) {
  const { prompt, imageUrl, imageUrls, seconds, mode } = input;
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const credentials = wandCredentials(env);
  if (!credentials) throw new Error("视频服务还没配上。");
  const urls = (Array.isArray(imageUrls) && imageUrls.length ? imageUrls : [imageUrl]).filter(Boolean);
  const assets = [];
  for (const url of urls) {
    const created = await vodCall("CreateAigcMaterial", {
      SubAppId: credentials.subAppId,
      FileInfo: { Type: "Url", Url: url },
      AssetType: "Image",
      GroupId: "xumeng-video",
      GroupName: "xumeng-video",
      GroupDescription: "studio frame",
      AssetName: `frame-${crypto.randomUUID()}`,
      IsRealPerson: "False",
    }, env, fetchImpl);
    const material = await waitFor(created.TaskId, detail => detail?.CreateAigcMaterialTask, env, fetchImpl);
    const assetId = material?.Output?.AssetId;
    if (!assetId) throw new Error("参考图没有登记成功。");
    assets.push(assetId);
  }
  const video = await vodCall("CreateAigcVideoTask", videoTaskBody({
    subAppId: credentials.subAppId,
    prompt,
    assets,
    seconds,
    mode,
  }), env, fetchImpl);
  if (!video?.TaskId) throw new Error("视频没有提交成功。");
  return video.TaskId;
}

export async function pollWandVideo(taskId, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const credentials = wandCredentials(env);
  if (!credentials) throw new Error("视频服务还没配上。");
  const detail = await vodCall("DescribeTaskDetail", { SubAppId: credentials.subAppId, TaskId: taskId }, env, fetchImpl);
  const task = detail?.AigcVideoTask;
  const status = String(task?.Status || "").toUpperCase();
  if (status === "FAIL" || status === "FAILED") throw new Error(String(task?.Message || task?.ErrCodeExt || "视频没有完成。").slice(0, 180));
  if (status !== "FINISH" && status !== "SUCCESS") return null;
  const finished = task;
  const url = videoUrl(finished);
  if (!url) throw new Error("视频结果里没有文件。");
  const parsed = new URL(url);
  const secure = parsed.protocol === "https:" || parsed.protocol === "http:";
  if (!secure || !/(^|\.)((vod-qcloud|myqcloud)\.com)$/.test(parsed.hostname)) {
    throw new Error("视频结果地址无效。");
  }
  const downloadUrl = parsed.protocol === "http:" ? `https://${parsed.host}${parsed.pathname}${parsed.search}` : url;
  const downloaded = await fetchImpl(downloadUrl, { signal: AbortSignal.timeout(60_000) });
  if (!downloaded.ok) throw new Error("视频没有下载下来。");
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  if (bytes.length < 32) throw new Error("视频没有下载下来。");
  return { bytes, contentType: "video/mp4" };
}
