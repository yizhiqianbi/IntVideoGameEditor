import { parseScriptShot, type ShotPromptFields } from "./drama-prompt";

const SHOT_LIST_KEYS = [
  "shots",
  "storyboard",
  "storyboards",
  "scenes",
  "clips",
  "shot_list",
  "shotlist",
  "分镜",
  "镜头",
  "镜头列表",
];

const ASSET_LIST_KEYS = ["assets", "characters", "cast", "角色", "设定"];

const WRAP_KEYS = [
  "data",
  "result",
  "script",
  "output",
  "json",
  "response",
  "document",
  "payload",
];

const FIELD_ALIASES: Record<keyof ShotPromptFields, string[]> = {
  start: ["start", "起始", "opening"],
  action: [
    "action",
    "动作",
    "prompt",
    "description",
    "content",
    "desc",
    "描述",
    "正文",
    "text",
    "body",
  ],
  camera: ["camera", "镜头", "运镜"],
  setting: ["setting", "场景", "scene", "location"],
  sound: ["sound", "声音", "audio"],
  end: ["end", "结束", "closing"],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function lowerMap(root: Record<string, unknown>) {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(root))
    map.set(key.toLowerCase(), value);
  return map;
}

function lookup(root: Record<string, unknown>, keys: string[]) {
  const map = lowerMap(root);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(root, key)) return root[key];
    if (map.has(key.toLowerCase())) return map.get(key.toLowerCase());
  }
  return undefined;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value))
    return value.map(asText).filter(Boolean).join(" ").trim();
  const record = asRecord(value);
  if (!record) return "";
  return Object.values(record).map(asText).filter(Boolean).join(" ").trim();
}

function firstText(root: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const text = asText(lookup(root, [key]));
    if (text) return text;
  }
  return "";
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value) && value.length) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(repairJson(trimmed));
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch {
        /* ignore */
      }
    }
    if (trimmed) return [trimmed];
  }
  const record = asRecord(value);
  if (!record) return [];
  const values = Object.values(record);
  return values.length &&
    values.every((item) => asRecord(item) || typeof item === "string")
    ? values
    : [];
}

function firstArray(root: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const list = asList(lookup(root, [key]));
    if (list.length) return list;
  }
  return [];
}

function unwrapDocument(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { shots: value };
  const record = asRecord(value);
  if (!record) return {};
  for (const key of WRAP_KEYS) {
    const inner = lookup(record, [key]);
    if (Array.isArray(inner) && inner.length) return { ...record, shots: inner };
    const nested = asRecord(inner);
    if (
      nested &&
      (firstArray(nested, SHOT_LIST_KEYS).length || looksLikeShot(nested))
    )
      return { ...record, ...nested };
  }
  return record;
}

function looksLikeShot(value: unknown) {
  if (typeof value === "string" && value.trim()) return true;
  const root = asRecord(value);
  if (!root) return false;
  return Boolean(
    firstText(root, [
      ...FIELD_ALIASES.action,
      ...FIELD_ALIASES.start,
      ...FIELD_ALIASES.camera,
      "title",
      "name",
    ]),
  );
}

function repairJson(text: string) {
  return text.replace(/,\s*([}\]])/g, "$1");
}

function jsonCandidates(raw: string) {
  // Some OpenRouter/Grok responses include a UTF-8 BOM or zero-width
  // formatting characters before the JSON object. JSON.parse rejects those
  // characters even though the visible response starts with `{`.
  const trimmed = raw
    .replace(/^[\uFEFF\u200B-\u200D\u2060]+/, "")
    .trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const fenced = fence?.[1]?.trim() || "";
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const startObj = stripped.indexOf("{");
  const endObj = stripped.lastIndexOf("}");
  const startArr = stripped.indexOf("[");
  const endArr = stripped.lastIndexOf("]");
  return [
    fenced,
    repairJson(fenced),
    stripped,
    repairJson(stripped),
    startObj >= 0 && endObj > startObj
      ? stripped.slice(startObj, endObj + 1)
      : "",
    startObj >= 0 && endObj > startObj
      ? repairJson(stripped.slice(startObj, endObj + 1))
      : "",
    startArr >= 0 && endArr > startArr
      ? stripped.slice(startArr, endArr + 1)
      : "",
    startArr >= 0 && endArr > startArr
      ? repairJson(stripped.slice(startArr, endArr + 1))
      : "",
  ].filter(Boolean);
}

function partText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return asText(value);
  return asText(
    record.text ?? record.content ?? record.output_text ?? record.value,
  );
}

export function completionText(data: unknown) {
  const root = asRecord(data);
  const choice = asRecord(Array.isArray(root?.choices) ? root.choices[0] : null);
  const message = asRecord(choice?.message) || {};
  const parts: string[] = [];
  const push = (value: unknown) => {
    const text = partText(value);
    if (text) parts.push(text);
  };
  const content = message.content ?? choice?.text;
  if (Array.isArray(content)) content.forEach(push);
  else push(content);
  // The final answer and the model's internal draft are separate documents.
  // Appending reasoning can make valid JSON fail parsing and recover draft
  // examples as extra shots or even mistake character assets for shots.
  if (parts.length) return parts.join("\n").trim();
  push(message.reasoning);
  push(message.reasoning_content);
  return parts.join("\n").trim();
}

