import { NextResponse } from "next/server";
import playAgentSessionsModule from "@/lib/play-agent/sessions";

const { runPlayAgentSession } =
  playAgentSessionsModule as typeof import("@/lib/play-agent/sessions");

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const bundle = await runPlayAgentSession(id);
    return NextResponse.json(bundle);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "执行 Play Agent 失败。",
      },
      { status: 500 },
    );
  }
}
