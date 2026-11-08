import { WorkerEntrypoint } from "cloudflare:workers";
import { renderKrea2Still } from "../../../src/lib/xumeng-krea2-bridge";
import { writeCanvasAgent, type CanvasAgentNode } from "./canvas-agent";
import { writeGeminiImagePrompt } from "./gemini-image-prompt";
import { h3CanvasSize, runH3CanvasVideo } from "./h3-r2v";
import { writeH3OfficialPrompt } from "./h3-official-prompt";

interface StudioToolEnv {
  KREA2_ACTIONS_URL?: string;
  H3_COMFY_URL?: string;
  H3_COMFY_TOKEN?: string;
  DZMM_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  DZMM_BASE_URL?: string;
  OPENROUTER_BASE_URL?: string;
  GEMINI_PROMPT_MODEL?: string;
  DZMM_MODEL?: string;
  CANVAS_AGENT_API_KEY?: string;
  CANVAS_AGENT_BASE_URL?: string;
  CANVAS_AGENT_MODEL?: string;
  SEALION_API_KEY?: string;
  SEALION_BASE_URL?: string;
  GLM_API_KEY?: string;
  GLM_BASE_URL?: string;
}

/** Internal tool entrypoint. Public HTTP on xumengchat.top does not reach this class. */
export class StudioToolService extends WorkerEntrypoint<StudioToolEnv> {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST") return json({ error: "请求方法不支持。" }, 405);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "请求格式无效。" }, 400);
    }
    const record = body && typeof body === "object" ? body as { prompt?: unknown; image?: unknown; images?: unknown; videos?: unknown; audios?: unknown; labels?: unknown; seconds?: unknown; ratio?: unknown; mode?: unknown; nodes?: unknown; session?: unknown; dryRun?: unknown; edges?: unknown; observations?: unknown; step?: unknown; tools?: unknown; toolNames?: unknown; memory?: unknown; model?: unknown } : {};
    const prompt = typeof record.prompt === "string" ? record.prompt : "";
    const image = typeof record.image === "string" ? record.image : "";
    const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    if (path === "/image") {
      const ratio = typeof record.ratio === "string" ? record.ratio : undefined;
      return renderKrea2Still(this.env.KREA2_ACTIONS_URL ?? "", {
        templateId: "krea2-free",
        prompt,
        image,
        style: "photo",
        ...(ratio ? { ratio } : {}),
      }, fetch, "", { textOnly: true });
    }
    if (path === "/video") {
      const seconds = typeof record.seconds === "number" ? record.seconds : undefined;
      const ratio = typeof record.ratio === "string" ? record.ratio : undefined;
      const frame = h3CanvasSize(ratio);
      if (!frame) return json({ error: "画面比例需要是 9:16、3:4、1:1、4:3 或 16:9。" }, 400);
      return runH3CanvasVideo({
        base: this.env.H3_COMFY_URL ?? "",
        token: this.env.H3_COMFY_TOKEN ?? "",
        prompt,
        image,
        images: list(record.images),
        videos: list(record.videos),
        audios: list(record.audios),
        labels: list(record.labels),
        ...(seconds === undefined ? {} : { seconds }),
        ...(ratio === undefined ? {} : { ratio }),
        rewrite: (source, references) => writeH3OfficialPrompt(this.env, source, references, {
          seconds: seconds ?? 5,
          width: frame.width,
          height: frame.height,
        }),
      });
    }
    if (path === "/prompt") return writeGeminiImagePrompt(this.env, prompt, image);
    if (path === "/agent") {
      const mode = typeof record.mode === "string" ? record.mode : "";
      const nodes = Array.isArray(record.nodes) ? record.nodes.flatMap((item): CanvasAgentNode[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const row = item as { id?: unknown; type?: unknown; name?: unknown; hasMedia?: unknown; prompt?: unknown; x?: unknown; y?: unknown };
        if (typeof row.id !== "string" || typeof row.type !== "string") return [];
        const x = typeof row.x === "number" && Number.isFinite(row.x) ? row.x : undefined;
        const y = typeof row.y === "number" && Number.isFinite(row.y) ? row.y : undefined;
        return [{
          id: row.id,
          type: row.type,
          name: typeof row.name === "string" ? row.name : "",
          hasMedia: row.hasMedia === true,
          ...(typeof row.prompt === "string" && row.prompt ? { prompt: row.prompt } : {}),
          ...(x !== undefined && y !== undefined ? { x, y } : {}),
        }];
      }) : [];
      return writeCanvasAgent(this.env, prompt, mode, nodes, fetch, {
        session: record.session,
        dryRun: record.dryRun !== false,
        edges: record.edges,
        observations: record.observations,
        step: record.step,
        tools: record.tools,
        toolNames: record.toolNames,
        memory: record.memory,
        model: record.model,
      });
    }
    return json({ error: "接口不存在。" }, 404);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
