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
    normalized.includes("queue")
  ) {
    return "processing" as const;
  }

  return "queued" as const;
}

function formatAspectRatio(aspectRatio: UnifiedVideoGenerationRequest["aspectRatio"]) {
  return aspectRatio;
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

function pickString(
  record: UnknownRecord,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function createKlingToken(accessKey: string, secretKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: accessKey,
      exp: now + 30 * 60,
      nbf: now - 5,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secretKey)
    .update(`${header}.${payload}`)
    .digest("base64url");

  return `${header}.${payload}.${signature}`;
}

async function createDoubaoTask(
  credentials: ProviderCredentialState["doubao"],
  request: UnifiedVideoGenerationRequest,
): Promise<UnifiedVideoCreateResponse> {
  const payload = {
    model:
      request.model ||
      getProviderDefaultModel("doubao", request.mode),
    content: [
      ...(request.firstFrameImage
        ? [{ type: "image_url", image_url: request.firstFrameImage }]
        : []),
      ...(request.lastFrameImage
        ? [{ type: "image_url", image_url: request.lastFrameImage }]
        : []),
      {
        type: "text",
        text: `${request.prompt}\n--dur ${request.durationSec}\n--ratio ${request.aspectRatio}`,
      },
    ],
  };

  const data = await requestJson(
    "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    "Doubao",
  );

  if (!isRecord(data)) {
    throw new Error("Doubao 返回结构无效。");
  }

  const taskId =
    pickString(data, ["id", "task_id", "taskId"]) ??
    (isRecord(data.data) ? pickString(data.data, ["id", "task_id", "taskId"]) : undefined);

  if (!taskId) {
    throw new Error("Doubao 没有返回任务 ID。");
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
    `https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`,
    {
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
    },
    "Doubao",
  );

  if (!isRecord(data)) {
    throw new Error("Doubao 返回结构无效。");
  }

  const nested = isRecord(data.data) ? data.data : data;
  const rawStatus = pickString(nested, ["status", "state"]) ?? "queued";
  const videoUrl =
    pickString(nested, ["video_url", "videoUrl", "url"]) ??
    (isRecord(nested.output)
      ? pickString(nested.output, ["video_url", "videoUrl", "url"])
      : undefined);
  const coverUrl =
    pickString(nested, ["cover_url", "coverUrl", "poster_url"]) ??
    (isRecord(nested.output)
      ? pickString(nested.output, ["cover_url", "coverUrl", "poster_url"])
      : undefined);

  return {
    providerId: "doubao",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
    videoUrl,
    coverUrl,
    errorMessage: pickString(nested, ["error", "message"]),
  };
}

async function createMiniMaxTask(
  credentials: ProviderCredentialState["minimax"],
  request: UnifiedVideoGenerationRequest,
): Promise<UnifiedVideoCreateResponse> {
  const hasReferenceImages = request.referenceImages.length > 0;
  const payload: UnknownRecord = {
    prompt: request.prompt,
    model:
      request.model ||
      getProviderDefaultModel("minimax", request.mode),
    duration: request.durationSec,
    resolution: request.resolution.toUpperCase(),
  };

  if (request.mode === "image-to-video") {
    if (hasReferenceImages) {
      payload.subject_reference = [
        {
          type: "character",
          image: request.referenceImages.slice(0, 4),
        },
      ];
      payload.model = request.model || "S2V-01";
    } else if (request.firstFrameImage) {
      payload.first_frame_image = request.firstFrameImage;
    }
  }

  const data = await requestJson(
    "https://api.minimax.io/v1/video_generation",
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

  const taskId =
    pickString(data, ["task_id", "taskId", "id"]) ??
    (isRecord(data.data) ? pickString(data.data, ["task_id", "taskId", "id"]) : undefined);

  if (!taskId) {
    throw new Error("MiniMax 没有返回任务 ID。");
  }

  const rawStatus =
    pickString(data, ["status"]) ??
    (isRecord(data.base_resp)
      ? pickString(data.base_resp, ["status_msg", "message"])
      : undefined) ??
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
  const queryData = await requestJson(
    `https://api.minimax.io/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
    {
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
    },
    "MiniMax",
  );

  if (!isRecord(queryData)) {
    throw new Error("MiniMax 返回结构无效。");
  }

  const rawStatus =
    pickString(queryData, ["status"]) ??
    (isRecord(queryData.data)
      ? pickString(queryData.data, ["status"])
      : undefined) ??
    "queued";
  const normalizedStatus = normalizeStatus(rawStatus);
  const fileId =
    pickString(queryData, ["file_id"]) ??
    (isRecord(queryData.data) ? pickString(queryData.data, ["file_id"]) : undefined);

  let videoUrl: string | undefined;

  if (normalizedStatus === "succeeded" && fileId) {
    const fileData = await requestJson(
      `https://api.minimax.io/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
      {
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
        },
      },
      "MiniMax",
    );

    if (isRecord(fileData)) {
      videoUrl =
        pickString(fileData, ["download_url", "file_url"]) ??
        (isRecord(fileData.file)
          ? pickString(fileData.file, ["download_url", "file_url", "url"])
          : undefined);
    }
  }

  return {
    providerId: "minimax",
    taskId,
    status: normalizedStatus,
    rawStatus,
    videoUrl,
    errorMessage:
      pickString(queryData, ["message", "error"]) ??
      (isRecord(queryData.base_resp)
        ? pickString(queryData.base_resp, ["status_msg"])
        : undefined),
  };
}

