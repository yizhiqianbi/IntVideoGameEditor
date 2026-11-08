import { comfyFetch } from "@/lib/drama-comfy";
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-f0-9]{12}$/.test(id))
    return new Response("Invalid id", { status: 400 });
  try {
    const r = await comfyFetch(`/pencil/ltx/jobs/${id}/video`, {
      headers: request.headers.has("range")
        ? { Range: request.headers.get("range")! }
        : {},
    });
    const headers = new Headers();
    for (const key of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const v = r.headers.get(key);
      if (v) headers.set(key, v);
    }
    return new Response(r.body, { status: r.status, headers });
  } catch {
    return new Response("LTX media unavailable", { status: 502 });
  }
}
