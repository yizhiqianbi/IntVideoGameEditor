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
      const message = isRecord(payload)
        ? pickString(payload, ["message", "error", "code"]) ?? "生图请求失败。"
        : "生图请求失败。";
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
