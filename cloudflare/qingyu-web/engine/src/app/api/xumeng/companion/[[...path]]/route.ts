function closed(): Response {
  return Response.json(
    { error: "女友聊天只经过站点网关 /api/qingyu/companion。" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = closed;
export const POST = closed;
export const PATCH = closed;
export const DELETE = closed;
