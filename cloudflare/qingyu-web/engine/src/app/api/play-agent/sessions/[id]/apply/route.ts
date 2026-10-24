import { NextResponse } from "next/server";
import playAgentSessionsModule from "@/lib/play-agent/sessions";

const { buildPlayAgentApplyPayload } =
  playAgentSessionsModule as typeof import("@/lib/play-agent/sessions");

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json(buildPlayAgentApplyPayload(id));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "应用 Play Agent 产物失败。",
      },
      { status: 500 },
    );
  }
}
