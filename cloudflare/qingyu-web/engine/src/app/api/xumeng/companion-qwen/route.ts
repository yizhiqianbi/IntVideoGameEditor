function closed(): Response {
  return Response.json(
    { error: "女友聊天只经过站点网关，不再使用这条本地接口。" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = closed;
export const POST = closed;
