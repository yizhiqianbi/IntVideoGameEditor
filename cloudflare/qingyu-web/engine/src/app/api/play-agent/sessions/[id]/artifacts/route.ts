import { NextResponse } from "next/server";
import playAgentSessionsModule from "@/lib/play-agent/sessions";

const { getPlayAgentArtifacts } =
  playAgentSessionsModule as typeof import("@/lib/play-agent/sessions");

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json(getPlayAgentArtifacts(id));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "读取 Play Agent 产物失败。",
      },
      { status: 500 },
    );
  }
}
