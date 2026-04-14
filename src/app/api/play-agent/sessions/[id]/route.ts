import { NextResponse } from "next/server";
import playAgentSessionsModule from "@/lib/play-agent/sessions";

const { getPlayAgentSessionRecord } =
  playAgentSessionsModule as typeof import("@/lib/play-agent/sessions");

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const record = getPlayAgentSessionRecord(id);

  if (!record) {
    return NextResponse.json({ error: "未找到对应会话。" }, { status: 404 });
  }

  return NextResponse.json({
    session: record.session,
    plan: record.plan ?? null,
    hasBundle: Boolean(record.bundle),
    eventCount: record.events.length,
  });
}
