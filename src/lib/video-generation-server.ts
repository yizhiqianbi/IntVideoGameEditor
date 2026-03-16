import { createHmac } from "node:crypto";
import {
  DEFAULT_PROVIDER_PRIORITY,
  getProviderDefaultModel,
  isCredentialConfigured,
  type GenerationProviderSelection,
  type ProviderCredentialState,
  type UnifiedVideoCreateResponse,
  type UnifiedVideoGenerationRequest,
  type UnifiedVideoStatusResponse,
  type VideoProviderId,
} from "./video-generation";

type GenerateVideoBody = {
  providerId: GenerationProviderSelection;
  providerPriority?: VideoProviderId[];
  credentials: ProviderCredentialState;
  request: UnifiedVideoGenerationRequest;
};

type QueryVideoBody = {
  providerId: VideoProviderId;
  credentials: ProviderCredentialState;
  taskId: string;
};

type UnknownRecord = Record<string, unknown>;

const MINIMAX_API_BASE = "https://api.minimaxi.com/v1";
const VIDU_API_BASE = "https://api.vidu.com/ent/v2";
const KLING_API_BASE = "https://api.klingai.com";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function normalizeStatus(value: string | undefined) {
  const normalized = value?.toLowerCase();

  if (!normalized) {
    return "queued" as const;
  }

  if (
    normalized.includes("success") ||
    normalized.includes("succeed") ||
    normalized.includes("completed") ||
    normalized.includes("finish")
  ) {
    return "succeeded" as const;
  }

  if (
    normalized.includes("fail") ||
    normalized.includes("error") ||
    normalized.includes("cancel")
  ) {
    return "failed" as const;
  }

  if (
    normalized.includes("process") ||
    normalized.includes("running") ||
    normalized.includes("render") ||
    normalized.includes("queue") ||
    normalized.includes("pending") ||
    normalized.includes("created") ||
    normalized.includes("submit")
  ) {
    return "processing" as const;
  }

  return "queued" as const;
}

async function readJson(response: Response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`供应商返回了非 JSON 内容：${text.slice(0, 160)}`);
  }
}

async function requestJson(
  input: string,
  init: RequestInit,
  providerLabel: string,
) {
  const response = await fetch(input, init);
  const data = await readJson(response);

  if (!response.ok) {
    const message = isRecord(data)
      ? String(
          data.message ??
            data.msg ??
            data.error ??
            data.code ??
            data.status_msg ??
            data.statusMsg ??
            `${providerLabel} 请求失败`,
        )
      : `${providerLabel} 请求失败`;
    throw new Error(message);
  }

  return data;
}

function resolveProviderForCreate(body: GenerateVideoBody) {
  if (body.providerId !== "auto") {
    if (!isCredentialConfigured(body.providerId, body.credentials)) {
      throw new Error(`请先填写 ${body.providerId} 的 API 凭证。`);
    }

    return [body.providerId];
  }

  const priority = body.providerPriority ?? DEFAULT_PROVIDER_PRIORITY;
  const configuredProviders = priority.filter((providerId) =>
    isCredentialConfigured(providerId, body.credentials),
  );

  if (configuredProviders.length === 0) {
    throw new Error("当前没有可用的 provider。请先填写至少一组 API 凭证。");
  }

  return configuredProviders;
}

function pickString(record: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function collectNestedCandidateRecords(root: UnknownRecord) {
  const candidates: UnknownRecord[] = [];
  const seen = new Set<UnknownRecord>();
  const queue: unknown[] = [root];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!isRecord(current) || seen.has(current)) {
      continue;
    }

    seen.add(current);
    candidates.push(current);

    for (const key of [
      "content",
      "contents",
      "output",
      "outputs",
      "result",
      "results",
      "data",
      "video",
      "videos",
      "media",
      "artifact",
      "artifacts",
      "task_result",
      "taskResult",
      "creation",
      "creations",
      "file",
      "files",
      "image_url",
      "imageUrl",
    ]) {
      const nested = current[key];

      if (Array.isArray(nested)) {
        for (const item of nested) {
          queue.push(item);
        }
        continue;
      }

      queue.push(nested);
    }
  }

  return candidates;
}

