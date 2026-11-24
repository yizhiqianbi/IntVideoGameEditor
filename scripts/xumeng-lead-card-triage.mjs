#!/usr/bin/env node
/**
 * 叙梦 · 视频女主角角色卡 · 资产盘点与三分类
 *
 * 输入：视频频道 catalog（线上 URL，或本地 cloudflare/video-web/public/catalog.json）
 * 输出：
 *   summary.json      盘点与风险统计
 *   worklist.json/.csv 每部剧一行，状态 + 风险标记
 *   card-template.json 角色卡模板（占位）
 *   skeletons/*.json  前 N 部可做剧的空白卡骨架（人设字段留给关键帧/人工/模型填）
 *
 * 用法：
 *   node scripts/xumeng-lead-card-triage.mjs --out output/xumeng/lead-card-triage --skeletons 12
 *   node scripts/xumeng-lead-card-triage.mjs --catalog cloudflare/video-web/public/catalog.json
 *   node scripts/xumeng-lead-card-triage.mjs --validate output/xumeng/lead-card-triage/examples
 *
 * 边界：脚本只做盘点、分类、骨架和校验；不生成任何露骨内容，不抓取/分析视频画面，
 * 也不会把真人换脸/魔改条目放进可做清单。
 */

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const LIVE_CATALOG = "https://video.xumengchat.top/catalog.json";
const LOCAL_CATALOG = "cloudflare/video-web/public/catalog.json";
const DEFAULT_OUT = "output/xumeng/lead-card-triage";

/** 真人换脸/魔改：catalog 里的两个分类本身就是真人条目。 */
const REAL_PERSON_CATEGORIES = new Set(["AI换脸", "AI魔改"]);

/** 角色卡不能承接的题材（未成年、非自愿、乱伦）。只用于卡片筛选，不改动视频本身。 */
const RISK_PATTERNS = [
  ["minor", /(未成年|幼女|幼童|幼态|萝莉|正太|小学生|初中生|高中生|学生妹|学生|校服|童颜)/i],
  ["nonconsent", /(强奸|强暴|迷奸|轮奸|迷药|下药|偷拍|偷窥|猥亵|性侵|胁迫)/i],
  ["incest", /(乱伦|母子|父女|兄妹|姐弟|母女|嫂子|小姨子|岳母|公公|继父|继母)/i],
];

const REAL_PERSON_TITLE = /(AI换脸|AI魔改|真人|明星|女星|网红|粉丝|coser)/i;

/** 标题层面的露骨广告词。不直接判死，只作为编辑复审的降权信号。 */
const EXPLICIT_TITLE = /(无码|有码|内射|口爆|爆操|狂插|淫|裸|逼|鸡巴|做爱|性交|射精|骚|色情|情色|调教|口交|肛交|乱交|群交|3P|4P|啪啪|肉棒|肉穴|巨乳|爆乳|丰乳|翘臀|嫩穴|精液|高潮|发情|性奴|炮友|一夜情|AV|下海|援交|包养|卖淫|妓)/i;

/** 常见中文姓氏，用来从换脸标题里挑出人名候选，再回扫其它分类。 */
const SURNAMES = new Set("李王张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤");

const CARD_REQUIRED = ["name", "author", "description", "personality", "scenario", "systemPrompt", "firstMessage"];
const CARD_PROSE_FIELDS = ["description", "personality", "scenario", "systemPrompt", "postHistoryInstructions", "firstMessage", "messageExamples", "introduction"];

function parseArgs(argv) {
  const args = { catalog: "", out: DEFAULT_OUT, skeletons: 12, validate: "", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => argv[++i];
    if (token === "--catalog") args.catalog = next();
    else if (token === "--out") args.out = next();
    else if (token === "--skeletons") args.skeletons = Number(next()) || 0;
    else if (token === "--validate") args.validate = next();
    else if (token === "--json") args.json = true;
    else if (token === "--help" || token === "-h") {
      console.log("用法: node scripts/xumeng-lead-card-triage.mjs [--catalog URL|path] [--out dir] [--skeletons N] [--validate dir] [--json]");
      process.exit(0);
    }
  }
  return args;
}

