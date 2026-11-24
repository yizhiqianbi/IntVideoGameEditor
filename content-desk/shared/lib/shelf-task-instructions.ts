/** Optional task authoring metadata; completion remains a publisher decision. */
export type TaskMarketInstructions = { goal: string; constraints: string[]; rules: string[] };
export const TASK_INSTRUCTION_LIMITS = { goal: 4000, constraintCount: 10, constraintLength: 120, ruleCount: 20, ruleLength: 500, totalLength: 12000 } as const;
export function emptyTaskMarketInstructions(): TaskMarketInstructions { return { goal: "", constraints: [], rules: [] }; }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !value.includes("\0");
export function parseTaskMarketInstructions(value: unknown): TaskMarketInstructions {
  if (value === undefined) return emptyTaskMarketInstructions();
  if (!record(value) || Object.keys(value).some(key => !["goal", "constraints", "rules"].includes(key))
    || !validText(value.goal, TASK_INSTRUCTION_LIMITS.goal)
    || !Array.isArray(value.constraints) || value.constraints.length > TASK_INSTRUCTION_LIMITS.constraintCount
    || value.constraints.some(item => !validText(item, TASK_INSTRUCTION_LIMITS.constraintLength) || !item.trim())
    || !Array.isArray(value.rules) || value.rules.length > TASK_INSTRUCTION_LIMITS.ruleCount
    || value.rules.some(item => !validText(item, TASK_INSTRUCTION_LIMITS.ruleLength) || !item.trim())) {
    throw new Error("任务目标或约束规则无效，请检查条目数量和长度。");
  }
  const parsed = { goal: value.goal, constraints: [...value.constraints] as string[], rules: [...value.rules] as string[] };
  if (parsed.goal.length + parsed.constraints.join("").length + parsed.rules.join("").length > TASK_INSTRUCTION_LIMITS.totalLength) throw new Error("任务目标与规则合计最多 12,000 个字符。");
  return parsed;
}
export function hasTaskMarketInstructions(value: TaskMarketInstructions) {
  return !!value.goal || value.constraints.length > 0 || value.rules.length > 0;
}
