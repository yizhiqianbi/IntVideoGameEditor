import { NextResponse } from "next/server";
import {
  DEFAULT_CHARACTER_IMAGE_SIZE,
  DEFAULT_CHARACTER_IMAGE_MODEL,
  type ImageGenerationModel,
} from "../../../../lib/image-generation";

type RequestBody = {
  apiKey?: string;
  prompt?: string;
  model?: ImageGenerationModel;
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

    if (!body.apiKey || body.apiKey.trim().length === 0) {
      return NextResponse.json({ message: "请先填写火山 API Key。" }, { status: 400 });
    }

    if (!body.prompt || body.prompt.trim().length === 0) {
      return NextResponse.json({ message: "角色生图提示词不能为空。" }, { status: 400 });
    }

    const response = await fetch(
      "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${body.apiKey}`,
        },
        body: JSON.stringify({
          model: body.model ?? DEFAULT_CHARACTER_IMAGE_MODEL,
          prompt: body.prompt,
          size: DEFAULT_CHARACTER_IMAGE_SIZE,
          sequential_image_generation: "disabled",
          response_format: "url",
          stream: false,
          watermark: true,
        }),
      },
    );

    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const message = isRecord(payload) ?
        extractErrorMessage(payload) :
        "生图失败：未知错误"
      return NextResponse.json({ message }, { status: response.status });
    }

    if (!isRecord(payload)) {
      return NextResponse.json({ message: "生图返回结构无效。" }, { status: 502 });
    }

    const data = Array.isArray(payload.data) ? payload.data[0] : undefined;

    if (!isRecord(data)) {
      return NextResponse.json({ message: "生图结果为空。" }, { status: 502 });
    }

    const imageUrl =
      pickString(data, ["url"]) ??
      (isRecord(data.image) ? pickString(data.image, ["url"]) : undefined);

    if (!imageUrl) {
      return NextResponse.json({ message: "生图结果缺少图片内容。" }, { status: 502 });
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
        message:
          error instanceof Error ? error.message : "生图请求失败。",
      },
      { status: 500 },
    );
  }
}


const errorCodes: { [key: string]: string } = {
  "MissingParameter": "请求缺少必要参数。",
  "InvalidParameter": "请求包含非法参数。",
  "InvalidEndpoint.ClosedEndpoint": "推理接入点已关闭或暂不可用。",
  "SensitiveContentDetected": "输入文本包含敏感信息。",
  "SensitiveContentDetected.SevereViolation": "输入文本包含严重违规信息。",
  "SensitiveContentDetected.Violence": "输入文本包含暴力信息。",
  "InputTextSensitiveContentDetected": "输入文本包含敏感信息。",
  "InputImageSensitiveContentDetected": "输入图像包含敏感信息。",
  "InputVideoSensitiveContentDetected": "输入视频包含敏感信息。",
  "InputAudioSensitiveContentDetected": "输入音频包含敏感信息。",
  "OutputTextSensitiveContentDetected": "生成的文字包含敏感信息。",
  "OutputImageSensitiveContentDetected": "生成的图像包含敏感信息。",
  "OutputVideoSensitiveContentDetected": "生成的视频包含敏感信息。",
  "OutputAudioSensitiveContentDetected": "生成的音频包含敏感信息。",
  "InputTextSensitiveContentDetected.PolicyViolation": "输入文本违反平台规定。",
  "InputImageSensitiveContentDetected.PolicyViolation": "输入图片违反平台规定。",
  "InputVideoSensitiveContentDetected.PolicyViolation": "输入视频违反平台规定。",
  "InputAudioSensitiveContentDetected.PolicyViolation": "输入音频违反平台规定。",
  "InputImageSensitiveContentDetected.PrivacyInformation": "输入图片包含真人。",
  "InputVideoSensitiveContentDetected.PrivacyInformation": "输入视频包含真人。",
  "InputTextRiskDetection": "输入文本可能包含敏感信息。",
  "InputImageRiskDetection": "输入图片可能包含敏感信息。",
  "OutputTextRiskDetection": "输出文本可能包含敏感信息。",
  "OutputImageRiskDetection": "输出图片可能包含敏感信息。",
  "ContentSecurityDetectionError": "风险识别请求失败。",
  "Duplicate.Tags.Key": "对象标签存在重复Key。",
  "InvalidArgumentError": "消息体缺少 role 字段。",
  "InvalidArgumentError.UnknownRole": "消息体中的 role 值不支持。",
  "InvalidArgumentError.InvalidImageDetail": "image_url 中的 detail 参数值无效。",
  "InvalidArgumentError.InvalidPixelLimit": "图片像素限制无效。",
  "InvalidImageURL.EmptyURL": "图片 URL 为空。",
  "InvalidImageURL.InvalidFormat": "无法解析图片，可能格式错误。",
  "OutofContextError": "文本和图片编码总 token 数超过限制。",
  "InvalidSubscription": "Coding Plan 套餐未订阅或已过期。",
  "AuthenticationError": "API Key 或 AK/SK 校验未通过。",
  "InvalidAccountStatus": "账号异常。",
  "OperationDenied.InvalidState": "请求的 Context ID 处于非空闲状态。",
  "OperationDenied.ConflictedValidationSet": "无法同时上传验证集和设置验证集百分比。",
  "OperationDenied.PermissionDenied": "无权限访问基础模型配置。",
  "OperationDenied.UnsupportedCustomizationType": "模型不支持该训练方法。",
  "OperationDenied.ServiceNotOpen": "模型服务不可用，请激活服务。",
  "OperationDenied.ServiceOverdue": "账单逾期，请充值。",
  "AccountOverdueError": "当前账号欠费，需充值。",
  "AccessDenied": "无访问资源权限。",
  "InvalidEndpointOrModel.NotFound": "模型或推理接入点不存在或无权限。",
  "ModelNotOpen": "账号未开通模型服务。",
  "QuotaExceeded": "免费试用额度已消耗完。",
  "ServerOverloaded": "服务资源紧张，请稍后重试。",
  "RequestBurstTooFast": "请求量激增触发系统保护，放缓流量后再试。",
  "SetLimitExceeded": "已达到推理限额，请修改或关闭体验模式。",
  "InflightBatchsizeExceeded": "已达到并发数限制，充值解锁更多并发额度。",
  "AccountRateLimitExceeded": "请求超出限制，稍后重试。",
  "InternalServiceError": "内部系统异常，请稍后重试。"
};

function extractErrorMessage(payload: any): string | null {
    const code = payload.error?.code;
    if (!code) {
        return null
    }
    return errorCodes[code]
}