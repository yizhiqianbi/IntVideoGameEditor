import { withNegativePrompt } from "@/lib/generation-constraints";
import { generateFluxStill } from "@/lib/drama-flux";
import { NextResponse } from "next/server";
import {
  GROK_IMAGE_MODEL,
  IMAGE_MODEL_OPTIONS,
  DEFAULT_CHARACTER_IMAGE_MODEL,
  isLocalFluxModel,
  type ImageGenerationModel,
} from "../../../../lib/image-generation";

export const maxDuration = 180;

type RequestBody = {
  apiKey?: string;
  prompt?: string;
  negativePrompt?: string;
  model?: ImageGenerationModel;
  image?: string;
  size?: "1K" | "2K";
  aspectRatio?: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function pickString(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

async function fetchImageAsBase64(imageUrl: string) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error("无法读取生图结果。");
  }

  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get("content-type") || "image/png";
  const b64Json = Buffer.from(arrayBuffer).toString("base64");

  return {
    mimeType,
    b64Json,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    const model = body.model ?? DEFAULT_CHARACTER_IMAGE_MODEL;
    if (!IMAGE_MODEL_OPTIONS.some((option) => option.value === model)) {
      return NextResponse.json(
        { message: "不支持的生图模型。" },
        { status: 400 },
      );
    }
    const isFlux = isLocalFluxModel(model);
    const isGrok = model === GROK_IMAGE_MODEL;
    const apiKey = isGrok
      ? body.apiKey?.trim() || process.env.OPENROUTER_API_KEY
      : body.apiKey?.trim();
    if (isGrok && !apiKey) {
      return NextResponse.json(
        { message: "请在设置中填写 OpenRouter API Key。" },
        { status: 400 },
      );
    }
    if (!isFlux && !isGrok && !apiKey) {
      return NextResponse.json(
        { message: "请先填写火山 API Key。" },
        { status: 400 },
      );
    }

    if (!body.prompt || body.prompt.trim().length === 0) {
      return NextResponse.json(
        { message: "角色生图提示词不能为空。" },
        { status: 400 },
      );
    }

    let prompt: string;
    try {
      prompt = withNegativePrompt(body.prompt, body.negativePrompt);
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "负面提示词无效" },
        { status: 400 },
      );
    }
    const reference =
      typeof body.image === "string" &&
      /^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(body.image) &&
      body.image.length <= 12 * 1024 * 1024
        ? body.image
        : undefined;
    const size = body.size === "2K" ? "2K" : "1K";
    if (isFlux) {
      try {
        return NextResponse.json(
          await generateFluxStill({
            prompt,
            image: reference,
            size,
            aspectRatio:
              body.aspectRatio === "16:9" ||
              body.aspectRatio === "9:16" ||
              body.aspectRatio === "1:1" ||
              body.aspectRatio === "2:1"
                ? body.aspectRatio
                : size === "2K"
                  ? "2:1"
                  : undefined,
          }),
        );
      } catch (error) {
        return NextResponse.json(
          {
            message: error instanceof Error ? error.message : "Flux 生图失败",
          },
          { status: 502 },
        );
      }
    }
    const grokPayload: Record<string, unknown> = {
      model,
      prompt,
      resolution: size,
      quality: size === "2K" ? "medium" : "low",
      n: 1,
    };
    if (size === "2K")
      grokPayload.aspect_ratio =
        body.aspectRatio === "16:9" || body.aspectRatio === "3:2"
          ? body.aspectRatio
          : "2:1";
    if (reference) grokPayload.images = [reference];
    const seedreamPayload: Record<string, unknown> = {
      model: body.model ?? DEFAULT_CHARACTER_IMAGE_MODEL,
      prompt,
      size,
      sequential_image_generation: "disabled",
      response_format: "url",
      stream: false,
      watermark: true,
    };
    if (reference) seedreamPayload.image = reference;
    const response = await fetch(
      isGrok
        ? "https://openrouter.ai/api/v1/images"
        : "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(110_000),
        body: JSON.stringify(isGrok ? grokPayload : seedreamPayload),
      },
    );

    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const message = isRecord(payload)
        ? extractErrorMessage(payload)
        : "生图失败：未知错误";
      return NextResponse.json({ message }, { status: response.status });
    }

    if (!isRecord(payload)) {
      return NextResponse.json(
        { message: "生图返回结构无效。" },
        { status: 502 },
      );
    }

    const data = Array.isArray(payload.data) ? payload.data[0] : undefined;

    if (!isRecord(data)) {
      return NextResponse.json({ message: "生图结果为空。" }, { status: 502 });
    }

    if (
      isGrok &&
      typeof data.b64_json === "string" &&
      data.b64_json.length > 0
    ) {
      return NextResponse.json({
        model,
        mimeType:
          typeof data.media_type === "string" ? data.media_type : "image/png",
        b64Json: data.b64_json,
      });
    }

    const imageUrl =
      pickString(data, ["url"]) ??
      (isRecord(data.image) ? pickString(data.image, ["url"]) : undefined);

    if (!imageUrl) {
      return NextResponse.json(
        { message: "生图结果缺少图片内容。" },
        { status: 502 },
      );
    }

    const { mimeType, b64Json } = await fetchImageAsBase64(imageUrl);

    return NextResponse.json({
      model: body.model ?? DEFAULT_CHARACTER_IMAGE_MODEL,
      mimeType,
      b64Json,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof Error ? error.message : "生图请求失败。",
      },
      { status: 500 },
    );
  }
}

