import { adminAllowed } from "@/lib/admin-auth";
import { saveCustomImage, deleteCustomImage } from "@/lib/custom-templates";
import { jsonError, sameOrigin } from "@/lib/http";
import { saveLiveTemplate } from "@/lib/live-edits";
import { templateRows } from "@/lib/template-admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function denied(request: Request) {
  if (!sameOrigin(request)) return jsonError("当前来源不能管理模板。", 403);
  if (!adminAllowed(request)) return jsonError("先登录后台。", 401);
  return null;
}

export async function GET(request: Request) {
  const refusal = denied(request);
  if (refusal) return refusal;
  return NextResponse.json(templateRows(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const refusal = denied(request);
  if (refusal) return refusal;
  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError("请求格式无效。", 400); }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("先选择模板图。", 400);
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const item = saveCustomImage({
      label: typeof form.get("label") === "string" ? form.get("label") as string : "",
      group: typeof form.get("group") === "string" ? form.get("group") as string : "",
      frame: typeof form.get("frame") === "string" ? form.get("frame") as string : "",
      bytes,
    });
    return NextResponse.json({ id: item.id, label: item.label }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "模板没有存上。", 400);
  }
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export async function PATCH(request: Request) {
  const refusal = denied(request);
  if (refusal) return refusal;
  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError("请求格式无效。", 400); }
  const kind = field(form, "kind");
  if (kind !== "image" && kind !== "video") return jsonError("没有这个模板。", 400);
  const file = form.get("file");
  const bytes = file instanceof File && file.size > 0 ? Buffer.from(await file.arrayBuffer()) : null;
  try {
    saveLiveTemplate({
      id: field(form, "id"),
      kind,
      label: field(form, "label"),
      group: field(form, "group"),
      content: field(form, "content"),
      prompt: field(form, "prompt"),
      listed: field(form, "listed") === "1",
      bytes,
    });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "模板没有存上。";
    const status = /EPERM|EROFS|EACCES/i.test(message) ? 500 : 400;
    return jsonError(status === 500 ? "当前环境写不进模板，修改没有保存。" : message, status);
  }
}

export async function DELETE(request: Request) {
  const refusal = denied(request);
  if (refusal) return refusal;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!deleteCustomImage(id)) return jsonError("没有这个上传的模板。", 404);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
