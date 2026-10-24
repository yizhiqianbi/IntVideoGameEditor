import { handleDzmmChatGet, handleDzmmChatPost } from "@/lib/dzmm-chat-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return handleDzmmChatGet(process.env);
}

export async function POST(request: Request) {
  return handleDzmmChatPost(request, process.env);
}
