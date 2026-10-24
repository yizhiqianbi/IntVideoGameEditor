import { DRAMA_DIRECTION } from "@/lib/drama-direction";
import {
  completionText,
  normalizeScriptDocument,
  parseScriptJson,
} from "@/lib/drama-script-parse";
import { NextResponse } from "next/server";
import { scriptConnection, scriptTone } from "@/lib/drama-script";
export const maxDuration = 180;

class ScriptRefusalError extends Error {}

async function requestScript(
  connection: ReturnType<typeof scriptConnection>,
  systemPrompt: string,
  userContent: string,
  timeoutMs: number,
) {
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: connection.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 32768,
      temperature: 0.7,
    }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message || "剧本服务请求失败");
  const raw = completionText(data);
  if (!raw) throw new Error("剧本服务未返回文本");
  let parsed: Record<string, unknown>;
  try {
    parsed = parseScriptJson(raw);
  } catch (error) {
    console.error("剧本模型未返回有效 JSON：", raw.slice(0, 500));
    throw error instanceof Error
      ? new ScriptRefusalError(error.message)
      : new ScriptRefusalError("剧本分镜格式无效，请重试");
  }
  try {
    return normalizeScriptDocument(parsed);
  } catch (error) {
    console.error(
      "剧本分镜格式无效：",
      Object.keys(parsed),
      JSON.stringify(parsed).slice(0, 800),
    );
    throw error instanceof Error
      ? new ScriptRefusalError(error.message)
      : new ScriptRefusalError("剧本分镜格式无效，请重试");
  }
}
export async function POST(request: Request) {
  try {
    const b = await request.json();
    if (
      typeof b.story !== "string" ||
      !b.story.trim() ||
      b.story.length > 12000
    )
      return NextResponse.json(
        { error: "请输入 1–12000 字故事" },
        { status: 400 },
      );
    const tone = scriptTone(b.tone);
    const connection = scriptConnection(b, process.env);
    const userContent =
      b.story +
      (Array.isArray(b.assets)
        ? "\n已有角色与场景设定（用户资料）：" +
          JSON.stringify(b.assets.slice(0, 20)).slice(0, 16000)
        : "") +
      "\n只返回一个JSON对象，键名必须是 title、assets、shots；shots 每项必须有 action 或 动作；每镜要有明确的悬念或人物变化；对白是行动不要解说；不要markdown。字段写完整，不要为省字而截断 JSON。";
    const systemPrompt = DRAMA_DIRECTION + "\n" + tone;
    const deadline = Date.now() + 170000;
    let script: ReturnType<typeof normalizeScriptDocument>;
    try {
      script = await requestScript(
        connection,
        systemPrompt,
        userContent,
        Math.min(160000, deadline - Date.now()),
      );
    } catch (e) {
      if (!(e instanceof ScriptRefusalError)) throw e;
      const remaining = deadline - Date.now();
      if (remaining < 15000) throw e;
      script = await requestScript(connection, systemPrompt, userContent, remaining);
    }
    return NextResponse.json({
      ...script,
      model: connection.model,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "剧本生成失败" },
      { status: 502 },
    );
  }
}