export function parseScriptJson(raw: string): Record<string, unknown> {
  for (const candidate of jsonCandidates(raw)) {
    try {
      const parsed = unwrapDocument(JSON.parse(candidate));
      if (Object.keys(parsed).length) return parsed;
    } catch {
      /* try next candidate / recover */
    }
  }
  const recovered = recoverTruncatedScript(raw);
  if (recovered) return recovered;
  throw new Error(
    "AI 拒绝生成该内容或返回格式无效（可能触发了模型的内容安全限制），请调整故事内容、降低风格（如切换为常规剧情）或更换模型后重试。",
  );
}

function recoverTruncatedScript(text: string): Record<string, unknown> | null {
  const shots: Record<string, unknown>[] = [];
  const shotStart = text.search(
    /"(?:shots|storyboard|storyboards|scenes|clips|shot_list|分镜|镜头列表)"\s*:/i,
  );
  if (shotStart < 0) return null;
  const bracket = text.indexOf("[", shotStart);
  if (bracket < 0) return null;
  const body = text.slice(bracket);
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const item = JSON.parse(repairJson(body.slice(start, i + 1)));
          if (asRecord(item)) shots.push(item);
        } catch {
          /* skip broken object */
        }
        start = -1;
      }
    }
  }
  return shots.length ? { shots } : null;
}

function flattenShot(raw: unknown): Record<string, unknown> | null {
  const root = asRecord(raw);
  if (!root) return null;
  const nested =
    asRecord(lookup(root, ["promptFields", "prompt_fields", "fields", "shot"])) ||
    {};
  return { ...nested, ...root };
}

export function normalizeScriptShot(raw: unknown, index: number) {
  if (typeof raw === "string" && raw.trim())
    return parseScriptShot({ action: raw.trim() }, index);
  const root = flattenShot(raw);
  if (!root) throw new Error("分镜描述格式无效");
  const fields: Record<string, string> = {};
  for (const [id, aliases] of Object.entries(FIELD_ALIASES)) {
    const text = firstText(root, aliases);
    if (text) fields[id] = text;
  }
  if (!fields.action) {
    const fallback = [
      fields.start,
      fields.camera,
      fields.setting,
      fields.sound,
      fields.end,
    ]
      .filter(Boolean)
      .join(" ");
    if (fallback) fields.action = fallback;
  }
  const title = firstText(root, ["title", "name", "镜头名"]);
  return parseScriptShot(
    {
      title: title || root.title,
      duration: lookup(root, ["duration", "seconds", "时长"]),
      ...fields,
      action: fields.action,
    },
    index,
  );
}

function normalizeAsset(raw: unknown) {
  const root = asRecord(raw);
  if (!root) return null;
  const title = firstText(root, ["title", "name", "名称"]);
  const description = firstText(root, [
    "description",
    "desc",
    "bio",
    "外观",
    "设定",
  ]);
  const kindRaw = firstText(root, ["kind", "type", "类型"]).toLowerCase();
  const kind =
    kindRaw === "scene" || kindRaw === "location" || kindRaw === "场景"
      ? "scene"
      : kindRaw === "reference" ||
          kindRaw === "character" ||
          kindRaw === "角色"
        ? "reference"
        : ["reference", "scene"].includes(String(root.kind))
          ? String(root.kind)
          : title
            ? "reference"
            : "";
  if (!title || !description || (kind !== "reference" && kind !== "scene"))
    return null;
  return {
    kind,
    title: title.slice(0, 120),
    description: description.slice(0, 2000),
  };
}

function collectShots(root: Record<string, unknown>) {
  const listed = firstArray(root, SHOT_LIST_KEYS);
  if (listed.length) return listed;
  if (looksLikeShot(root) && !firstArray(root, ASSET_LIST_KEYS).length)
    return [root];
  return [];
}

export function normalizeScriptDocument(raw: unknown) {
  const root = unwrapDocument(raw);
  const shots = collectShots(root)
    .slice(0, 12)
    .map((shot, index) => {
      try {
        return normalizeScriptShot(shot, index);
      } catch {
        return null;
      }
    })
    .filter((shot): shot is ReturnType<typeof parseScriptShot> => !!shot);
  if (!shots.length) throw new Error("剧本分镜格式无效，请重试");
  const assets = firstArray(root, ASSET_LIST_KEYS)
    .slice(0, 6)
    .map(normalizeAsset)
    .filter((asset): asset is NonNullable<typeof asset> => !!asset);
  const title = firstText(root, ["title", "name", "片名", "剧名"]);
  return {
    title: title || "未命名悬疑短剧",
    assets,
    shots,
  };
}
