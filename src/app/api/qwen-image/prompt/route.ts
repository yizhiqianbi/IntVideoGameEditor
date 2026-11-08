import { NextResponse } from "next/server";

export const maxDuration = 180;

export async function POST(request: Request) {
  const base = process.env.QWEN_IMAGE_HERETIC_URL?.replace(/\/$/, "");
  if (!base)
    return NextResponse.json(
      { error: "Qwen Image 2.1 Heretic GPU 服务尚未配置。" },
      { status: 503 },
    );
  try {
    const body = (await request.json()) as {
      prompt?: unknown;
      messages?: unknown;
      max_tokens?: unknown;
    };
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt && !Array.isArray(body.messages))
      return NextResponse.json({ error: "请输入提示词。" }, { status: 400 });
    const messages = Array.isArray(body.messages)
      ? body.messages
      : [
          {
            role: "system",
            content:
              "You are a visual prompt writer for Qwen Image 2.1. Rewrite the user's idea into one precise image prompt. Preserve the subject and action, specify composition, camera, lighting, materials, and atmosphere. Return only the prompt, with no explanation.",
          },
          { role: "user", content: prompt },
        ];
    const response = await fetch(`${base}/v1/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        max_tokens:
          typeof body.max_tokens === "number" ? body.max_tokens : 512,
      }),
      signal: AbortSignal.timeout(160_000),
    });
    const text = await response.text();
    let data: { text?: unknown; error?: unknown } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json(
        { error: "Qwen GPU 服务返回了无效响应。" },
        { status: 502 },
      );
    }
    if (!response.ok || typeof data.text !== "string")
      return NextResponse.json(
        { error: typeof data.error === "string" ? data.error : "Qwen 提示词服务失败。" },
        { status: response.ok ? 502 : response.status },
      );
    return NextResponse.json({ text: data.text });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "Qwen GPU 服务响应超时。"
            : "Qwen GPU 服务连接失败。",
      },
      { status: 502 },
    );
  }
}
