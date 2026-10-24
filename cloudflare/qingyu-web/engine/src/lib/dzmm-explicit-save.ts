export type DzmmExplicitSaveGate = {
  accountId: string | null; ready: boolean; paused: boolean; conflicted: boolean;
  persisted: boolean; storageWarning: boolean; switchingAccount: boolean;
};
export type DzmmExplicitSavePlan = "write" | "resume" | "conflict" | "incomplete" | "unsynced";

// A paused sync must not be pushed over another device's version. Explicit
// saves can resume a connection failure in place; a version conflict cannot.
export function planDzmmExplicitSave(gate: DzmmExplicitSaveGate): DzmmExplicitSavePlan {
  if (gate.conflicted) return gate.persisted && !gate.storageWarning ? "conflict" : "incomplete";
  // A full browser store can still accept a cloud write when sync is already open.
  if (gate.accountId && gate.ready && !gate.paused) return "write";
  if (!gate.persisted || gate.storageWarning) return "incomplete";
  if (gate.accountId && !gate.switchingAccount) return "resume";
  return "unsynced";
}

export function dzmmExplicitSaveStopMessage(plan: "conflict" | "incomplete" | "unsynced") {
  if (plan === "conflict") return "云端已有其他修改，本地草稿已保留。请先加载云端版本，再继续保存或提交。";
  if (plan === "incomplete") return "草稿仍在当前页面，本地备份未完整保存。请先导出记录，再重新同步。";
  return "草稿已保存在本地备份，云端尚未同步。请重新同步后再试。";
}
