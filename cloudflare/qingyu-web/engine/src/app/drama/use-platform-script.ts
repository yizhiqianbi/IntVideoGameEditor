"use client";
import { useEffect, useRef, useState } from "react";
import { DRAMA_DIRECTION } from "@/lib/drama-direction";
import { scriptTone } from "@/lib/drama-script";
import { completionText, normalizeScriptDocument, parseScriptJson } from "@/lib/drama-script-parse";
const CHANNEL = "framecraft:storyboard:v1";
const PARENTS = new Set(["https://framecraftai.com", "https://www.framecraftai.com", "https://framecraft-storyboard.vercel.app"]);
type Model = { id: string; name: string; availability?: "region_restricted"; billing?: { inputUsdPerMillion: number; outputUsdPerMillion: number } };

export function usePlatformScript() {
  const [embedded, setEmbedded] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const peer = useRef<{ origin: string; id: string } | null>(null);
  const pending = useRef<{ id: string; resolve: (value: unknown) => void; reject: (error: Error) => void } | null>(null);
  useEffect(() => {
    const isEmbed = new URLSearchParams(window.location.search).get("embed") === "framecraft";
    setEmbedded(isEmbed);
    if (!isEmbed || window.parent === window) return;
    let origin: string;
    try { origin = new URL(document.referrer).origin; } catch { return; }
    if (!PARENTS.has(origin)) return;
    const id = crypto.randomUUID();
    peer.current = { origin, id };
    let ready = false;
    const listen = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== origin || event.data?.channel !== CHANNEL || event.data?.bridgeId !== id) return;
      const data = event.data;
      if (data.type === "config" && Array.isArray(data.models)) {
        ready = true;
        setModels(data.models.filter((m: Model) => typeof m.id === "string" && typeof m.name === "string"));
      }
      if (data.type === "result" && data.id === pending.current?.id) {
        if (typeof data.error === "string") pending.current?.reject(new Error(data.error));
        else pending.current?.resolve(data.result);
        pending.current = null;
      }
    };
    const hello = () => window.parent.postMessage({ channel: CHANNEL, type: "hello", bridgeId: id }, origin);
    window.addEventListener("message", listen);
    hello();
    const timer = window.setInterval(() => { if (!ready) hello(); }, 1500);
    return () => {
      window.clearInterval(timer); window.removeEventListener("message", listen);
      pending.current?.reject(new Error("会话已结束")); pending.current = null; peer.current = null;
    };
  }, []);
  async function generate(input: { story: string; model: string; tone: string; assets: unknown[] }) {
    if (!peer.current || !models.some(m => m.id === input.model && !m.availability)) throw new Error("该模型暂不可用，请选择其他平台模型。");
    if (pending.current) throw new Error("已有剧本任务进行中。");
    const userContent = input.story + "\n已有角色与场景设定：" + JSON.stringify(input.assets.slice(0, 20)).slice(0, 6500)
      + "\n只返回一个完整JSON对象，键名必须是 title、assets、shots。生成3–6个镜头；shots每项必须有action或动作。不要markdown，不要截断JSON。";
    const request = { channel: CHANNEL, type: "complete", bridgeId: peer.current.id, id: crypto.randomUUID(), model: input.model,
      messages: [{ role: "system", content: DRAMA_DIRECTION + "\n" + scriptTone(input.tone) }, { role: "user", content: userContent }] };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        pending.current = { id: request.id, resolve, reject };
        timer = setTimeout(() => { if (pending.current?.id === request.id) { pending.current = null; reject(new Error("剧本生成超时，请重试。")); } }, 135000);
        window.parent.postMessage(request, peer.current!.origin);
      });
      return normalizeScriptDocument(parseScriptJson(completionText(result)));
    } finally { clearTimeout(timer); }
  }
  return { embedded, models, generate };
}
