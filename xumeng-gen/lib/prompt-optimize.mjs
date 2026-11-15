const MODEL = "sealion-nova-pro";
const HOST = "open-sealion.aiaigirl.com";
const BLOCKED = /未成年|幼态|幼女|幼童|萝莉|正太|小学生|初中生|高中生|校服|学生服|学生妹|loli|shota|underage|\bchild\b|\bteen\b|真人照片|真人脸|本人照片|明星脸|公众人物|real person|real photo/i;

export const VIDEO_OPTIMIZE_SYSTEM = [
  "你是图生视频提示词编辑。把用户的想法改成一条中文分镜，让视频模型能按句执行。",
  "只输出提示词，不要解释，不要加引号。",
  "固定用这六行，每行一句：",
  "人物：虚构的成年角色，写明二十一岁以上、性别、体态，以及身上还穿着或已经脱掉的衣服。",
  "动作：按时间写身体动作。成人之间的亲吻、抚摸、脱衣、体位、抽插和节奏要写具体，不要改成隐喻。",
  "身体：只写画面里在场的人的性器官。只有女性时写阴唇、阴道、乳房、乳头、臀部和肛门，不要写阴茎、阴囊，也不要写阴蒂。只有男性时写阴茎、阴囊、臀部和肛门。男女都在才按接触写出双方的器官，仍然不要写阴蒂。写清状态和接触，不要用「那里」「下面」代替，也不要打码。",
  "镜头：景别、机位和运动。",
  "场景：地点和光线。",
  "声音：环境声、衣料、呼吸和身体接触的声音。",
  "画面：清晰，不要马赛克。",
  "保留用户指定的人物关系和动作，只把句子补细。",
  "不要写未成年、幼态、校服、学生、真实人物或明星。",
  "总长度不超过600个字。",
].join("");

export const CHARACTER_OPTIMIZE_SYSTEM = [
  "你是小说人物设定编辑。把用户的想法写成给小说模型用的人物设定。",
  "只输出设定，不要解释，不要加引号。",
  "固定用这四行，每行一句：",
  "身份：虚构的成年人，写明二十一岁以上、姓名、性别和身份。",
  "外貌：体态、五官和衣着。",
  "性格：脾气和说话方式。",
  "关系：和故事里其他人的关系。若原句有成人亲密关系，把欲望和身体接触写具体，不要改成隐喻。",
  "保留用户指定的人物，只把句子补细。",
  "不要写未成年、幼态、校服、学生、真实人物或明星。",
  "总长度不超过600个字。",
].join("");

export function cleanOptimizedPrompt(value) {
  return String(value || "")
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/^["“]|["”]$/g, "")
    .split("\n")
    .map(line => line.replace(/[\u0000-\u001f]/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, 800);
}

function replyText(payload) {
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : "";
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map(part => typeof part?.text === "string" ? part.text : "").join("").trim();
}

export async function optimizeVideoPrompt(text, options = {}) {
  return optimizePrompt(text, { ...options, kind: "video" });
}

export async function optimizePrompt(text, options = {}) {
  const kind = options.kind === "character" ? "character" : "video";
  const source = String(text || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
  if (BLOCKED.test(source)) return { ok: false, error: "不能优化这段描述。" };
  const env = options.env || process.env;
  const apiKey = String(env.SEALION_API_KEY || "").trim();
  const baseUrl = String(env.SEALION_BASE_URL || `https://${HOST}/v1`).trim().replace(/\/+$/, "");
  if (!apiKey) return { ok: false, error: "提示词优化还没配上。" };
  let endpoint;
  try { endpoint = new URL(`${baseUrl}/chat/completions`); } catch { return { ok: false, error: "提示词优化地址无效。" }; }
  if (endpoint.protocol !== "https:" || endpoint.hostname !== HOST) return { ok: false, error: "提示词优化地址无效。" };
  const fetchImpl = options.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: kind === "character" ? CHARACTER_OPTIMIZE_SYSTEM : VIDEO_OPTIMIZE_SYSTEM },
          { role: "user", content: source ? `用户原句：${source}` : (kind === "character" ? "用户还没有写人物。写一个虚构的二十一岁以上成年人。" : "用户还没有写内容。写一条虚构的成年人性爱镜头，地点在室内。") },
        ],
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    return { ok: false, error: "提示词没有优化完。" };
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: "提示词没有优化完。" };
  const cleaned = cleanOptimizedPrompt(replyText(payload));
  const prompt = kind === "video" ? withNoMosaic(omitAbsentOrgans(cleaned, source)) : cleaned;
  if (prompt.length < 5 || BLOCKED.test(prompt)) return { ok: false, error: "提示词没有优化完。" };
  return { ok: true, prompt };
}

export function omitAbsentOrgans(prompt, source) {
  const cast = `${source}\n${String(prompt || "").replace(/阴茎|阴囊|阴唇|阴道|阴蒂|乳房|乳头/g, "")}`;
  const male = /男|他|丈夫|男友|男人/.test(cast);
  const female = /女|她|妻子|女友|女人/.test(cast);
  let next = String(prompt || "");
  if (female && !male) next = next.replace(/阴茎|阴囊/g, "");
  if (male && !female) next = next.replace(/阴唇|阴道|乳房|乳头/g, "");
  next = next.replace(/阴蒂/g, "");
  return next
    .replace(/[，、]{2,}/g, "，")
    .replace(/，([。\n])/g, "$1")
    .replace(/：，/g, "：")
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function withNoMosaic(prompt) {
  if (!prompt || prompt.includes("不要马赛克")) return prompt;
  return `${prompt}\n画面：清晰，不要马赛克。`.slice(0, 800);
}
