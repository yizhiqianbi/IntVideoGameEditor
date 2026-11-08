import { handleDzmmIllustrationsPost } from "@/lib/dzmm-illustration-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleDzmmIllustrationsPost(request, process.env);
}
