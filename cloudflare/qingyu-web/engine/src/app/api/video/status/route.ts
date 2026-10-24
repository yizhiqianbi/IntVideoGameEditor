import { NextResponse } from "next/server";
import { queryVideoGenerationTask } from "@/lib/video-generation-server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await queryVideoGenerationTask(body);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "查询视频任务状态失败。",
      },
      {
        status: 400,
      },
    );
  }
}
