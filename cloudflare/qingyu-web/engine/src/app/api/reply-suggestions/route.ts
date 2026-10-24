import { handleDzmmReplySuggestionsPost } from "@/lib/dzmm-reply-suggestions-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleDzmmReplySuggestionsPost(request, process.env);
}
