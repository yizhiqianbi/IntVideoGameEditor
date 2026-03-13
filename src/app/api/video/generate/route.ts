import { NextResponse } from "next/server";
import { createVideoGenerationTask } from "@/lib/video-generation-server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await createVideoGenerationTask(body);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "创建视频生成任务失败。",
      },
      {
        status: 400,
      },
    );
  }
}
