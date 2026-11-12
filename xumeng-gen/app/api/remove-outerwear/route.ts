import { POST as channelPost } from "../channel/route";
import { handleRemoveOuterwear } from "@/lib/remove-outerwear.mjs";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED = new Set(["qwen_image21_multi_image_edit", "qwen_vqa"]);

async function fetchImpl(_url: string, init: RequestInit) {
  const payload = JSON.parse(String(init?.body ?? "{}")) as { id?: string };
  if (!payload.id || !ALLOWED.has(payload.id)) {
    return new Response(JSON.stringify({ error: "没有这个渠道能力。" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  return channelPost(new Request("https://xumeng-gen.vercel.app/api/channel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function POST(request: Request) {
  return handleRemoveOuterwear(request, { fetchImpl });
}