const errorCodes: { [key: string]: string } = {
  MissingParameter: "请求缺少必要参数。",
  InvalidParameter: "请求包含非法参数。",
  "InvalidEndpoint.ClosedEndpoint": "推理接入点已关闭或暂不可用。",
  SensitiveContentDetected: "输入文本包含敏感信息。",
  "SensitiveContentDetected.SevereViolation": "输入文本包含严重违规信息。",
  "SensitiveContentDetected.Violence": "输入文本包含暴力信息。",
  InputTextSensitiveContentDetected: "输入文本包含敏感信息。",
  InputImageSensitiveContentDetected: "输入图像包含敏感信息。",
  InputVideoSensitiveContentDetected: "输入视频包含敏感信息。",
  InputAudioSensitiveContentDetected: "输入音频包含敏感信息。",
  OutputTextSensitiveContentDetected: "生成的文字包含敏感信息。",
  OutputImageSensitiveContentDetected: "生成的图像包含敏感信息。",
  OutputVideoSensitiveContentDetected: "生成的视频包含敏感信息。",
  OutputAudioSensitiveContentDetected: "生成的音频包含敏感信息。",
  "InputTextSensitiveContentDetected.PolicyViolation": "输入文本违反平台规定。",
  "InputImageSensitiveContentDetected.PolicyViolation":
    "输入图片违反平台规定。",
  "InputVideoSensitiveContentDetected.PolicyViolation":
    "输入视频违反平台规定。",
  "InputAudioSensitiveContentDetected.PolicyViolation":
    "输入音频违反平台规定。",
  "InputImageSensitiveContentDetected.PrivacyInformation": "输入图片包含真人。",
  "InputVideoSensitiveContentDetected.PrivacyInformation": "输入视频包含真人。",
  InputTextRiskDetection: "输入文本可能包含敏感信息。",
  InputImageRiskDetection: "输入图片可能包含敏感信息。",
  OutputTextRiskDetection: "输出文本可能包含敏感信息。",
  OutputImageRiskDetection: "输出图片可能包含敏感信息。",
  ContentSecurityDetectionError: "风险识别请求失败。",
  "Duplicate.Tags.Key": "对象标签存在重复Key。",
  InvalidArgumentError: "消息体缺少 role 字段。",
  "InvalidArgumentError.UnknownRole": "消息体中的 role 值不支持。",
  "InvalidArgumentError.InvalidImageDetail":
    "image_url 中的 detail 参数值无效。",
  "InvalidArgumentError.InvalidPixelLimit": "图片像素限制无效。",
  "InvalidImageURL.EmptyURL": "图片 URL 为空。",
  "InvalidImageURL.InvalidFormat": "无法解析图片，可能格式错误。",
  OutofContextError: "文本和图片编码总 token 数超过限制。",
  InvalidSubscription: "Coding Plan 套餐未订阅或已过期。",
  AuthenticationError: "API Key 或 AK/SK 校验未通过。",
  InvalidAccountStatus: "账号异常。",
  "OperationDenied.InvalidState": "请求的 Context ID 处于非空闲状态。",
  "OperationDenied.ConflictedValidationSet":
    "无法同时上传验证集和设置验证集百分比。",
  "OperationDenied.PermissionDenied": "无权限访问基础模型配置。",
  "OperationDenied.UnsupportedCustomizationType": "模型不支持该训练方法。",
  "OperationDenied.ServiceNotOpen": "模型服务不可用，请激活服务。",
  "OperationDenied.ServiceOverdue": "账单逾期，请充值。",
  AccountOverdueError: "当前账号欠费，需充值。",
  AccessDenied: "无访问资源权限。",
  "InvalidEndpointOrModel.NotFound": "模型或推理接入点不存在或无权限。",
  ModelNotOpen: "账号未开通模型服务。",
  QuotaExceeded: "免费试用额度已消耗完。",
  ServerOverloaded: "服务资源紧张，请稍后重试。",
  RequestBurstTooFast: "请求量激增触发系统保护，放缓流量后再试。",
  SetLimitExceeded: "已达到推理限额，请修改或关闭体验模式。",
  InflightBatchsizeExceeded: "已达到并发数限制，充值解锁更多并发额度。",
  AccountRateLimitExceeded: "请求超出限制，稍后重试。",
  InternalServiceError: "内部系统异常，请稍后重试。",
};

function extractErrorMessage(payload: UnknownRecord): string {
  const error = isRecord(payload.error) ? payload.error : payload;
  const code = typeof error.code === "string" ? error.code : "";
  return (
    errorCodes[code] ||
    pickString(error, ["message"]) ||
    "生图失败，请稍后重试。"
  );
}
