import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { apiKey?: string };
    const apiKey = body.apiKey?.trim() ?? "";

    if (!apiKey) {
      return NextResponse.json({
        success: false,
        message: "未提供 API Key",
        configured: false,
      });
    }

    // 测试 API 调用
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "doubao-seed-2-0-pro-260215",
          stream: false,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "你好，请回复'测试成功'",
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json();
        return NextResponse.json({
          success: false,
          message: error.message || "API 调用失败",
          status: response.status,
          configured: true,
        });
      }

      const result = await response.json();

      return NextResponse.json({
        success: true,
        message: "API Key 配置正确，连接成功！",
        result: result,
        configured: true,
      });
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        return NextResponse.json({
          success: false,
          message: "API 请求超时，请检查网络连接",
          configured: true,
        });
      }

      return NextResponse.json({
        success: false,
        message: error instanceof Error ? error.message : "API 调用失败",
        configured: true,
      });
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "测试失败",
      },
      { status: 500 },
    );
  }
}