function pickStringFromCandidates(candidates: UnknownRecord[], keys: string[]) {
  for (const candidate of candidates) {
    const value = pickString(candidate, keys);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function pickUrlFromNamedObject(
  candidates: UnknownRecord[],
  objectKeys: string[],
) {
  for (const candidate of candidates) {
    for (const objectKey of objectKeys) {
      const value = candidate[objectKey];

      if (!isRecord(value)) {
        continue;
      }

      const url = pickString(value, [
        "video_url",
        "videoUrl",
        "play_url",
        "playUrl",
        "media_url",
        "mediaUrl",
        "download_url",
        "downloadUrl",
        "url",
        "file_url",
        "fileUrl",
      ]);

      if (url) {
        return url;
      }
    }
  }

  return undefined;
}

function pickUrlFromNamedArray(
  candidates: UnknownRecord[],
  arrayKeys: string[],
) {
  for (const candidate of candidates) {
    for (const arrayKey of arrayKeys) {
      const value = candidate[arrayKey];

      if (!Array.isArray(value)) {
        continue;
      }

      for (const item of value) {
        if (typeof item === "string" && item.trim().length > 0) {
          return item;
        }

        if (!isRecord(item)) {
          continue;
        }

        const url = pickString(item, [
          "video_url",
          "videoUrl",
          "play_url",
          "playUrl",
          "media_url",
          "mediaUrl",
          "download_url",
          "downloadUrl",
          "url",
          "file_url",
          "fileUrl",
        ]);

        if (url) {
          return url;
        }
      }
    }
  }

  return undefined;
}

function extractMediaUrls(root: UnknownRecord) {
  const candidates = collectNestedCandidateRecords(root);
  const videoUrl =
    pickStringFromCandidates(candidates, [
      "video_url",
      "videoUrl",
      "play_url",
      "playUrl",
      "media_url",
      "mediaUrl",
      "download_url",
      "downloadUrl",
      "url",
      "file_url",
      "fileUrl",
      "video",
    ]) ??
    pickUrlFromNamedObject(candidates, [
      "video",
      "media",
      "artifact",
      "file",
      "resource",
    ]) ??
    pickUrlFromNamedArray(candidates, [
      "video_urls",
      "videoUrls",
      "videos",
      "artifacts",
      "items",
      "creations",
      "works",
      "files",
    ]);
  const coverUrl =
    pickStringFromCandidates(candidates, [
      "cover_url",
      "coverUrl",
      "poster_url",
      "posterUrl",
      "thumbnail_url",
      "thumbnailUrl",
      "cover",
      "poster",
    ]) ??
    pickUrlFromNamedObject(candidates, ["cover", "poster", "thumbnail"]) ??
    pickUrlFromNamedArray(candidates, [
      "cover_urls",
      "coverUrls",
      "posters",
      "thumbnails",
    ]);

  return { videoUrl, coverUrl, candidates };
}

function buildDoubaoPromptText(request: UnifiedVideoGenerationRequest) {
  const suffix = [
    `--resolution ${request.resolution}`,
    `--duration ${request.durationSec}`,
    `--ratio ${request.aspectRatio}`,
    request.mode === "image-to-video" ? "--camerafixed false" : null,
    "--watermark true",
  ]
    .filter(Boolean)
    .join(" ");

  return `${request.prompt.trim()} ${suffix}`.trim();
}

function mapMiniMaxDuration(durationSec: number) {
  return durationSec <= 6 ? 6 : 10;
}

function mapMiniMaxResolution(resolution: UnifiedVideoGenerationRequest["resolution"]) {
  return resolution === "1080p" ? "1080P" : "768P";
}

function mapViduDuration(durationSec: number) {
  return durationSec <= 5 ? "5" : "8";
}

function mapKlingDuration(durationSec: number) {
  return durationSec <= 5 ? "5" : "10";
}

function pickPrimaryReferenceImage(request: UnifiedVideoGenerationRequest) {
  return request.firstFrameImage ?? request.referenceImages[0];
}

async function createDoubaoTask(
  credentials: ProviderCredentialState["doubao"],
  request: UnifiedVideoGenerationRequest,
): Promise<UnifiedVideoCreateResponse> {
  const payload = {
    model: request.model || getProviderDefaultModel("doubao", request.mode),
    content: [
      {
        type: "text",
        text: buildDoubaoPromptText(request),
      },
      ...(request.firstFrameImage
        ? [
            {
              type: "image_url",
              image_url: {
                url: request.firstFrameImage,
              },
            },
          ]
        : []),
      ...(request.lastFrameImage
        ? [
            {
              type: "image_url",
              image_url: {
                url: request.lastFrameImage,
              },
            },
          ]
        : []),
    ],
  };

  const data = await requestJson(
    "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    "火山引擎 / 豆包",
  );

  if (!isRecord(data)) {
    throw new Error("火山引擎 / 豆包 返回结构无效。");
  }

  const taskId =
    pickString(data, ["id", "task_id", "taskId"]) ??
    (isRecord(data.data) ? pickString(data.data, ["id", "task_id", "taskId"]) : undefined);

  if (!taskId) {
    throw new Error("火山引擎 / 豆包 没有返回任务 ID。");
  }

  const rawStatus =
    pickString(data, ["status"]) ??
    (isRecord(data.data) ? pickString(data.data, ["status"]) : undefined) ??
    "queued";

  return {
    providerId: "doubao",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
  };
}

async function queryDoubaoTask(
  credentials: ProviderCredentialState["doubao"],
  taskId: string,
): Promise<UnifiedVideoStatusResponse> {
  const data = await requestJson(
    `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`,
    {
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
    },
    "火山引擎 / 豆包",
  );

  if (!isRecord(data)) {
    throw new Error("火山引擎 / 豆包 返回结构无效。");
  }

  const nested = isRecord(data.data) ? data.data : data;
  const rawStatus = pickString(nested, ["status", "state"]) ?? "queued";
  const { videoUrl, coverUrl, candidates } = extractMediaUrls(nested);
  const errorMessage =
    pickStringFromCandidates(candidates, [
      "error",
      "error_message",
      "errorMessage",
      "message",
      "msg",
      "reason",
      "detail",
    ]) ??
    (normalizeStatus(rawStatus) === "succeeded" && !videoUrl
      ? "任务已完成，但供应商没有返回可预览的视频地址。"
      : undefined);

  return {
    providerId: "doubao",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
    videoUrl,
    coverUrl,
    errorMessage,
  };
}

async function createMiniMaxTask(
  credentials: ProviderCredentialState["minimax"],
  request: UnifiedVideoGenerationRequest,
): Promise<UnifiedVideoCreateResponse> {
  const firstFrameImage = pickPrimaryReferenceImage(request);
  const payload: UnknownRecord = {
    model: request.model || getProviderDefaultModel("minimax", request.mode),
    prompt: request.prompt.trim(),
    duration: mapMiniMaxDuration(request.durationSec),
    resolution: mapMiniMaxResolution(request.resolution),
  };

  if (request.mode === "image-to-video") {
    if (!firstFrameImage) {
      throw new Error("MiniMax 图生视频需要至少一张参考图。");
    }

    payload.first_frame_image = firstFrameImage;

    if (request.lastFrameImage) {
      payload.last_frame_image = request.lastFrameImage;
    }
  }

  const data = await requestJson(
    `${MINIMAX_API_BASE}/video_generation`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    "MiniMax",
  );

  if (!isRecord(data)) {
    throw new Error("MiniMax 返回结构无效。");
  }

  const baseResponse = isRecord(data.base_resp) ? data.base_resp : undefined;
  const taskId =
    pickString(data, ["task_id", "taskId", "id"]) ??
    (baseResponse ? pickString(baseResponse, ["task_id", "taskId"]) : undefined);

  if (!taskId) {
    throw new Error("MiniMax 没有返回任务 ID。");
  }

  const rawStatus =
    pickString(data, ["status"]) ??
    pickString(baseResponse ?? {}, ["status"]) ??
    "queued";

  return {
    providerId: "minimax",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
  };
}

async function queryMiniMaxTask(
  credentials: ProviderCredentialState["minimax"],
  taskId: string,
): Promise<UnifiedVideoStatusResponse> {
  const data = await requestJson(
    `${MINIMAX_API_BASE}/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
    {
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
    },
    "MiniMax",
  );

  if (!isRecord(data)) {
    throw new Error("MiniMax 返回结构无效。");
  }

  const baseResponse = isRecord(data.base_resp) ? data.base_resp : undefined;
  const rawStatus =
    pickString(data, ["status", "state"]) ??
    pickString(baseResponse ?? {}, ["status"]) ??
    "queued";

  let videoUrl = pickString(data, [
    "download_url",
    "downloadUrl",
    "video_url",
    "videoUrl",
    "file_url",
    "fileUrl",
  ]);

  const coverUrl = pickString(data, [
    "cover_url",
    "coverUrl",
    "poster_url",
    "posterUrl",
  ]);

  const fileId = pickString(data, ["file_id", "fileId"]);

  if (!videoUrl && fileId && normalizeStatus(rawStatus) === "succeeded") {
    const fileData = await requestJson(
      `${MINIMAX_API_BASE}/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
      {
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
        },
      },
      "MiniMax",
    );

    if (isRecord(fileData)) {
      videoUrl =
        pickString(fileData, [
          "download_url",
          "downloadUrl",
          "file_url",
          "fileUrl",
          "url",
        ]) ??
        (isRecord(fileData.file)
          ? pickString(fileData.file, [
              "download_url",
              "downloadUrl",
              "file_url",
              "fileUrl",
              "url",
            ])
          : undefined);
    }
  }

  const errorMessage =
    pickString(data, [
      "status_msg",
      "statusMsg",
      "message",
      "msg",
      "error",
      "reason",
    ]) ??
    pickString(baseResponse ?? {}, ["status_msg", "statusMsg", "message"]);

  return {
    providerId: "minimax",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
    videoUrl,
    coverUrl,
    errorMessage,
  };
}