async function loadCatalog(target) {
  const source = target || LIVE_CATALOG;
  if (/^https?:\/\//.test(source)) {
    try {
      const response = await fetch(source, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`catalog ${response.status}`);
      return { value: await response.json(), origin: source, live: true };
    } catch (error) {
      if (target) throw error;
      // 线上拉不到时退回仓库里的快照，并在 summary 里标明。
    }
  }
  const file = target && !/^https?:\/\//.test(target) ? target : (existsSync(LOCAL_CATALOG) ? LOCAL_CATALOG : "");
  if (!file) throw new Error("线上 catalog 不可用，且找不到本地快照，请用 --catalog 指定");
  return { value: JSON.parse(await readFile(file, "utf8")), origin: path.resolve(file), live: false };
}

const compact = (value) => String(value ?? "").replace(/\s+/gu, "").toLowerCase();

/** 把逐集 items 折叠成按剧（dramaId）一行。 */
function buildDramas(catalog) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const byDrama = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const dramaId = String(item.dramaId ?? "");
    if (!/^hg-\d{4,8}$/.test(dramaId)) continue;
    const title = String(item.title ?? "").trim();
    const episode = String(item.episode ?? "");
    const current = byDrama.get(dramaId) ?? {
      dramaId, title, categories: new Set(), episodes: [], posters: new Set(), sources: new Set(),
    };
    current.categories.add(String(item.category ?? "").trim());
    if (!current.title) current.title = title;
    current.posters.add(String(item.posterKey ?? ""));
    current.sources.add(String(item.source ?? ""));
    current.episodes.push({
      id: String(item.id ?? ""), episode,
      mediaKey: String(item.mediaKey ?? ""), posterKey: String(item.posterKey ?? ""),
      episodeNumber: Number((/ep-(\d{3})/.exec(String(item.mediaKey ?? "")) || [])[1] ?? 0),
    });
    byDrama.set(dramaId, current);
  }
  const dramas = [...byDrama.values()].map((drama) => ({
    ...drama,
    categories: [...drama.categories].filter(Boolean),
    posters: [...drama.posters].filter(Boolean),
    sources: [...drama.sources].filter(Boolean),
    episodes: drama.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber),
  }));
  return { dramas, episodeCount: items.length };
}

/**
 * 从真人换脸/魔改标题里提取人名候选，再回扫其它分类。
 * 只依赖 catalog 自身，不内置任何真人姓名表。
 */
