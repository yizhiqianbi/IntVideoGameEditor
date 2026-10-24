import { NextResponse } from "next/server";

function isAllowedRemoteUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      url?: string;
    };
    const sourceUrl = body.url?.trim();

    if (!sourceUrl || !isAllowedRemoteUrl(sourceUrl)) {
      return NextResponse.json(
        {
          message: "导出媒体地址不合法。",
        },
        {
          status: 400,
        },
      );
    }

    const response = await fetch(sourceUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          message: `远程媒体读取失败（${response.status}）。`,
        },
        {
          status: 400,
        },
      );
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await response.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "导出媒体失败。",
      },
      {
        status: 500,
      },
    );
  }
}
