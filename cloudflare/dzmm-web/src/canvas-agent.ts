const MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MODES = new Set(["全能创作", "剧本创编", "导演执导"]);

export interface CanvasAgentEnv {
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

export interface CanvasAgentNode {
  id: string;
  type: string;
  name: string;
  hasMedia: boolean;
  prompt?: string;
  x?: number;
  y?: number;
}

export interface CanvasAgentTurn {
  role: "user" | "assistant";
  text: string;
}

export interface CanvasAgentEdge {
  source: string;
  target: string;
}

export interface CanvasAgentObservation {
  tool: string;
  ok: boolean;
  note: string;
}

export interface CanvasAgentCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface CanvasAgentSource {
  url: string;
  title: string;
}

export interface CanvasAgentStep {
  text: string;
  calls: CanvasAgentCall[];
  done: boolean;
  sources?: CanvasAgentSource[];
  memory?: string;
}

export interface CanvasAgentExtra {
  session?: unknown;
  dryRun?: boolean;
  edges?: unknown;
  observations?: unknown;
  step?: unknown;
  tools?: unknown;
  toolNames?: unknown;
  memory?: unknown;
  model?: unknown;
}

const MAX_CALLS = 12;
const MAX_STEPS = 4;
const TOOL = /^[a-z_]{2,24}$/;
const SEALION_CHAT_BASE = "https://open-sealion.aiaigirl.com/v1";
const GLM_CHAT_BASE = "https://8888ai.cc.cd/v1";
const SEALION_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

/** Ids offered in the canvas agent. Provider strings stay server-side. */
const CANVAS_CHAT = {
  cydonia: { model: "thedrummer/cydonia-24b-v4.1", host: "openrouter" },
  venice: { model: "cognitivecomputations/dolphin-mistral-24b-venice-edition", host: "openrouter" },
  heretic: { model: "gemma4-26b-a4b-ultra-heretic", host: "sealion" },
  glm: { model: "glm-5.2", host: "glm" },
} as const;

type CanvasChatChoice = keyof typeof CANVAS_CHAT;

function canvasChatChoice(value: unknown): CanvasChatChoice | "" {
  const id = text(value, 32);
  return id in CANVAS_CHAT ? id as CanvasChatChoice : "";
}

function text(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function agentUsesOpenRouter(env: CanvasAgentEnv): boolean {
  const dedicated = text(env.CANVAS_AGENT_BASE_URL, 200);
  if (!dedicated) return true;
  try { return new URL(dedicated).hostname === "openrouter.ai"; }
  catch { return false; }
}

export function endpoint(env: CanvasAgentEnv): { url: string; key: string; model: string } | null {
  const shared = agentUsesOpenRouter(env);
  const key = text(env.OPENROUTER_API_KEY, 400) || text(env.DZMM_API_KEY, 400) || (shared ? text(env.CANVAS_AGENT_API_KEY, 400) : "");
  const model = shared ? text(env.CANVAS_AGENT_MODEL, 128) || "x-ai/grok-4.7" : "x-ai/grok-4.7";
  if (key.length < 20 || !MODEL.test(model)) return null;
  let root: URL;
  try { root = new URL(text(env.OPENROUTER_BASE_URL, 200) || text(env.DZMM_BASE_URL, 200) || "https://openrouter.ai/api/v1"); }
  catch { return null; }
  if (root.protocol !== "https:" || root.hostname !== "openrouter.ai") return null;
  return { url: `${root.href.replace(/\/+$/, "")}/chat/completions`, key, model };
}

function sealionRoot(env: CanvasAgentEnv): URL | null {
  try {
    const parsed = new URL(text(env.SEALION_BASE_URL, 200) || SEALION_CHAT_BASE);
    const path = parsed.pathname.replace(/\/$/, "");
    if (parsed.protocol !== "https:" || parsed.hostname !== "open-sealion.aiaigirl.com" || path !== "/v1") return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function glmRoot(env: CanvasAgentEnv): URL | null {
  try {
    const parsed = new URL(text(env.GLM_BASE_URL, 200) || GLM_CHAT_BASE);
    const path = parsed.pathname.replace(/\/$/, "");
    if (parsed.protocol !== "https:" || parsed.hostname !== "8888ai.cc.cd" || path !== "/v1") return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function openRouterRoot(env: CanvasAgentEnv): URL | null {
  try {
    const root = new URL(text(env.OPENROUTER_BASE_URL, 200) || text(env.DZMM_BASE_URL, 200) || "https://openrouter.ai/api/v1");
    return root.protocol === "https:" && root.hostname === "openrouter.ai" ? root : null;
  } catch {
    return null;
  }
}

export function agentEndpoint(env: CanvasAgentEnv, choice?: unknown): { url: string; key: string; model: string; openRouter: boolean; reasoning: boolean; direct: boolean } | null {
  const picked = canvasChatChoice(choice);
  if (picked) {
    const option = CANVAS_CHAT[picked];
    switch (option.host) {
      case "glm": {
        const root = glmRoot(env);
        const key = text(env.GLM_API_KEY, 400);
        if (!root || key.length < 20 || !MODEL.test(option.model)) return null;
        return { url: `${root.href.replace(/\/+$/, "")}/chat/completions`, key, model: option.model, openRouter: false, reasoning: false, direct: true };
      }
      case "sealion": {
        const root = sealionRoot(env);
        const key = text(env.SEALION_API_KEY, 400);
        if (!root || key.length < 20 || !MODEL.test(option.model)) return null;
        return { url: `${root.href.replace(/\/+$/, "")}/chat/completions`, key, model: option.model, openRouter: false, reasoning: false, direct: true };
      }
      case "openrouter": {
        const root = openRouterRoot(env);
        const key = text(env.OPENROUTER_API_KEY, 400) || text(env.DZMM_API_KEY, 400) || text(env.CANVAS_AGENT_API_KEY, 400);
        if (!root || key.length < 20 || !MODEL.test(option.model)) return null;
        return { url: `${root.href.replace(/\/+$/, "")}/chat/completions`, key, model: option.model, openRouter: true, reasoning: false, direct: false };
      }
      default: {
        const unreachable: never = option;
        return unreachable;
      }
    }
  }
  const dedicated = text(env.CANVAS_AGENT_BASE_URL, 200);
  const model = text(env.CANVAS_AGENT_MODEL, 128) || "x-ai/grok-4.7";
  if (!MODEL.test(model)) return null;
  let root: URL;
  try { root = new URL(dedicated || text(env.OPENROUTER_BASE_URL, 200) || text(env.DZMM_BASE_URL, 200) || "https://openrouter.ai/api/v1"); }
  catch { return null; }
  if (root.protocol !== "https:" || (root.hostname !== "openrouter.ai" && root.hostname !== "www.whatstoken.ai")) return null;
  const openRouter = root.hostname === "openrouter.ai";
  const key = openRouter
    ? text(env.OPENROUTER_API_KEY, 400) || text(env.DZMM_API_KEY, 400) || text(env.CANVAS_AGENT_API_KEY, 400)
    : text(env.CANVAS_AGENT_API_KEY, 400);
  if (key.length < 20) return null;
  return {
    url: `${root.href.replace(/\/+$/, "")}/chat/completions`,
    key,
    model,
    openRouter,
    reasoning: openRouter,
    direct: false,
  };
}

export function messageText(payload: unknown): string {
  const choice = payload && typeof payload === "object"
    ? (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content
    : "";
  const raw = typeof choice === "string"
    ? choice
    : Array.isArray(choice)
      ? choice.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("")
      : "";
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function failureText(status: number, detail = ""): string {
  if (/not available in your region|unsupported_country|region/i.test(detail)) return "创作助手在当前地区不可用。";
  if (status === 401 || status === 403) return "创作助手鉴权失败。";
  if (status === 402) return "创作助手额度不足。";
  if (status === 429) return "创作助手暂时繁忙。";
  if (status === 400 || status === 404 || status === 422) return "创作助手没有接受这次请求。";
  return "创作助手暂时连不上。";
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

const SESSION_TURNS = 40;
const SESSION_TURN_CHARS = 1600;
const SESSION_BUDGET = 12_000;

export function readSession(value: unknown): CanvasAgentTurn[] {
  const source = Array.isArray(value) ? value : [];
  const recent: CanvasAgentTurn[] = [];
  for (let index = source.length - 1; index >= 0 && recent.length < SESSION_TURNS; index -= 1) {
    const item = source[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as { role?: unknown; text?: unknown };
    const role = row.role === "user" || row.role === "assistant" ? row.role : "";
    const line = text(row.text, SESSION_TURN_CHARS);
    if (!role || !line) continue;
    recent.push({ role, text: line });
  }
  recent.reverse();
  const kept: CanvasAgentTurn[] = [];
  let used = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (kept.length && used + recent[index].text.length > SESSION_BUDGET) break;
    kept.push(recent[index]);
    used += recent[index].text.length;
  }
  return kept.reverse();
}

export function readMemory(value: unknown): string {
  return text(value, 2000);
}

function readList<T>(value: unknown, max: number, read: (row: Record<string, unknown>) => T | null): T[] {
  const rows: T[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (rows.length >= max) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = read(item as Record<string, unknown>);
    if (row) rows.push(row);
  }
  return rows;
}

export function readToolNames(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).filter((name): name is string => typeof name === "string" && TOOL.test(name)))].slice(0, 24);
}

function readEdges(value: unknown, known: Set<string>): CanvasAgentEdge[] {
  return readList(value, 60, (row) =>
    typeof row.source === "string" && typeof row.target === "string" && known.has(row.source) && known.has(row.target)
      ? { source: row.source, target: row.target }
      : null);
}

function readObservations(value: unknown): CanvasAgentObservation[] {
  return readList(value, 24, (row) => {
    const tool = typeof row.tool === "string" && TOOL.test(row.tool) ? row.tool : "";
    const note = text(row.note, 300);
    return tool && note ? { tool, ok: row.ok === true, note } : null;
  });
}

function messageSources(payload: unknown): CanvasAgentSource[] {
  const annotations = payload && typeof payload === "object"
    ? (payload as { choices?: { message?: { annotations?: unknown } }[] }).choices?.[0]?.message?.annotations
    : null;
  const seen = new Set<string>();
  return readList(annotations, 12, (row) => {
    const citation = row.url_citation && typeof row.url_citation === "object" ? row.url_citation as { url?: unknown; title?: unknown } : null;
    const url = typeof citation?.url === "string" && /^https:\/\//i.test(citation.url) ? citation.url.slice(0, 2000) : "";
    if (!url || seen.has(url)) return null;
    seen.add(url);
    return { url, title: text(citation?.title, 80) };
  }).slice(0, 6);
}

function jsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

/** One director step: tool calls the canvas will run, and whether more steps are needed. */
export function readCanvasAgentPlan(raw: string, toolNames: string[]): CanvasAgentStep | null {
  const parsed = jsonObject(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as { text?: unknown; calls?: unknown; done?: unknown; memory?: unknown };
  const allowed = new Set(toolNames);
  const calls = readList(record.calls, MAX_CALLS, (row) => {
    const tool = typeof row.tool === "string" && allowed.has(row.tool) ? row.tool : "";
    const { tool: _tool, args: nested, ...flat } = row;
    const args = nested && typeof nested === "object" && !Array.isArray(nested) ? nested as Record<string, unknown> : flat;
    return tool && JSON.stringify(args).length <= 8000 ? { tool, args } : null;
  });
  const reply = text(record.text, 1000) || (calls.length ? "我先在画布上动手。" : "");
  if (!reply) return null;
  const memory = text(record.memory, 2000);
  return { text: reply, calls, done: record.done !== false || !calls.length, ...(memory ? { memory } : {}) };
}

function instruction(
  mode: string,
  nodes: CanvasAgentNode[],
  edges: CanvasAgentEdge[],
  memory: string,
  observations: CanvasAgentObservation[],
  step: number,
  tools: string,
  dryRun: boolean,
): string {
  const names = new Map(nodes.map((node) => [node.id, node.name || node.id]));
  const listed = nodes.length
    ? nodes.map((node) => `- ${node.id} ${node.name || "未命名"} ${node.type}${node.hasMedia ? " 已有素材" : " 还没有素材"}${typeof node.x === "number" ? ` 位置 ${node.x},${node.y}` : ""}${node.prompt ? ` 提示词 ${node.prompt}` : ""}`).join("\n")
    : "（画布上还没有节点）";
  const wired = edges.length
    ? edges.map((edge) => `- ${names.get(edge.source)} → ${names.get(edge.target)}`).join("\n")
    : "（没有连线）";
  const guide = mode === "剧本创编"
    ? "剧本创编：以 script、characters、update 为主。用户没要分镜时不排分镜。"
    : mode === "导演执导"
      ? "导演执导：以 storyboard、characters、connect 为主，把参考接好，让每个镜头都能直接生成。"
      : "全能创作：可以从剧本一路排到分镜。";
  const rows = [
    "你是画布上的短剧导演。用下面的工具在画布上完成用户的话。",
    "只输出一个 JSON 对象，不要 Markdown：",
    '{"text":"给用户看的话，一两句","calls":[{"tool":"工具名","args":{}}],"done":true,"memory":"要记住的角色、题材和已定决定。没有新内容就省略 memory"}',
    "工具：",
    tools,
    "规则：",
    `- 一步最多 ${MAX_CALLS} 个调用，按顺序执行。需要看执行结果再继续时 done=false；做完了 done=true。最多 ${MAX_STEPS} 步。`,
    "- 每个调用的参数都放进 args 对象里。",
    "- id 只能用下面列出的节点，或本步 as 起的别名（写成 $别名）。不要编造 id。",
    "- 只是聊天时 calls 为空，done=true。",
    "- 前面的对话和项目记忆都算数。角色外形、题材、用户已经定过的事要沿用，不要重新问。",
    "- memory 写这个项目目前该记住的全部内容，覆盖旧记忆。这轮没有新的长期内容就不要写 memory。",
    "- 方向不清楚、会大改画布时，先用 ask 问一个问题。",
    "- 用户要改已有节点时用 update、connect、move，不要为了同一件事新建节点。",
    "- 提示词写成可以直接出图或出视频的画面描述：主体、动作、场景、光线、镜头。角色外形每次原样写全，保证前后一致。",
    "- 用户没明确要出图或出视频，不调用 generate。",
    "- 需要网上资料、真实人物或现成的梗图时，先联网搜索，再用 import_image 导入图片地址或网页地址。不要说自己不能联网。",
    "- 网图只当参考，导入后在 text 里提醒用户注意版权。",
    "- 出图可以不接参考：没有参考图就按提示词直接文字出图；要保持角色长相一致时，把角色图连到出图节点。出视频要接图片或视频；没有素材时先排一张关键帧图，再把它连到视频节点。",
    "- 用户要做一条视频时，一步做完：script 写剧本（as 起别名）→ characters 放主要角色（as 用角色名）→ storyboard 用 video:true 排 2 到 4 镜，每镜 refs 接出场角色的别名 → generate 只列 $shot1_video、$shot2_video 这些视频节点，done=true。上游的角色图和关键帧图会自动先生成。",
    "- 竖屏短视频，每镜约 5 秒。frame 写这一镜的静态画面，包含角色外形；motion 写这 5 秒里的动作、表情和运镜，不写镜头切换。",
    "- 写剧本用编剧法：先定一句话前提，写清谁想要什么、被什么挡住；每一镜都要有价值转折（希望变失望、陌生变亲近），晚进早出，从事情已经发生的地方切进去。",
    "- 情绪用看得见的动作和道具外化，不写抽象心理。对白就是行动，短句、带潜台词，每镜最多一两句，写进 motion 时用引号标出说话人。",
    "- 第一镜要有钩子，最后一镜留反转或悬念。角色外形在 characters 和每镜 frame 里写全写一致：年龄、发型、服装、标志道具。",
    dryRun ? "- 当前是手动生成：generate 会等用户点确认。" : "- 当前是自动生成：generate 会直接开始。",
    `当前模式：${mode}。${guide}`,
    "项目记忆：",
    memory || "（还没有）",
    "现有节点：",
    listed,
    "连线：",
    wired,
  ];
  if (step > 0) {
    rows.push(
      `这是第 ${step + 1} 步。上一步结果：`,
      observations.length ? observations.map((item) => `- ${item.ok ? "完成" : "失败"} ${item.tool}：${item.note}`).join("\n") : "（没有结果）",
      "根据结果继续完成用户的话。失败的调用换个办法补上；补不上就在 text 里如实告诉用户。不要说没做成的事已经做好。",
    );
  }
  return rows.join("\n");
}

export async function writeCanvasAgent(
  env: CanvasAgentEnv,
  prompt: string,
  mode: string,
  nodes: CanvasAgentNode[],
  fetchImpl: typeof fetch = fetch,
  extra: CanvasAgentExtra = {},
): Promise<Response> {
  const request = text(prompt);
  if (!request) return jsonResponse({ error: "请先写创作想法。" }, 400);
  const choice = canvasChatChoice(extra.model);
  const upstream = agentEndpoint(env, choice);
  if (!upstream) return jsonResponse({ error: choice ? "这个模型还没接上。" : "创作助手还没接上。" }, 503);
  const known = nodes.filter((node) => ID.test(node.id)).slice(0, 40);
  const session = readSession(extra.session);
  const memory = readMemory(extra.memory);
  const dryRun = extra.dryRun !== false;
  const toolNames = readToolNames(extra.toolNames);
  const tools = typeof extra.tools === "string" ? extra.tools.slice(0, 8000) : "";
  if (!toolNames.length || !tools) return jsonResponse({ error: "创作助手的工具还没接上。" }, 400);
  const ids = new Set(known.map((node) => node.id));
  const edges = readEdges(extra.edges, ids);
  const observations = readObservations(extra.observations);
  const step = typeof extra.step === "number" && Number.isInteger(extra.step) ? Math.max(0, Math.min(MAX_STEPS - 1, extra.step)) : 0;
  const messages = [
    { role: "system", content: instruction(MODES.has(mode) ? mode : "全能创作", known, edges, memory, observations, step, tools, dryRun) },
    ...session.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: request },
  ];
  let response: Response;
  try {
    response = await fetchImpl(upstream.url, {
      method: "POST",
      headers: upstream.direct ? {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${upstream.key}`,
        "User-Agent": SEALION_AGENT,
      } : {
        "Content-Type": "application/json",
        Authorization: `Bearer ${upstream.key}`,
        "X-Title": "Xumeng canvas agent",
      },
      body: JSON.stringify(upstream.openRouter ? {
        model: upstream.model,
        temperature: 0.4,
        max_tokens: 2400,
        ...(upstream.reasoning ? { reasoning: { effort: "low" as const } } : {}),
        tools: [{ type: "openrouter:web_search", parameters: { max_results: 5, max_uses: 2 } }],
        max_tool_calls: 2,
        messages,
      } : {
        model: upstream.model,
        temperature: 0.4,
        max_tokens: 6000,
        messages,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(100_000),
    });
  } catch {
    return jsonResponse({ error: "创作助手暂时连不上。" }, 503);
  }
  if (response.status >= 300 && response.status < 400) return jsonResponse({ error: "创作助手暂时连不上。" }, 503);
  const payload = await response.json().catch(() => null);
  const written = messageText(payload);
  if (!response.ok || !written) {
    const detail = payload && typeof payload === "object"
      ? text((payload as { error?: { message?: unknown } }).error?.message, 180).replace(/sk-[A-Za-z0-9_-]+/g, "")
      : "";
    return jsonResponse({ error: failureText(response.status, detail) }, response.status === 429 ? 429 : 502);
  }
  const plan = readCanvasAgentPlan(written, toolNames)
    ?? { text: text(written, 1000), calls: [], done: true };
  return jsonResponse({ ...plan, sources: messageSources(payload) });
}
