// Architecture adapted from MaiBot's per-session Planner -> reply/wait runtime.
// Independent implementation; no MaiBot source code or prompt text is vendored.
// Decisions contain bounded action metadata, never the model's reasoning trace.
import { randomUUID } from 'node:crypto';

export function recordDecision(session, control, { now = new Date().toISOString() } = {}) {
  if (!control?.trace) return session;
  const trace = control.trace;
  const entry = {
    at: now, revision: session.revision,
    mode: 'planner-replyer', action: ['reply', 'wait', 'silent'].includes(trace.action) ? trace.action : 'silent',
    plannerModel: String(trace.plannerModel || '').slice(0, 160), replyerModel: String(trace.replyerModel || '').slice(0, 160),
    focus: String(trace.focus || '').slice(0, 160), tone: String(trace.tone || '').slice(0, 80),
    durationMs: Math.max(0, Math.min(120000, Number(trace.durationMs) || 0)), fallback: trace.fallback === true,
    formatRepaired: trace.formatRepaired === true,
    ...(trace.fallback ? { failure: trace.failure === 'invalid-plan' ? 'invalid-plan' : 'planner-unavailable' } : {}),
  };
  session.aiRuntime = { version: 1, lastDecision: entry,
    decisions: [...(session.aiRuntime?.decisions || []).slice(-11), entry] };
  return session;
}

// wait consumes one of the existing bounded initiative opportunities. An
// explicit runtime timestamp is authoritative; the model cannot set timers.
export function applyInitiativeDecision(committed, source, control, { now = new Date().toISOString() } = {}) {
  recordDecision(committed, control, { now });
  if (control?.plan?.action !== 'wait') return committed;
  const state = committed.initiative;
  const count = source.aiRuntime?.consecutiveWaits || 0;
  committed.aiRuntime.consecutiveWaits = count + 1;
  if (!state?.enabled || state.pausedUntilUser || state.noReplyNudgeUsed || count >= 2 || state.budgetUsed >= 3) {
    state.pending = null;
    return committed;
  }
  const seconds = Math.max(12, Math.min(120, control.plan.waitSeconds || 35));
  const time = Date.parse(now);
  // Reconsider the same life opportunity later; waiting is not delivering it.
  committed.agency = structuredClone(source.agency);
  state.pending = { id: randomUUID(), kind: 'reconsider',
    intent: String(control.plan.focus || '等待后检查是否出现新的开口理由').slice(0, 140),
    createdAt: now, notBefore: new Date(time + seconds * 1000).toISOString(),
    expiresAt: new Date(time + 300000).toISOString(),
    ...(source.initiative?.pending?.opportunityId ? { opportunityId: source.initiative.pending.opportunityId } : {}) };
  return committed;
}
