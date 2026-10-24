import { NextResponse } from "next/server";
import playAgentSessionsModule from "@/lib/play-agent/sessions";

const { getPlayAgentEvents } =
  playAgentSessionsModule as typeof import("@/lib/play-agent/sessions");

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json(getPlayAgentEvents(id));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "读取 Play Agent 事件失败。",
      },
      { status: 500 },
    );
  }
}
