import { ltxHealth } from "@/lib/drama-ltx";
import { fluxHealth } from "@/lib/drama-flux";
import { NextResponse } from "next/server";
import { comfyHealth } from "@/lib/drama-comfy";
export async function GET() {
  try {
    const [h3, ltx, flux] = await Promise.all([
      comfyHealth(),
      ltxHealth().catch(() => null),
      fluxHealth().catch(() => null),
    ]);
    return NextResponse.json({
      connected: true,
      ...h3,
      flux: {
        ready: !!flux?.ready,
        checkpoint: flux?.checkpoint,
        lora: flux?.lora,
        error: flux?.ready ? undefined : "图像服务未就绪",
      },
      ltx: {
        ready: !!ltx && ltx.missing?.length === 0,
        loaded: !!ltx?.model_loaded,
        t2v: !!ltx?.t2v,
        pinkcherry: !!ltx && ltx.missing?.length === 0 && ltx.pinkcherry !== false,
        gguf: !!ltx?.gguf,
        checkpoint: ltx?.checkpoint_id,
        error:
          ltx?.missing?.join("、") || (!ltx ? "LTX 服务未连接" : undefined),
      },
    });
  } catch {
    return NextResponse.json({
      connected: false,
      ready: false,
      error: "GPU 连接未建立，请启动 SSH 隧道并检查实例。",
    });
  }
}
