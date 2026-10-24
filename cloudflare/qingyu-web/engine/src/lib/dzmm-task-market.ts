import { emptyTaskMarketInstructions, parseTaskMarketInstructions, TASK_INSTRUCTION_LIMITS, type TaskMarketInstructions } from "./dzmm-task-instructions";

export type TaskMarketCategory = "roleplay" | "writing" | "feedback";
export type TaskMarketFilter = "open" | "completed" | "all" | "hidden" | "my" | "joined";
export type TaskMarketStatus = "pending" | "open" | "completed" | "cancelled" | "rejected";
export type TaskAssignmentStatus = "claimed" | "submitted" | "returned" | "approved" | "withdrawn";
export type TaskMarketReward = 5 | 10 | 20;

export const TASK_MARKET_CATEGORIES: { id: TaskMarketCategory; label: string }[] = [
  { id: "roleplay", label: "角色体验" }, { id: "writing", label: "原创写作" }, { id: "feedback", label: "意见反馈" },
];
export const TASK_MARKET_REWARDS: TaskMarketReward[] = [5, 10, 20];
export const TASK_MARKET_HOURS = [12, 24, 48] as const;

export type TaskMarketTask = {
  id: string; owner: { id: string; nickname: string }; title: string; description: string; requirements: string;
  category: TaskMarketCategory; characterId: string | null; characterName: string | null;
  rewardPoints: TaskMarketReward; slots: number; remainingSlots: number; deadlineAt: number;
  status: TaskMarketStatus; version: number; createdAt: number; updatedAt: number;
  hidden: boolean; participating: boolean; approvedCount: number; submissionCount: number;
  reviewReason: string; canClaim: boolean; instructions?: TaskMarketInstructions;
};
export type TaskMarketAssignment = {
  id: string; taskId: string; userId: string; status: TaskAssignmentStatus; version: number;
  createdAt: number; updatedAt: number; submittedAt: number | null; reviewedAt: number | null;
  reviewReason: string; rewardPoints: number;
};
export type TaskMarketSubmission = {
  id: string; assignmentId: string; userId: string; nickname: string; revision: number; body: string;
  createdAt: number; assignment: TaskMarketAssignment;
};
export type TaskMarketListing = {
  accountId: string; pointsKind: "credit"; modelBillingLinked: true; rewardUnit?: "Credit";
  tasks: TaskMarketTask[]; total: number; offset: number; limit: number; hasMore: boolean;
};
export type TaskMarketDetail = {
  accountId: string; task: TaskMarketTask; assignment: TaskMarketAssignment | null; submissions: TaskMarketSubmission[];
};
export type TaskMarketMutation = { accountId: string; task: TaskMarketTask; assignment?: TaskMarketAssignment; submission?: TaskMarketSubmission };
export type TaskMarketPublish = {
  accountId: string; requestId: string; title: string; description: string; requirements: string;
  category: TaskMarketCategory; characterId: string | null; rewardPoints: TaskMarketReward; slots: number; deadlineAt: number;
  instructions?: TaskMarketInstructions;
};
export type TaskMarketFilters = { filter?: TaskMarketFilter; category?: TaskMarketCategory | "all"; q?: string; offset?: number; limit?: number };
export type TaskMarketComposeDraft = {
  title: string; description: string; requirements: string; category: TaskMarketCategory;
  characterId: string; rewardPoints: TaskMarketReward; slots: number; hours: 12 | 24 | 48;
  instructions?: TaskMarketInstructions;
};
export type TaskMarketWorkDraft = { text: string; revision: number };
export type TaskMarketDraftSnapshot = {
  schemaVersion: 1; accountId: string; form: TaskMarketComposeDraft;
  workDrafts: Record<string, TaskMarketWorkDraft>; attempt: TaskMarketPublish | null; publishing: boolean;
};

export class TaskMarketError extends Error {
  constructor(public readonly status: number, message: string, public readonly uncertain = false) {
    super(message); this.name = "TaskMarketError";
  }
}

