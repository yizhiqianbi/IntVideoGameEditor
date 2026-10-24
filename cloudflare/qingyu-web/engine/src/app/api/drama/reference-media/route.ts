import { comfyFetch } from "@/lib/drama-comfy";
import { isDramaTimeoutError } from "@/lib/drama-api";

export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const body = await request.text();
    if (body.length > 4_000_000)
      return Response.json({ error: "分片过大" }, { status: 400 });
    const response = await comfyFetch("/pencil/references", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      timeoutMs: 120000,
    });
    const text = await response.text();
    let data: { error?: unknown; duration?: unknown } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      const down =
        response.status === 404 ||
        /404 Not Found|<!DOCTYPE html|Bad Gateway|Connection refused/i.test(
          text,
        );
      return Response.json(
        {
          error: down
            ? "GPU 服务已断开，正在恢复后请再点一次生成。"
            : "GPU 参考视频接口返回无效",
        },
        { status: 502 },
      );
    }
    if (response.status === 413)
      return Response.json(
        {
          error:
            typeof data.error === "string" ? data.error : "GPU 拒绝了参考视频分片",
        },
        { status: 400 },
      );
    return Response.json(data, { status: response.status });
  } catch (error) {
    const timeout = isDramaTimeoutError(error);
    return Response.json(
      {
        error: timeout
          ? "参考视频上传超时，请再试一次"
          : "参考素材上传失败，请检查 GPU 服务后重试",
      },
      { status: timeout ? 504 : 502 },
    );
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-f0-9]{32}$/.test(id))
    return Response.json({ error: "素材 ID 无效" }, { status: 400 });
  try {
    const range = request.headers.get("range");
    const response = await comfyFetch(`/pencil/references/${id}`, {
      headers: range ? { Range: range } : {},
      timeoutMs: 120000,
    });
    const headers = new Headers();
    for (const key of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const value = response.headers.get(key);
      if (value) headers.set(key, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json({ error: "参考素材暂时无法读取" }, { status: 502 });
  }
}
