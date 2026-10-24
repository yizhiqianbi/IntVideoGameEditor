import { COMFY_BASE } from "@/lib/drama-comfy";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const maxDuration = 60;
async function proxy(request: Request) {
  const vault = request.headers.get("X-Archive-Vault") || "";
  if (!uuid.test(vault))
    return Response.json({ error: "存档库标识无效" }, { status: 400 });
  const token = process.env.DRAMA_ARCHIVE_TOKEN;
  if (!token)
    return Response.json(
      { error: "AutoDL 存档服务尚未配置，请先下载本地存档。" },
      { status: 503 },
    );
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id"),
      part = params.get("part") || "0";
    if (!/^\d{1,4}$/.test(part) || Number(part) > 1023)
      return Response.json({ error: "分片无效" }, { status: 400 });
    if (id && !uuid.test(id))
      return Response.json({ error: "存档 ID 无效" }, { status: 400 });
    const response = await fetch(
      `${COMFY_BASE}/pencil/archives${id ? `?id=${id}&part=${part}` : ""}`,
      {
        method: request.method,
        headers: {
          "Content-Type": "application/json",
          "X-Archive-Vault": vault,
          Authorization: `Bearer ${token}`,
        },
        body: request.method === "POST" ? await request.text() : undefined,
        signal: AbortSignal.timeout(55000),
        cache: "no-store",
      },
    );
    if (!response.ok)
      return Response.json(
        { error: "AutoDL 存档服务读取或写入失败，请检查后端连接。" },
        { status: response.status },
      );
    return new Response(response.body, {
      headers: {
        "Content-Type":
          response.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
        "X-Archive-Size": response.headers.get("X-Archive-Size") || "0",
      },
    });
  } catch {
    return Response.json(
      { error: "AutoDL 存档服务无法连接，本地下载仍可使用。" },
      { status: 502 },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
