import { comfyFetch } from "@/lib/drama-comfy";
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const filename = p.get("filename") || "";
  const subfolder = p.get("subfolder") || "";
  if (
    !/^[\w.-]+\.mp4$/i.test(filename) ||
    !/^pencil(?:\/[\w-]+)*$/.test(subfolder)
  )
    return new Response("Invalid media path", { status: 400 });
  try {
    const response = await comfyFetch(
      `/view?${new URLSearchParams({ filename, subfolder, type: "output" })}`,
      {
        headers: request.headers.has("range")
          ? { Range: request.headers.get("range")! }
          : {},
      },
    );
    const headers = new Headers();
    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return new Response("GPU media unavailable", { status: 502 });
  }
}