async function createViduTask(
  credentials: ProviderCredentialState["vidu"],
  request: UnifiedVideoGenerationRequest,
): Promise<UnifiedVideoCreateResponse> {
  const firstFrameImage = pickPrimaryReferenceImage(request);
  const usesStartEnd = Boolean(firstFrameImage && request.lastFrameImage);
  const endpoint =
    request.mode === "text-to-video"
      ? `${VIDU_API_BASE}/text2video`
      : usesStartEnd
        ? `${VIDU_API_BASE}/start-end2video`
        : `${VIDU_API_BASE}/img2video`;

  const payload: UnknownRecord = {
    model: request.model || getProviderDefaultModel("vidu", request.mode),
    prompt: request.prompt.trim(),
    duration: mapViduDuration(request.durationSec),
    resolution: request.resolution,
    movement_amplitude: "auto",
  };

  if (request.mode === "text-to-video") {
    payload.aspect_ratio = request.aspectRatio;
  } else {
    if (!firstFrameImage) {
      throw new Error("Vidu 图生视频需要至少一张参考图。");
    }

    payload.images = usesStartEnd
      ? [firstFrameImage, request.lastFrameImage]
      : [firstFrameImage];
    payload.scene_type = "general";
  }

  const data = await requestJson(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${credentials.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    "Vidu",
  );

  if (!isRecord(data)) {
    throw new Error("Vidu 返回结构无效。");
  }

  const taskId =
    pickString(data, ["task_id", "taskId", "id"]) ??
    (isRecord(data.data) ? pickString(data.data, ["task_id", "taskId", "id"]) : undefined);

  if (!taskId) {
    throw new Error("Vidu 没有返回任务 ID。");
  }

  const rawStatus =
    pickString(data, ["state", "status"]) ??
    (isRecord(data.data) ? pickString(data.data, ["state", "status"]) : undefined) ??
    "created";

  return {
    providerId: "vidu",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
  };
}

async function queryViduTask(
  credentials: ProviderCredentialState["vidu"],
  taskId: string,
): Promise<UnifiedVideoStatusResponse> {
  const data = await requestJson(
    `${VIDU_API_BASE}/tasks/${encodeURIComponent(taskId)}/creations`,
    {
      headers: {
        Authorization: `Token ${credentials.apiKey}`,
      },
    },
    "Vidu",
  );

  if (!isRecord(data)) {
    throw new Error("Vidu 返回结构无效。");
  }

  const rawStatus =
    pickString(data, ["state", "status"]) ??
    (isRecord(data.data) ? pickString(data.data, ["state", "status"]) : undefined) ??
    "created";
  const { videoUrl, coverUrl, candidates } = extractMediaUrls(data);
  const errorMessage =
    pickStringFromCandidates(candidates, [
      "err_msg",
      "errMsg",
      "message",
      "msg",
      "error",
      "reason",
      "detail",
    ]) ??
    pickString(data, ["err_code", "errCode"]);

  return {
    providerId: "vidu",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
    videoUrl,
    coverUrl,
    errorMessage,
  };
}

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createKlingJwtToken(credentials: ProviderCredentialState["kling"]) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: credentials.accessKey,
      exp: now + 1800,
      nbf: now - 5,
    }),
  );
  const signature = createHmac("sha256", credentials.secretKey)
    .update(`${header}.${payload}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${header}.${payload}.${signature}`;
}

