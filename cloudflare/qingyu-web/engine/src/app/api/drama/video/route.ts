import { ltxGenerate, ltxStatus, ltxCancel } from "@/lib/drama-ltx";
import { isLtxFamily, validateGpuModel } from "@/lib/drama-models";
import { NextResponse } from "next/server";
import { createFalClient } from "@fal-ai/client";
import { buildDramaInput, DRAMA_MODELS, type DramaMode } from "@/lib/drama";
import { comfyGenerate, comfyStatus, comfyCancel } from "@/lib/drama-comfy";
import { isDramaTimeoutError } from "@/lib/drama-api";
export const maxDuration = 180;
export async function POST(request: Request) {
  try {
    const b = await request.json();
    if (b.timelineDirector?.enabled) {
      b.videoModel = "h3";
      if (b.provider !== "comfy")
        throw new Error("时间线导演台只支持自有 GPU 的 H3");
    }
    if (b.action === "create" && b.referenceMedia?.length && !b.timelineDirector?.enabled && (b.provider !== "comfy" || (b.videoModel || "h3") !== "h3" || b.mode !== "ri2v"))
      throw new Error("音视频参考目前仅支持自有 GPU 的 H3 参考模式");
    if (b.provider === "comfy") {
      const model = validateGpuModel(b.videoModel);
      if (b.action === "cancel") {
        if (isLtxFamily(model)) return NextResponse.json(await ltxCancel(b.taskId));
        return NextResponse.json(await comfyCancel(b.taskId));
      }
      if (isLtxFamily(model)) {
        if (b.action === "create") return NextResponse.json(await ltxGenerate(b));
        if (b.action === "status")
          return NextResponse.json(await ltxStatus(b.taskId));
        throw new Error("操作无效");
      }
      if (b.action === "status")
        return NextResponse.json(await comfyStatus(b.taskId));
      if (b.action === "create")
        return NextResponse.json(
          await comfyGenerate(b, request.signal, new URL(request.url).origin),
        );
      throw new Error("操作无效");
    }
    const key = typeof b.apiKey === "string" ? b.apiKey.trim() : "";
    if (!key)
      return NextResponse.json(
        { error: "请在连接设置中填写 fal.ai API Key。" },
        { status: 400 },
      );
    if (!Object.hasOwn(DRAMA_MODELS, b.mode)) throw new Error("生成模式无效");
    const model = DRAMA_MODELS[b.mode as DramaMode];
    const fal = createFalClient({ credentials: key });
    if (b.action === "cancel") {
      if (typeof b.taskId === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(b.taskId)) {
        try {
          await fal.queue.cancel(model, { requestId: b.taskId });
        } catch {
          // Task may already have finished or been dropped.
        }
      }
      return NextResponse.json({ ok: true });
    }
    if (b.action === "status") {
      if (
        typeof b.taskId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,200}$/.test(b.taskId)
      )
        throw new Error("任务 ID 无效");
      const status = await fal.queue.status(model, {
        requestId: b.taskId,
        logs: false,
      });
      if (status.status !== "COMPLETED")
        return NextResponse.json({ status: status.status });
      let result;
      try {
        result = await fal.queue.result(model, { requestId: b.taskId });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          error.status === 422
        )
          return NextResponse.json({
            status: "FAILED",
            error: error instanceof Error ? error.message : "fal 生成失败",
          });
        throw error;
      }
      const data = result.data as { video?: { url?: string } };
      if (!data.video?.url)
        throw new Error("生成完成但未返回视频，请在 fal 控制台检查任务");
      return NextResponse.json({
        status: "COMPLETED",
        videoUrl: data.video.url,
      });
    }
    if (b.action !== "create") throw new Error("操作无效");
    const input = buildDramaInput(b);
    const task = await fal.queue.submit(model, { input });
    return NextResponse.json({
      taskId: task.request_id,
      status: "IN_QUEUE",
      model,
    });
  } catch (error) {
    const aborted = isDramaTimeoutError(error);
    const message = aborted
      ? "提交超时，请再点一次生成。"
      : error instanceof Error
        ? error.message
        : "视频请求失败";
    return NextResponse.json(
      { error: message },
      { status: aborted ? 504 : 400 },
    );
  }
}