const API = "/api/backend/v1/task-market";
const TASK_STATUSES: TaskMarketStatus[] = ["pending", "open", "completed", "cancelled", "rejected"];
const ASSIGNMENT_STATUSES: TaskAssignmentStatus[] = ["claimed", "submitted", "returned", "approved", "withdrawn"];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;
const nullableTime = (value: unknown) => value === null || integer(value);
function validInstructions(value: unknown) {
  try { parseTaskMarketInstructions(value); return true; } catch { return false; }
}
function isTask(value: unknown): value is TaskMarketTask {
  if (!record(value) || !record(value.owner)) return false;
  return typeof value.id === "string" && typeof value.owner.id === "string" && typeof value.owner.nickname === "string"
    && typeof value.title === "string" && typeof value.description === "string" && typeof value.requirements === "string"
    && TASK_MARKET_CATEGORIES.some(category => category.id === value.category)
    && (value.characterId === null || typeof value.characterId === "string")
    && (value.characterName === null || typeof value.characterName === "string")
    && TASK_MARKET_REWARDS.includes(value.rewardPoints as TaskMarketReward)
    && integer(value.slots, 1) && value.slots <= 20 && integer(value.remainingSlots) && value.remainingSlots <= value.slots
    && TASK_STATUSES.includes(value.status as TaskMarketStatus) && integer(value.version)
    && integer(value.deadlineAt) && integer(value.createdAt) && integer(value.updatedAt)
    && typeof value.hidden === "boolean" && typeof value.participating === "boolean" && typeof value.canClaim === "boolean"
    && integer(value.approvedCount) && integer(value.submissionCount) && typeof value.reviewReason === "string"
    && validInstructions(value.instructions);
}
function isAssignment(value: unknown): value is TaskMarketAssignment {
  return record(value) && typeof value.id === "string" && typeof value.taskId === "string" && typeof value.userId === "string"
    && ASSIGNMENT_STATUSES.includes(value.status as TaskAssignmentStatus) && integer(value.version)
    && integer(value.createdAt) && integer(value.updatedAt) && nullableTime(value.submittedAt) && nullableTime(value.reviewedAt)
    && typeof value.reviewReason === "string" && integer(value.rewardPoints);
}
function isSubmission(value: unknown): value is TaskMarketSubmission {
  return record(value) && typeof value.id === "string" && typeof value.assignmentId === "string" && typeof value.userId === "string"
    && typeof value.nickname === "string" && typeof value.body === "string" && integer(value.revision, 1)
    && integer(value.createdAt) && isAssignment(value.assignment)
    && value.assignment.id === value.assignmentId && value.assignment.userId === value.userId;
}
async function request<T>(accountId: string, path: string, validate: (value: Record<string, unknown>) => boolean, body?: unknown): Promise<T> {
  const writing = body !== undefined;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TaskMarketError(504, writing
        ? "任务操作请求超时，暂时无法确认操作结果。请刷新任务状态后再决定是否重试。"
        : "任务读取超时，请刷新状态后重试。", writing));
      controller.abort();
    }, 20_000);
  });
  const perform = async () => {
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        method: writing ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        headers: writing ? { "Content-Type": "application/json" } : undefined,
        body: writing ? JSON.stringify(body) : undefined, signal: controller.signal,
      });
    } catch {
      throw new TaskMarketError(503, writing ? "暂时无法确认操作结果，请刷新任务状态后重试。" : "任务广场暂时无法连接，请重试。", writing);
    }
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new TaskMarketError(response.status, record(value) && typeof value.error === "string" ? value.error : "任务请求失败，请刷新后重试。", writing && response.status >= 500);
    if (!record(value) || value.accountId !== accountId) throw new TaskMarketError(409, "账户已变化，请刷新后查看当前账号的任务。", writing);
    if (!validate(value)) throw new TaskMarketError(502, "任务服务返回的数据无效，请刷新后重试。", writing);
    return value as T;
  };
  try {
    // One deadline covers transport and body reading, even if an adapter ignores abort.
    return await Promise.race([perform(), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
const listingValid = (value: Record<string, unknown>) => value.pointsKind === "credit" && value.modelBillingLinked === true
  && Array.isArray(value.tasks) && value.tasks.every(isTask) && integer(value.total) && integer(value.offset)
  && integer(value.limit, 1) && typeof value.hasMore === "boolean";
const mutationValid = (value: Record<string, unknown>) => isTask(value.task)
  && (value.assignment === undefined || (isAssignment(value.assignment) && value.assignment.taskId === value.task.id))
  && (value.submission === undefined || (isSubmission(value.submission) && value.submission.assignment.taskId === value.task.id));
const mutationFor = (id: string) => (value: Record<string, unknown>) => mutationValid(value) && (value.task as TaskMarketTask).id === id;
function queryString(filters: TaskMarketFilters) {
  const query = new URLSearchParams({ limit: String(filters.limit ?? 20), offset: String(filters.offset ?? 0) });
  for (const key of ["filter", "category", "q"] as const) if (filters[key] !== undefined && filters[key] !== "") query.set(key, String(filters[key]));
  return query;
}
const idPath = (id: string) => `/${encodeURIComponent(id)}`;
export function fetchTaskMarket(accountId: string, filters: TaskMarketFilters = {}) {
  return request<TaskMarketListing>(accountId, `?${queryString(filters)}`, listingValid);
}
export function fetchTaskMarketReviewQueue(accountId: string, filters: Omit<TaskMarketFilters, "filter"> = {}) {
  return request<TaskMarketListing>(accountId, `/admin?status=pending&${queryString(filters)}`, listingValid);
}
export function fetchTaskMarketDetail(accountId: string, id: string) {
  return request<TaskMarketDetail>(accountId, idPath(id), value => isTask(value.task) && value.task.id === id
    && (value.assignment === null || (isAssignment(value.assignment) && value.assignment.taskId === id && value.assignment.userId === accountId))
    && Array.isArray(value.submissions) && value.submissions.every(item => isSubmission(item) && item.assignment.taskId === id));
}
export function publishTaskMarketTask(input: TaskMarketPublish) {
  return request<TaskMarketMutation>(input.accountId, "", value => mutationValid(value) && (value.task as TaskMarketTask).owner.id === input.accountId, input);
}
export function claimTaskMarketTask(accountId: string, id: string) {
  return request<TaskMarketMutation>(accountId, `${idPath(id)}/claim`, value => mutationFor(id)(value)
    && isAssignment(value.assignment) && value.assignment.userId === accountId, { accountId });
}
export function hideTaskMarketTask(accountId: string, id: string, hidden: boolean) {
  return request<TaskMarketMutation>(accountId, `${idPath(id)}/hide`, mutationFor(id), { accountId, hidden });
}
export function cancelTaskMarketTask(accountId: string, id: string, version: number) {
  return request<TaskMarketMutation>(accountId, `${idPath(id)}/cancel`, value => mutationFor(id)(value)
    && (value.task as TaskMarketTask).owner.id === accountId, { accountId, version });
}
export function withdrawTaskMarketAssignment(accountId: string, id: string, version: number) {
  return request<TaskMarketMutation>(accountId, `${idPath(id)}/withdraw`, value => mutationFor(id)(value)
    && isAssignment(value.assignment) && value.assignment.userId === accountId, { accountId, version });
}
export function submitTaskMarketWork(accountId: string, id: string, version: number, body: string) {
  return request<TaskMarketMutation>(accountId, `${idPath(id)}/submissions`, value => mutationFor(id)(value)
    && isAssignment(value.assignment) && value.assignment.userId === accountId
    && isSubmission(value.submission) && value.submission.userId === accountId && value.submission.assignmentId === value.assignment.id,
  { accountId, version, body });
}
export function reviewTaskMarketWork(accountId: string, id: string, assignmentId: string, version: number, decision: "approved" | "returned", reason?: string) {
  return request<TaskMarketMutation>(accountId, `${idPath(id)}/assignments/${encodeURIComponent(assignmentId)}/review`, value => mutationFor(id)(value)
    && isAssignment(value.assignment) && value.assignment.id === assignmentId, { accountId, version, decision, ...(reason ? { reason } : {}) });
}
export function reviewTaskMarketTask(accountId: string, id: string, version: number, decision: "approved" | "rejected", reason?: string) {
  return request<TaskMarketMutation>(accountId, `${idPath(id)}/review`, mutationFor(id), { accountId, version, decision, ...(reason ? { reason } : {}) });
}

const draftKey = (accountId: string) => `qingyu-task-market-draft-v1:${accountId}`;
const draftText = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length <= maximum;
// Blank editor rows remain in drafts; only nonblank rows become published metadata.
export function composeTaskMarketInstructions(value: TaskMarketInstructions | undefined): TaskMarketInstructions {
  if (value === undefined) return emptyTaskMarketInstructions();
  return parseTaskMarketInstructions({ goal: value.goal, constraints: value.constraints.filter(item => item.trim()), rules: value.rules.filter(item => item.trim()) });
}
function validInstructionDraft(value: unknown): boolean {
  if (value === undefined) return true;
  return record(value) && Object.keys(value).every(key => ["goal", "constraints", "rules"].includes(key))
    && draftText(value.goal, TASK_INSTRUCTION_LIMITS.goal) && !value.goal.includes("\0")
    && Array.isArray(value.constraints) && value.constraints.length <= TASK_INSTRUCTION_LIMITS.constraintCount
    && value.constraints.every(item => draftText(item, TASK_INSTRUCTION_LIMITS.constraintLength) && !item.includes("\0"))
    && Array.isArray(value.rules) && value.rules.length <= TASK_INSTRUCTION_LIMITS.ruleCount
    && value.rules.every(item => draftText(item, TASK_INSTRUCTION_LIMITS.ruleLength) && !item.includes("\0"));
}
function validCompose(value: unknown): value is TaskMarketComposeDraft {
  return record(value) && draftText(value.title, 80) && draftText(value.description, 4000) && draftText(value.requirements, 2000)
    && TASK_MARKET_CATEGORIES.some(category => category.id === value.category) && draftText(value.characterId, 100)
    && TASK_MARKET_REWARDS.includes(value.rewardPoints as TaskMarketReward)
    && typeof value.slots === "number" && Number.isFinite(value.slots) && Math.abs(value.slots) <= 1000000000
    && TASK_MARKET_HOURS.includes(value.hours as 12 | 24 | 48) && validInstructionDraft(value.instructions);
}
function validAttempt(value: unknown, accountId: string): value is TaskMarketPublish {
  return record(value) && value.accountId === accountId && typeof value.requestId === "string"
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId)
    && draftText(value.title, 80) && !!value.title.trim() && draftText(value.description, 4000) && !!value.description.trim()
    && draftText(value.requirements, 2000) && !!value.requirements.trim()
    && TASK_MARKET_CATEGORIES.some(category => category.id === value.category)
    && (value.characterId === null || draftText(value.characterId, 100))
    && TASK_MARKET_REWARDS.includes(value.rewardPoints as TaskMarketReward) && integer(value.slots, 1) && value.slots <= 20
    && integer(value.deadlineAt, 1) && validInstructions(value.instructions);
}
export function readTaskMarketDraft(accountId: string): TaskMarketDraftSnapshot | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(draftKey(accountId));
  if (raw === null) return null;
  if (raw.length > 1000000) throw new Error("任务草稿过大，请保留当前原文后再清理浏览器草稿。");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.schemaVersion !== 1 || value.accountId !== accountId || !validCompose(value.form)
    || !record(value.workDrafts) || typeof value.publishing !== "boolean"
    || (value.attempt !== null && !validAttempt(value.attempt, accountId))) throw new Error("任务草稿格式无效，未载入其他账户或不完整的记录。");
  const workDrafts: Record<string, TaskMarketWorkDraft> = {};
  const entries = Object.entries(value.workDrafts);
  for (const [id, item] of entries) {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(id) || !record(item) || !draftText(item.text, 12000) || !integer(item.revision)) throw new Error("任务成果草稿格式无效，原记录未被覆盖。");
    workDrafts[id] = { text: item.text, revision: item.revision };
  }
  const form = value.form;
  const attempt = value.attempt;
  const instructions = attempt === null ? null : composeTaskMarketInstructions(form.instructions);
  const attemptedInstructions = attempt === null ? null : parseTaskMarketInstructions(attempt.instructions);
  if (attempt !== null && (attempt.title !== form.title.trim() || attempt.description !== form.description.trim()
    || attempt.requirements !== form.requirements.trim() || attempt.category !== form.category
    || attempt.characterId !== (form.characterId || null) || attempt.rewardPoints !== form.rewardPoints || attempt.slots !== form.slots
    || JSON.stringify(attemptedInstructions) !== JSON.stringify(instructions))) {
    throw new Error("发布原内容与草稿不一致，未执行不确定的委托请求。");
  }
  return {
    schemaVersion: 1, accountId,
    form: { title: form.title, description: form.description, requirements: form.requirements, category: form.category,
      characterId: form.characterId, rewardPoints: form.rewardPoints, slots: form.slots, hours: form.hours,
      ...(form.instructions !== undefined ? { instructions: form.instructions } : {}) },
    workDrafts, attempt: attempt === null ? null : {
      accountId, requestId: attempt.requestId, title: attempt.title, description: attempt.description, requirements: attempt.requirements,
      category: attempt.category, characterId: attempt.characterId, rewardPoints: attempt.rewardPoints, slots: attempt.slots, deadlineAt: attempt.deadlineAt,
      ...(attempt.instructions !== undefined ? { instructions: parseTaskMarketInstructions(attempt.instructions) } : {}),
    }, publishing: value.publishing,
  };
}
export function saveTaskMarketDraft(snapshot: TaskMarketDraftSnapshot) {
  if (typeof window === "undefined") return;
  const text = JSON.stringify(snapshot);
  if (text.length > 1000000) throw new Error("任务草稿过大，暂时无法保存。");
  window.sessionStorage.setItem(draftKey(snapshot.accountId), text);
}
