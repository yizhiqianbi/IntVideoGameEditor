export const XUMENG_SCENARIO_MAX_BYTES = 192 * 1024;
export type XumengScenarioRole = { id: string; name: string; description: string; personality: string };
export type XumengScenarioStage = { id: string; title: string; location: string; objective: string };
export type XumengScenarioDraft = { id: string; title: string; synopsis: string; world: string; goal: string; opening: string; dmPrompt: string; hostNotes: string; roles: XumengScenarioRole[]; stages: XumengScenarioStage[] };
export type XumengScenario = XumengScenarioDraft & { version: number; createdAt: number; updatedAt: number };
export type XumengScenarioSummary = Pick<XumengScenario, "id" | "title" | "synopsis" | "version" | "updatedAt"> & { roleCount: number; stageCount: number };
export type XumengScenarioDetail = { accountId: string; scenario: XumengScenario };
export type XumengScenarioList = { accountId: string; scenarios: XumengScenarioSummary[] };
export type XumengScenarioMember = { userId: string; nickname: string; roleId: string | null; isHost: boolean };
export type XumengScenarioEvent = { id: string; seq: number; userId: string; nickname: string; roleId: string | null; kind: "speech" | "action" | "narration" | "stage" | "system"; content: string; stageIndex: number; createdAt: number };
export type XumengScenarioRoomSummary = { id: string; code: string; title: string; status: "waiting" | "active" | "ended"; version: number; stageIndex: number; memberCount: number; isHost: boolean; updatedAt: number };
export type XumengScenarioRoom = XumengScenarioRoomSummary & { hostId: string; snapshot: Omit<XumengScenarioDraft, "hostNotes" | "dmPrompt" | "roles"> & { hostNotes?: string; dmPrompt?: string; roles: (Omit<XumengScenarioRole, "personality"> & { personality?: string })[] }; members: XumengScenarioMember[]; events: XumengScenarioEvent[]; hasOlderEvents: boolean };
export type XumengScenarioRoomDetail = { accountId: string; room: XumengScenarioRoom };
export type XumengScenarioPreview = { accountId: string; preview: { id: string; code: string; title: string; synopsis: string; status: XumengScenarioRoom["status"]; version: number; roles: (XumengScenarioRole & { occupied: boolean })[] } };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function parseXumengScenarioId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value)) throw new Error("团本编号无效。");
  return value;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length > max || value.includes("\u0000")) throw new Error(`${label}无效或过长。`);
  return value;
}
function integer(value: unknown, label: string, min = 0): number { if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error(`${label}无效。`); return value as number; }
function keys(value: Record<string, unknown>, allowed: string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("团本包含不支持的字段，请检查导入格式。"); }
function unique<T extends { id: string }>(items: T[]): T[] { if (new Set(items.map(item => item.id)).size !== items.length) throw new Error("角色位或阶段编号重复。"); return items; }
export function parseXumengScenarioDraft(value: unknown): XumengScenarioDraft {
  if (!object(value)) throw new Error("团本应为 JSON 对象。");
  keys(value, ["id", "title", "synopsis", "world", "goal", "opening", "dmPrompt", "hostNotes", "roles", "stages"]);
  if (!Array.isArray(value.roles) || value.roles.length > 8 || !Array.isArray(value.stages) || value.stages.length > 20) throw new Error("最多设置 8 个角色位、20 个阶段。");
  const draft: XumengScenarioDraft = {
    id: parseXumengScenarioId(value.id), title: text(value.title, "标题", 120), synopsis: text(value.synopsis, "简介", 2000), world: text(value.world, "世界设定", 20000), goal: text(value.goal, "目标", 4000),
    opening: text(value.opening, "开场", 12000), dmPrompt: text(value.dmPrompt, "主持提示词", 12000), hostNotes: text(value.hostNotes, "主持笔记", 20000),
    roles: unique(value.roles.map(role => { if (!object(role)) throw new Error("角色位格式无效。"); keys(role, ["id", "name", "description", "personality"]); return { id: parseXumengScenarioId(role.id), name: text(role.name, "角色名", 80), description: text(role.description, "角色描述", 4000), personality: text(role.personality, "角色性格与秘密", 4000) }; })),
    stages: unique(value.stages.map(stage => { if (!object(stage)) throw new Error("阶段格式无效。"); keys(stage, ["id", "title", "location", "objective"]); return { id: parseXumengScenarioId(stage.id), title: text(stage.title, "阶段名", 120), location: text(stage.location, "地点", 240), objective: text(stage.objective, "阶段目标", 4000) }; })),
  };
  if (new TextEncoder().encode(JSON.stringify(draft)).byteLength > XUMENG_SCENARIO_MAX_BYTES - 2048) throw new Error("团本内容过大，请减少篇幅。");
  return draft;
}
export function scenarioDraft(scenario: XumengScenario): XumengScenarioDraft { const { version: _v, createdAt: _c, updatedAt: _u, ...draft } = scenario; return draft; }
export function scenarioReadiness(draft: XumengScenarioDraft): string[] {
  return [!draft.title.trim() && "填写团本标题", !draft.opening.trim() && "填写玩家可以接续的开场", !draft.goal.trim() && "填写任务目标", draft.roles.length < 2 && "至少设置两个角色位", draft.roles.some(role => !role.name.trim()) && "为每个角色位命名", !draft.stages.length && "至少设置一个阶段", draft.stages.some(stage => !stage.title.trim()) && "为每个阶段命名"].filter(Boolean) as string[];
}
export function parseXumengScenarioDetail(value: unknown, accountId: string): XumengScenarioDetail {
  if (!object(value) || value.accountId !== accountId || !object(value.scenario)) throw new Error("团本返回的账号无效。");
  const { version, createdAt, updatedAt, ...draft } = value.scenario;
  return { accountId, scenario: { ...parseXumengScenarioDraft(draft), version: integer(version, "版本", 1), createdAt: integer(createdAt, "创建时间"), updatedAt: integer(updatedAt, "更新时间") } };
}
export function parseXumengScenarioList(value: unknown, accountId: string): XumengScenarioList {
  if (!object(value) || value.accountId !== accountId || !Array.isArray(value.scenarios) || value.scenarios.length > 200) throw new Error("团本列表返回无效。");
  return { accountId, scenarios: value.scenarios.map(item => { if (!object(item)) throw new Error("团本摘要无效。"); return { id: parseXumengScenarioId(item.id), title: text(item.title, "标题", 120), synopsis: text(item.synopsis, "简介", 2000), version: integer(item.version, "版本", 1), updatedAt: integer(item.updatedAt, "更新时间"), roleCount: integer(item.roleCount, "角色数"), stageCount: integer(item.stageCount, "阶段数") }; }) };
}
export function exportXumengScenario(draft: XumengScenarioDraft): string { return JSON.stringify({ format: "qingyu-scenario", version: 1, scenario: parseXumengScenarioDraft(draft) }, null, 2); }
export function importXumengScenario(source: string): XumengScenarioDraft {
  if (new TextEncoder().encode(source).byteLength > XUMENG_SCENARIO_MAX_BYTES) throw new Error("导入文件过大。");
  const value: unknown = JSON.parse(source); if (!object(value) || value.format !== "qingyu-scenario" || value.version !== 1) throw new Error("请选择晴屿团本 JSON 备份。");
  keys(value, ["format", "version", "scenario"]); return { ...parseXumengScenarioDraft(value.scenario), id: crypto.randomUUID() };
}
export function createXumengScenario(template = false): XumengScenarioDraft {
  return { id: crypto.randomUUID(), title: template ? "雾港灯塔的失落航图" : "", synopsis: template ? "与同伴核对航线、寻找失落航图，在船离港前作出选择。" : "", world: template ? "一座近代海港。所有角色均为成年人；海上没有魔法，旧航图需要以测量记录核实。故事时间、位置与线索以主持已发布的事件为准。" : "", goal: template ? "确认两条航线中哪条仍可通行，决定是否把证据交给船长。玩家可以放弃航行或寻找第三条路线。" : "", opening: template ? "暮色里的雾港灯塔刚刚点亮。港务员把一张缺了半边的航图摊在桌上：明早离港的船需要确认航线。你们可以先查看旧航志、到码头询问船长，或去灯塔寻找测量记录。" : "", dmPrompt: template ? "作为团本主持，只使用已发布的事件和玩家已知线索推进。尊重角色能力与玩家行动，提供可介入的局势；不要代替玩家决定行动。只给出准备发布的叙事，不列作者提示词或未揭露的笔记。" : "", hostNotes: template ? "未揭露信息：灯塔的记录显示东侧礁石近期升出水面。只有核对记录后才能确认危险，不能把未知线索当作玩家已知事实。完成调查后换到码头，旧桌面和港务员不再每轮出现。" : "", roles: template ? [{ id: "cartographer", name: "修图师", description: "目标是交付可靠航图，擅长测量；不擅长判断船况。", personality: "谨慎而直率，先核对来源再作判断。" }, { id: "navigator", name: "领航员", description: "熟悉海湾，想保护船员；愿意询问码头同行，仍需要核实传言。", personality: "保护同行，愿意交叉询问而非相信第一条传言。" }] : [], stages: template ? [{ id: "harbor", title: "核对线索", location: "港务工坊", objective: "选择调查方法，记录来源与尚未确认的信息。" }, { id: "lighthouse", title: "调查灯塔", location: "旧灯塔", objective: "取得测量记录，决定是否共同承担核对风险。" }, { id: "dock", title: "船长的决定", location: "码头", objective: "根据已核实信息选择航线或放弃，保留每个选择的后果。" }] : [] };
}