function scanRealPersonNames(dramas) {
  const counts = new Map();
  for (const drama of dramas) {
    if (!drama.categories.some((category) => REAL_PERSON_CATEGORIES.has(category))) continue;
    const match = /^AI(?:换脸|魔改)\s*([\u4e00-\u9fa5]{2,4})/u.exec(drama.title);
    const name = match?.[1] ?? "";
    if (name.length >= 2 && SURNAMES.has(name[0])) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function classify(drama, nameCounts, titleOwners) {
  const flags = [];
  const reasons = [];
  const isRealPersonCategory = drama.categories.some((category) => REAL_PERSON_CATEGORIES.has(category));
  if (isRealPersonCategory) {
    flags.push("real_person_label");
    reasons.push("分类为 AI换脸/AI魔改，属于真人形象");
  }
  if (REAL_PERSON_TITLE.test(drama.title)) {
    flags.push("real_person_title");
    reasons.push("标题含真人/明星/换脸字样");
  }
  for (const [name, count] of nameCounts) {
    if (count < 1) continue;
    if (drama.title.includes(name)) {
      flags.push(`real_person_name:${name}`);
      reasons.push("标题含真人姓名（由换脸/魔改分类反推）");
      break;
    }
  }
  for (const [flag, pattern] of RISK_PATTERNS) {
    if (pattern.test(drama.title)) {
      flags.push(flag);
      reasons.push(`标题命中「${flag}」题材`);
    }
  }
  if (EXPLICIT_TITLE.test(drama.title)) {
    flags.push("explicit_title");
    reasons.push("标题含露骨广告词，需编辑降权/复审");
  }
  const duplicateOf = titleOwners.get(compact(drama.title))?.dramaId ?? "";
  if (duplicateOf && duplicateOf !== drama.dramaId) {
    flags.push("duplicate_title");
    reasons.push(`与 ${duplicateOf} 同名`);
  }
  const realPerson = flags.some((flag) => flag.startsWith("real_person"));
  const contentRisk = flags.some((flag) => ["minor", "nonconsent", "incest"].includes(flag));
  const status = realPerson ? "excluded_real_person"
    : contentRisk ? "excluded_content_risk"
      : duplicateOf && duplicateOf !== drama.dramaId ? "duplicate"
        : "eligible";
  return { status, flags, reasons };
}

function rankDramas(rows) {
  return [...rows].sort((a, b) => {
    const weight = (row) => (row.status === "eligible" ? 2 : row.status === "duplicate" ? 1 : 0);
    return weight(b) - weight(a) || b.episodeCount - a.episodeCount || a.title.localeCompare(b.title, "zh-Hans-CN");
  });
}

function skeletonFor(drama) {
  return {
    schema: "xumeng-video-lead-card/v1",
    source: {
      origin: "video",
      dramaId: drama.dramaId,
      workingTitle: drama.title,
      categories: drama.categories,
      episodeCount: drama.episodeCount,
      firstMediaKey: drama.episodes[0]?.mediaKey ?? "",
      posterKey: drama.posters[0] ?? "",
      posterUrl: drama.posters[0]
        ? `https://video.xumengchat.top/covers/${drama.posters[0].replace(/^posters\//, "")}?v=2`
        : "",
    },
    card: {
      name: "",
      author: "Xumeng Video Lead",
      tags: [],
      description: "",
      personality: "",
      scenario: "",
      systemPrompt: "",
      postHistoryInstructions: "",
      firstMessage: "",
      alternateGreetings: ["", "", ""],
      messageExamples: "",
      characterBook: { name: "", description: "", entries: [] },
      introduction: "",
      suggestedReplies: ["", "", ""],
    },
    appearanceAnchors: {
      coverFrame: "",
      faceCrop: "",
      hair: "",
      outfit: "",
      body: "",
      signature: "",
      voice: "",
    },
    rights: {
      source: drama.sources[0] ?? "",
      license: "unknown",
      realPerson: false,
      clearance: "pending",
      evidence: "",
    },
    spoilerPolicy: { maxEpisode: 1, noEnding: true },
    qa: { version: 1, status: "draft", reviewer: "", checkedAt: "", checklist: [] },
    _todo: [
      "抽关键帧：ffmpeg 每 2–3s 一帧 + 场景切换，拼 9 宫格",
      "确认女主：同一张脸在至少 3 个镜头出现；多人剧以首个主视角为准",
      "填 appearanceAnchors：发型/服装/体态/辨识特征/音色",
      "填人设：身份、关系张力、说话方式、边界；不写片中露骨情节",
      "三个备选开场 = 视频结尾三个选项；firstMessage 接在视频最后一幕之后",
      "世界书只放场景/人物/规则，不写结局剧透",
      "人工过一遍红线：成年、自愿、非真人、无未成年/乱伦/非自愿题材",
    ],
  };
}

function cardTemplate() {
  return {
    ...skeletonFor({
      dramaId: "", title: "", categories: [], episodeCount: 0, episodes: [], posters: [], sources: [],
    }),
    source: { origin: "original", dramaId: "", workingTitle: "", categories: [], episodeCount: 1, firstMediaKey: "", posterKey: "", posterUrl: "" },
    _guide: {
      "card.name": "货架标题，建议 12–30 字，带女主名字便于搜索；女主本名写进 description",
      "card.description": "150–400 字：她是谁、在哪、和你什么关系。不写露骨情节。",
      "card.personality": "150–400 字：说话方式、矛盾、底线。可写一句口头禅。",
      "card.scenario": "100–300 字：视频结尾那一刻的场所与状态，作为第一幕。",
      "card.systemPrompt": "规则：只演虚构成年角色；推进关系但不替用户做决定；不写结局；拒绝未成年/非自愿/真人。",
      "card.firstMessage": "以她的声音写 2–4 句，接在视频最后一幕之后。",
      "card.alternateGreetings": "正好 3 条，对应视频结尾三个选项。",
      "card.characterBook": "场景/人物/规则词条；不写结局与反转。",
      "appearanceAnchors.coverFrame": "封面裁切 9:16 的第一帧文件",
    },
  };
}

/** 视频 catalog 的钩子覆盖层模板。catalog 是生成物，钩子写这里，不写进 catalog。 */
function hooksTemplate() {
  return {
    _guide: {
      "键": "剧号（catalog 里的 dramaId，形如 hg-4172）",
      "characterId": "角色卡 ID；有这个就按 ID 进卡，不再靠剧名匹配",
      "hookTitle": "片尾弹窗标题，≤40 字",
      "hookBody": "片尾弹窗正文，≤160 字；写选择，不剧透",
      "hookAction": "按钮文案，≤20 字",
    },
    "_example": {
      "hg-0000": {
        characterId: "character-id",
        hookTitle: "她知道你选了哪条路",
        hookBody: "换你来选：留下、问清楚，还是转身走？",
        hookAction: "进入她的故事",
      },
    },
    entries: {},
  };
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(rows) {
  const header = ["dramaId", "title", "categories", "episodes", "status", "flags", "posterKey"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([row.dramaId, row.title, row.categories.join("/"), row.episodeCount, row.status, row.flags.join("|"), row.posters[0] ?? ""].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** 角色卡校验：发布前必须过的硬条件。 */
function validateCard(raw, knownDramas) {
  const errors = [];
  const warnings = [];
  const card = raw?.card ?? {};
  const source = raw?.source ?? {};
  const text = (value) => (typeof value === "string" ? value : "");
  const allText = [
    ...CARD_REQUIRED.map((field) => text(card[field])),
    ...CARD_PROSE_FIELDS.map((field) => text(card[field])),
    ...(Array.isArray(card.alternateGreetings) ? card.alternateGreetings.map(text) : []),
    ...(Array.isArray(card.suggestedReplies) ? card.suggestedReplies.map(text) : []),
    ...(Array.isArray(card.tags) ? card.tags.map(text) : []),
    JSON.stringify(card.characterBook ?? {}),
  ].join("\n");

  for (const field of CARD_REQUIRED) if (!text(card[field]).trim()) errors.push(`card.${field} 为空`);
  if (text(card.name).length > 120) errors.push("card.name 超过 120 字（平台上限）");
  else if (text(card.name).length > 40) warnings.push("card.name 超过 40 字，货架展示会被截断");
  for (const field of CARD_PROSE_FIELDS) {
    if (text(card[field]).length > 15_000) errors.push(`card.${field} 超过 15000 字`);
  }
  if (!Array.isArray(card.tags) || card.tags.length > 6) errors.push("card.tags 必须为数组且最多 6 个");
  if (!Array.isArray(card.alternateGreetings) || card.alternateGreetings.filter((item) => text(item).trim()).length !== 3) {
    errors.push("card.alternateGreetings 必须正好 3 条非空（对应视频三个选项）");
  }
  if (!Array.isArray(card.suggestedReplies) || card.suggestedReplies.filter((item) => text(item).trim()).length !== 3) {
    errors.push("card.suggestedReplies 必须正好 3 条非空");
  }
  if (!raw?.spoilerPolicy?.noEnding) errors.push("spoilerPolicy.noEnding 必须为 true（卡里不写结局）");
  if (!raw?.rights || raw.rights.realPerson !== false) errors.push("rights.realPerson 必须明确为 false");
  if (raw?.rights?.clearance !== "cleared") warnings.push("rights.clearance 不是 cleared，只能作为草稿");
  for (const field of ["coverFrame", "faceCrop"]) {
    if (!text(raw?.appearanceAnchors?.[field]).trim()) errors.push(`appearanceAnchors.${field} 为空`);
  }

  for (const [label, pattern] of RISK_PATTERNS) {
    if (pattern.test(allText)) errors.push(`正文命中红线题材「${label}」`);
  }
  if (REAL_PERSON_TITLE.test(allText)) errors.push("正文命中真人/明星/换脸字样");

  if (source.origin === "video") {
    if (!/^hg-\d{4,8}$/.test(text(source.dramaId))) errors.push("source.dramaId 不是有效剧号");
    else if (knownDramas && !knownDramas.has(source.dramaId)) warnings.push(`source.dramaId ${source.dramaId} 不在当前 catalog`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

async function walkJsonFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files.sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { value: catalog, origin, live } = await loadCatalog(args.catalog);
  const { dramas, episodeCount } = buildDramas(catalog);
  const knownDramas = new Set(dramas.map((drama) => drama.dramaId));

  if (args.validate) {
    const files = (await walkJsonFiles(args.validate)).filter((file) => !path.basename(file).startsWith("card-template"));
    const results = [];
    for (const file of files) {
      const raw = JSON.parse(await readFile(file, "utf8"));
      const result = validateCard(raw, knownDramas);
      results.push({ file, ...result });
    }
    const ok = results.filter((item) => item.ok).length;
    console.log(`${ok}/${results.length} 张卡通过校验`);
    for (const item of results) {
      if (item.ok) console.log(`✅ ${path.relative(process.cwd(), item.file)}${item.warnings.length ? ` (${item.warnings.length} 警告)` : ""}`);
      else console.log(`❌ ${path.relative(process.cwd(), item.file)}\n   - ${item.errors.join("\n   - ")}`);
    }
    if (args.json) console.log(JSON.stringify(results, null, 2));
    else await writeJson(path.join(args.out, "validation.json"), { validatedAt: new Date().toISOString(), results });
    process.exit(ok === results.length ? 0 : 1);
  }

  const nameCounts = scanRealPersonNames(dramas);
  // 同名剧只留一部：集数多的优先，集数一样取编号大的。
  const titleOwners = new Map();
  for (const drama of dramas) {
    const key = compact(drama.title);
    const current = titleOwners.get(key);
    if (!current
      || drama.episodes.length > current.episodes
      || (drama.episodes.length === current.episodes && drama.dramaId > current.dramaId)) {
      titleOwners.set(key, { dramaId: drama.dramaId, episodes: drama.episodes.length });
    }
  }
  const rows = dramas.map((drama) => {
    const { status, flags, reasons } = classify(drama, nameCounts, titleOwners);
    return {
      dramaId: drama.dramaId, title: drama.title, categories: drama.categories,
      episodeCount: drama.episodes.length, status, flags, reasons,
      posters: drama.posters, sources: drama.sources, episodes: drama.episodes,
    };
  });
  const ranked = rankDramas(rows);

  const byStatus = ranked.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  const byCategory = ranked.reduce((acc, row) => {
    for (const category of row.categories) {
      acc[category] = acc[category] ?? { dramas: 0, episodes: 0 };
      acc[category].dramas += 1;
      acc[category].episodes += row.episodeCount;
    }
    return acc;
  }, {});
  const eligibleEpisodes = ranked.filter((row) => row.status === "eligible").reduce((sum, row) => sum + row.episodeCount, 0);
  const eligible = ranked.filter((row) => row.status === "eligible");

  await mkdir(args.out, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    catalog: { origin, live, updatedAt: catalog?.updatedAt ?? "", brand: catalog?.brand ?? "" },
    totals: {
      dramas: ranked.length,
      episodes: episodeCount,
      eligibleDramas: eligible.length,
      eligibleEpisodes,
      realPersonDramas: ranked.filter((row) => row.status === "excluded_real_person").length,
      contentRiskDramas: ranked.filter((row) => row.status === "excluded_content_risk").length,
      duplicateDramas: ranked.filter((row) => row.status === "duplicate").length,
      eligibleWithExplicitTitle: eligible.filter((row) => row.flags.includes("explicit_title")).length,
    },
    byStatus,
    byCategory,
    realPersonNameCandidates: [...nameCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    eligibleCoverage: eligible.length / Math.max(1, ranked.length),
    note: "真实姓名候选来自换脸/魔改标题的自体反推，仅用于筛除，不代表完整真人清单；AI成人短剧分类里也可能混有真人条目，需人工复核。",
  };
  await writeJson(path.join(args.out, "summary.json"), summary);
  await writeJson(path.join(args.out, "worklist.json"), ranked.map(({ episodes, ...row }) => row));
  await writeFile(path.join(args.out, "worklist.csv"), writeCsv(ranked), "utf8");
  await writeJson(path.join(args.out, "card-template.json"), cardTemplate());
  await writeJson(path.join(args.out, "hooks-template.json"), hooksTemplate());

  // P1 试点候选：多集、无露骨广告词、集数多优先。仍需编辑复审，不自动做卡。
  const pilot = eligible
    .filter((row) => row.episodeCount >= 6 && !row.flags.includes("explicit_title"))
    .sort((a, b) => b.episodeCount - a.episodeCount || a.title.localeCompare(b.title, "zh-Hans-CN"))
    .slice(0, 20)
    .map((row) => ({
      dramaId: row.dramaId, title: row.title, categories: row.categories,
      episodeCount: row.episodeCount, posterKey: row.posters[0] ?? "",
      why: `${row.episodeCount} 集、标题无露骨广告词、未命中真人与题材红线`,
      todo: "抽帧定女主 → 写卡 → 校验 → 提审",
    }));
  await writeJson(path.join(args.out, "pilot-candidates.json"), {
    generatedAt: new Date().toISOString(),
    note: "机械排序的试点候选，不是批准清单；每部都要人工复审后再做卡。",
    count: pilot.length,
    candidates: pilot,
  });

  const pick = args.skeletons > 0 ? ranked.filter((row) => row.status === "eligible").slice(0, args.skeletons) : [];
  for (const row of pick) {
    await writeJson(path.join(args.out, "skeletons", `${row.dramaId}.json`), skeletonFor(row));
  }

  const lines = [
    `# 视频女主角角色卡 · 盘点结果`,
    ``,
    `- 生成时间：${summary.generatedAt}`,
    `- 来源：${origin}${live ? "（线上）" : ""}，catalog 更新时间：${summary.catalog.updatedAt || "未知"}`,
    `- 总剧数：${summary.totals.dramas}，总集数：${summary.totals.episodes}`,
    ``,
    `| 状态 | 剧数 | 说明 |`,
    `| --- | --- | --- |`,
    `| eligible | ${byStatus.eligible ?? 0} | 可做卡（仍需人工复审） |`,
    `| excluded_real_person | ${byStatus.excluded_real_person ?? 0} | 真人换脸/魔改，红线 |`,
    `| excluded_content_risk | ${byStatus.excluded_content_risk ?? 0} | 未成年/非自愿/乱伦题材，不做卡 |`,
    `| duplicate | ${byStatus.duplicate ?? 0} | 同名重复 |`,
    ``,
    `可做卡覆盖：${(summary.eligibleCoverage * 100).toFixed(1)}%（${eligible.length}/${ranked.length} 部，${eligibleEpisodes} 集）。`,
    `其中标题带露骨广告词的 ${summary.totals.eligibleWithExplicitTitle} 部，建议另起卡名，公开卡名/封面不带露骨词。`,
    ``,
    `## 分类分布`,
    ``,
    ...Object.entries(byCategory).map(([category, item]) => `- ${category}：${item.dramas} 部 / ${item.episodes} 集`),
    ``,
    `## 产出`,
    ``,
    `- \`summary.json\``,
    `- \`worklist.json\` / \`worklist.csv\``,
    `- \`card-template.json\``,
    `- \`skeletons/\`：${pick.length} 份空白骨架`,
    `- \`pilot-candidates.json\`：${pilot.length} 部试点候选`,
    ``,
    `## 下一步`,
    ``,
    `1. 真人换脸/魔改条目先下架或去索引，不做卡。`,
    `2. 可做条目按播放/完播排序取 Top，不按剧号顺序。`,
    `3. 抽关键帧填 \`skeletons/\`，用 \`--validate\` 过校验后再进发布流程。`,
  ];
  await writeFile(path.join(args.out, "README.md"), `${lines.join("\n")}\n`, "utf8");

  console.log(`catalog: ${origin}${live ? " (live)" : ""}`);
  console.log(`dramas ${ranked.length} / episodes ${episodeCount}`);
  console.log(`eligible ${eligible.length} (${(summary.eligibleCoverage * 100).toFixed(1)}%) / real-person ${summary.totals.realPersonDramas} / risk ${summary.totals.contentRiskDramas} / duplicate ${summary.totals.duplicateDramas}`);
  console.log(`wrote ${args.out}`);
  for (const [status, count] of Object.entries(byStatus)) console.log(`  ${status}: ${count}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack || error.message) : error);
  process.exit(1);
});