async function createViduTask(
  credentials: ProviderCredentialState["vidu"],
  request: UnifiedVideoGenerationRequest,
): Promise<UnifiedVideoCreateResponse> {
  const hasReferenceImages = request.referenceImages.length > 1;
  const endpoint =
    request.mode === "text-to-video"
      ? "https://api.vidu.com/ent/v2/text2video"
      : hasReferenceImages
        ? "https://api.vidu.com/ent/v2/reference2video"
        : "https://api.vidu.com/ent/v2/img2video";

  const payload: UnknownRecord = {
    model:
      request.model ||
      getProviderDefaultModel("vidu", request.mode),
    prompt: request.prompt,
    aspect_ratio: formatAspectRatio(request.aspectRatio),
    duration: String(request.durationSec),
    resolution: request.resolution,
  };

  if (request.mode === "image-to-video") {
    if (hasReferenceImages) {
      payload.images = request.referenceImages.slice(0, 3);
    } else if (request.firstFrameImage || request.referenceImages[0]) {
      payload.image = request.firstFrameImage ?? request.referenceImages[0];
    } else {
      throw new Error("Vidu 图生视频至少需要一张参考图。");
    }
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
    "queued";

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
    `https://api.vidu.com/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`,
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
    "queued";
  const creations =
    (Array.isArray(data.creations) ? data.creations : undefined) ??
    (isRecord(data.data) && Array.isArray(data.data.creations)
      ? data.data.creations
      : undefined);
  const firstCreation =
    creations?.find((item) => isRecord(item)) ??
    undefined;

  return {
    providerId: "vidu",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
    videoUrl: firstCreation && isRecord(firstCreation)
      ? pickString(firstCreation, ["url", "video_url"])
      : undefined,
    coverUrl: firstCreation && isRecord(firstCreation)
      ? pickString(firstCreation, ["cover_url", "coverUrl"])
      : undefined,
    errorMessage:
      pickString(data, ["message", "error"]) ??
      (isRecord(data.data) ? pickString(data.data, ["message", "error"]) : undefined),
  };
}

async function createKlingTask(
  credentials: ProviderCredentialState["kling"],
  request: UnifiedVideoGenerationRequest,
): Promise<UnifiedVideoCreateResponse> {
  const token = createKlingToken(
    credentials.accessKey,
    credentials.secretKey,
  );
  const endpoint =
    request.mode === "text-to-video"
      ? "https://api-beijing.klingai.com/v1/videos/text2video"
      : "https://api-beijing.klingai.com/v1/videos/image2video";
  const payload: UnknownRecord = {
    model_name:
      request.model ||
      getProviderDefaultModel("kling", request.mode),
    prompt: request.prompt,
    mode: request.aspectRatio,
    duration: String(request.durationSec),
  };

  if (request.mode === "image-to-video") {
    if (request.referenceImages[0]) {
      payload.image = request.referenceImages[0];
    } else if (request.firstFrameImage) {
      payload.image = request.firstFrameImage;
    } else {
      throw new Error("Kling 图生视频至少需要一张参考图。");
    }

    if (request.referenceImages.length > 1) {
      payload.references = request.referenceImages.slice(1, 4);
    }
  }

  const data = await requestJson(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    "Kling",
  );

  if (!isRecord(data)) {
    throw new Error("Kling 返回结构无效。");
  }

  const dataRecord = isRecord(data.data) ? data.data : data;
  const taskId = pickString(dataRecord, ["task_id", "taskId", "id"]);

  if (!taskId) {
    throw new Error("Kling 没有返回任务 ID。");
  }

  const rawStatus = pickString(dataRecord, ["task_status", "status"]) ?? "queued";

  return {
    providerId: "kling",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
  };
}

async function queryKlingTask(
  credentials: ProviderCredentialState["kling"],
  taskId: string,
): Promise<UnifiedVideoStatusResponse> {
  const token = createKlingToken(
    credentials.accessKey,
    credentials.secretKey,
  );
  const data = await requestJson(
    `https://api-beijing.klingai.com/v1/videos/${encodeURIComponent(taskId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    "Kling",
  );

  if (!isRecord(data)) {
    throw new Error("Kling 返回结构无效。");
  }

  const dataRecord = isRecord(data.data) ? data.data : data;
  const rawStatus =
    pickString(dataRecord, ["task_status", "status", "state"]) ?? "queued";
  const taskResult = isRecord(dataRecord.task_result)
    ? dataRecord.task_result
    : undefined;
  const videos = taskResult && Array.isArray(taskResult.videos)
    ? taskResult.videos
    : undefined;
  const firstVideo =
    videos?.find((item) => isRecord(item)) ??
    undefined;

  return {
    providerId: "kling",
    taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
    videoUrl:
      firstVideo && isRecord(firstVideo)
        ? pickString(firstVideo, ["url", "video_url"])
        : undefined,
    coverUrl:
      firstVideo && isRecord(firstVideo)
        ? pickString(firstVideo, ["cover_url", "poster_url"])
        : undefined,
    errorMessage: pickString(dataRecord, ["message", "error"]),
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
      lastError =
        error instanceof Error ? error : new Error("供应商调用失败。");
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
