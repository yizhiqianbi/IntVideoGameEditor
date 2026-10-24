import { parseDzmmWorldState, type DzmmWorldState } from "./dzmm-world-state";

export const WORLD_OPEN = "<qingyu-state>";
export const WORLD_CLOSE = "</qingyu-state>";

/** Keeps marker fragments and the entire metadata tail out of visible streamed prose. */
export function createDzmmWorldTailFilter() {
  let buffer = "", metadata = "", hidden = false, ended = false, invalid = false;
  return {
    push(text: string): string {
      if (ended) { if (text.trim()) invalid = true; return ""; }
      if (hidden) {
        metadata += text;
        if (metadata.length > 16000) { invalid = true; metadata = ""; ended = true; return ""; }
        const close = metadata.indexOf(WORLD_CLOSE);
        if (close >= 0) {
          if (metadata.slice(close + WORLD_CLOSE.length).trim()) invalid = true;
          metadata = metadata.slice(0, close); ended = true;
        }
        return "";
      }
      buffer += text;
      const start = buffer.indexOf(WORLD_OPEN);
      if (start >= 0) {
        const visible = buffer.slice(0, start);
        const rest = buffer.slice(start + WORLD_OPEN.length);
        buffer = ""; hidden = true; this.push(rest);
        return visible;
      }
      let keep = 0;
      for (let length = 1; length < WORLD_OPEN.length; length++) {
        if (buffer.endsWith(WORLD_OPEN.slice(0, length))) keep = length;
      }
      const visible = buffer.slice(0, buffer.length - keep);
      buffer = buffer.slice(buffer.length - keep);
      return visible;
    },
    finish(): string {
      // An incomplete opening marker is protocol debris, not part of the story.
      buffer = "";
      if (!ended && hidden) invalid = true;
      return "";
    },
    proposal(): unknown {
      if (!hidden || !ended || invalid) return undefined;
      try { return JSON.parse(metadata); } catch { return undefined; }
    },
  };
}

export type DzmmWorldStreamResult = { state: DzmmWorldState; recordedAt: number; updated: boolean };
export function encodeDzmmWorldEvent(event: unknown): string { return `data: ${JSON.stringify(event)}\n\n`; }

/** A completed transport is required before committing its optional state snapshot. */
export async function readDzmmWorldResponse(response: Response, onText: (answer: string) => void): Promise<{
  answer: string; world?: DzmmWorldStreamResult;
}> {
  if (!response.body) throw new Error("模型没有返回可读取的回复。");
  const framed = response.headers.get("Content-Type")?.includes("text/event-stream");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let answer = "", buffer = "", done = false;
  let world: DzmmWorldStreamResult | undefined;
  function accept(raw: string) {
    if (!raw.trim()) return;
    if (!raw.startsWith("data: ") || done) throw new Error("剧情回复格式无效。");
    const event = JSON.parse(raw.slice(6));
    if (!event || typeof event !== "object") throw new Error("剧情回复格式无效。");
    if (event.type === "text" && typeof event.text === "string" && !world) {
      if (answer.length + event.text.length > 12000) throw new Error("回复超出长度限制。");
      answer += event.text; onText(answer);
    } else if (event.type === "world" && !world && typeof event.updated === "boolean"
      && Number.isSafeInteger(event.recordedAt) && event.recordedAt >= 0 && event.recordedAt <= 8_640_000_000_000_000) {
      world = { state: parseDzmmWorldState(event.state), recordedAt: event.recordedAt, updated: event.updated };
    } else if (event.type === "done") done = true;
    else if (event.type === "error") throw new Error(typeof event.message === "string" ? event.message : "回复中断，请重试。");
    else throw new Error("剧情回复格式无效。");
  }
  function ingest(text: string) {
    if (!framed) {
      if (answer.length + text.length > 12000) throw new Error("回复超出长度限制。");
      answer += text; onText(answer); return;
    }
    buffer += text;
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end < 0) break;
      const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (frame.length > 24000) throw new Error("剧情状态过长。");
      accept(frame);
    }
    if (buffer.length > 24000) throw new Error("剧情状态过长。");
  }
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      ingest(decoder.decode(part.value, { stream: true }));
    }
    ingest(decoder.decode());
    if (framed && (!done || buffer.trim())) throw new Error("回复未完整接收。");
    if (!answer.trim()) throw new Error("模型返回了空回复，请重试。");
    return { answer, ...(world ? { world } : {}) };
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