async function createKlingTask(
  credentials: ProviderCredentialState["kling"],
  request: UnifiedVideoGenerationRequest,
): Promise<UnifiedVideoCreateResponse> {
  const firstFrameImage = pickPrimaryReferenceImage(request);
  const endpoint =
    request.mode === "image-to-video"
      ? `${KLING_API_BASE}/v1/videos/image2video`
      : `${KLING_API_BASE}/v1/videos/text2video`;
  const payload: UnknownRecord = {
    model_name: request.model || getProviderDefaultModel("kling", request.mode),
    prompt: request.prompt.trim(),
    duration: mapKlingDuration(request.durationSec),
    aspect_ratio: request.aspectRatio,
  };

  if (request.mode === "image-to-video") {
    if (!firstFrameImage) {
      throw new Error("Kling 图生视频需要至少一张参考图。");
    }

    payload.image = firstFrameImage;

    if (request.lastFrameImage) {
      payload.image_tail = request.lastFrameImage;
    }
  }

  const data = await requestJson(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${createKlingJwtToken(credentials)}`,
      },
      body: JSON.stringify(payload),
    },
    "Kling",
  );

  if (!isRecord(data)) {
    throw new Error("Kling 返回结构无效。");
  }

  const taskId =
    pickString(data, ["task_id", "taskId", "id"]) ??
    (isRecord(data.data) ? pickString(data.data, ["task_id", "taskId", "id"]) : undefined);

  if (!taskId) {
    throw new Error("Kling 没有返回任务 ID。");
  }

  const rawStatus =
    pickString(data, ["status", "task_status", "taskStatus"]) ??
    (isRecord(data.data)
      ? pickString(data.data, ["status", "task_status", "taskStatus"])
      : undefined) ??
    "submitted";

  return {
    providerId: "kling",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
  };
}

async function queryKlingTaskWithEndpoint(
  credentials: ProviderCredentialState["kling"],
  taskId: string,
  endpoint: string,
) {
  return requestJson(
    endpoint,
    {
      headers: {
        Authorization: `Bearer ${createKlingJwtToken(credentials)}`,
      },
    },
    "Kling",
  );
}

async function queryKlingTask(
  credentials: ProviderCredentialState["kling"],
  taskId: string,
): Promise<UnifiedVideoStatusResponse> {
  const endpoints = [
    `${KLING_API_BASE}/v1/videos/${encodeURIComponent(taskId)}`,
    `${KLING_API_BASE}/v1/videos/text2video/${encodeURIComponent(taskId)}`,
    `${KLING_API_BASE}/v1/videos/image2video/${encodeURIComponent(taskId)}`,
  ];

  let data: unknown = null;
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      data = await queryKlingTaskWithEndpoint(credentials, taskId, endpoint);
      break;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Kling 查询任务失败。");
    }
  }

  if (!isRecord(data)) {
    throw lastError ?? new Error("Kling 查询任务失败。");
  }

  const nested = isRecord(data.data) ? data.data : data;
  const rawStatus =
    pickString(nested, ["status", "task_status", "taskStatus"]) ??
    pickString(data, ["status", "task_status", "taskStatus"]) ??
    "queued";
  const { videoUrl, coverUrl, candidates } = extractMediaUrls(nested);
  const errorMessage =
    pickStringFromCandidates(candidates, [
      "error",
      "error_message",
      "errorMessage",
      "message",
      "msg",
      "reason",
      "detail",
    ]) ??
    (normalizeStatus(rawStatus) === "succeeded" && !videoUrl
      ? "任务已完成，但 Kling 没有返回可预览的视频地址。"
      : undefined);

  return {
    providerId: "kling",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
    videoUrl,
    coverUrl,
    errorMessage,
  };
}

async function createTaskWithProvider(
  providerId: VideoProviderId,
  credentials: ProviderCredentialState,
  request: UnifiedVideoGenerationRequest,
) {
  if (providerId === "doubao") {
    return createDoubaoTask(credentials.doubao, request);
  }

  if (providerId === "minimax") {
    return createMiniMaxTask(credentials.minimax, request);
  }

  if (providerId === "vidu") {
    return createViduTask(credentials.vidu, request);
  }

  return createKlingTask(credentials.kling, request);
}

export async function createVideoGenerationTask(body: GenerateVideoBody) {
  const providers = resolveProviderForCreate(body);
  let lastError: Error | null = null;

  for (const providerId of providers) {
    try {
      return await createTaskWithProvider(providerId, body.credentials, body.request);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("供应商调用失败。");
    }
  }

  throw lastError ?? new Error("没有可用的 provider。");
}

export async function queryVideoGenerationTask(body: QueryVideoBody) {
  if (body.providerId === "doubao") {
    return queryDoubaoTask(body.credentials.doubao, body.taskId);
  }

  if (body.providerId === "minimax") {
    return queryMiniMaxTask(body.credentials.minimax, body.taskId);
  }

  if (body.providerId === "vidu") {
    return queryViduTask(body.credentials.vidu, body.taskId);
  }

  return queryKlingTask(body.credentials.kling, body.taskId);
}
