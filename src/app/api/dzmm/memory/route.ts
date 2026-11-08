import { handleDzmmMemoryPost } from "@/lib/dzmm-memory-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleDzmmMemoryPost(request, process.env);
}
