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
  if (body.providerId !== "auto" && body.providerId !== "doubao") {
    throw new Error("当前仅支持火山引擎 / 豆包 API。");
  }

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
      "output",
      "result",
      "data",
      "video",
      "media",
      "artifact",
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

    for (const key of [
      "contents",
      "outputs",
      "results",
      "videos",
      "artifacts",
      "items",
      "assets",
      "files",
    ]) {
      const nested = current[key];

      if (Array.isArray(nested)) {
        for (const item of nested) {
          queue.push(item);
        }
      }
    }
  }

  return candidates;
}

function pickStringFromCandidates(
  candidates: UnknownRecord[],
  keys: string[],
) {
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
        ]);

        if (url) {
          return url;
        }
      }
    }
  }

  return undefined;
}

function extractDoubaoMediaUrls(root: UnknownRecord) {
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
    ]) ??
    pickUrlFromNamedObject(candidates, ["video", "media", "artifact"]) ??
    pickUrlFromNamedArray(candidates, [
      "video_urls",
      "videoUrls",
      "videos",
      "artifacts",
      "items",
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

async function createDoubaoTask(
  credentials: ProviderCredentialState["doubao"],
  request: UnifiedVideoGenerationRequest,
): Promise<UnifiedVideoCreateResponse> {
  const payload = {
    model:
      request.model ||
      getProviderDefaultModel("doubao", request.mode),
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
  const { videoUrl, coverUrl, candidates } = extractDoubaoMediaUrls(nested);
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

async function createTaskWithProvider(
  providerId: VideoProviderId,
  credentials: ProviderCredentialState,
  request: UnifiedVideoGenerationRequest,
) {
  if (providerId === "doubao") {
    return createDoubaoTask(credentials.doubao, request);
  }

  throw new Error("当前仅支持火山引擎 / 豆包 API。");
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

  throw new Error("当前仅支持火山引擎 / 豆包 API。");
}
