"use client";

import { useEffect, useState } from "react";
import { DzmmBillingError, fetchDzmmBillingUsage, type DzmmBillingUsage } from "../../lib/dzmm-billing-client";
import s from "./chat-billing-status.module.css";
import { XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";

export type ChatBillingStatusProps = {
  accountId?: string;
  isGuest: boolean;
  enabled: boolean;
  refreshKey: number;
  modelMinCredits?: number;
  modelLabel?: string;
  onSwitchEconomy?: () => void;
  onRequireAccount: () => void;
  onRecharge?: () => void;
  onUsage?: (usage: DzmmBillingUsage | null) => void;
};

type BalanceRead = {
  key: string;
  usage: DzmmBillingUsage | null;
  readAt: number;
  loading: boolean;
  error: string;
  requiresAccount: boolean;
};
const points = (value: number) => value.toLocaleString("zh-CN");
function hasUnsettledUsage(usage: DzmmBillingUsage, readAt: number) {
  return usage.reservedCredits > 0 || usage.items.some(item =>
    (item.status === "reserved" || item.status === "pending") && item.expiresAt > readAt);
}

export function ChatBillingStatus({
  accountId,
  isGuest,
  enabled,
  refreshKey,
  modelMinCredits = 8,
  modelLabel,
  onSwitchEconomy,
  onRequireAccount,
  onRecharge,
  onUsage,
}: ChatBillingStatusProps) {
  const [retry, setRetry] = useState(0);
  const [balanceRead, setBalanceRead] = useState<BalanceRead | null>(null);
  // Guard render as well as completion: an account switch must never show an
  // earlier account's balance while its effect cleanup is still pending.
  const requestKey = JSON.stringify([accountId ?? null, isGuest, enabled, refreshKey, retry]);
  const currentRead = balanceRead?.key === requestKey ? balanceRead : null;

  useEffect(() => {
    if (!enabled || isGuest || !accountId) return;
    let stopped = false;
    let delayedRefresh: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const active = () => !stopped && !controller.signal.aborted;
    async function read(allowDelayedRefresh: boolean) {
      if (!active()) return;
      setBalanceRead(previous => ({ key: requestKey,
        usage: previous?.key === requestKey ? previous.usage : null,
        readAt: previous?.key === requestKey ? previous.readAt : 0,
        loading: true, error: "", requiresAccount: false }));
      try {
        const usage = await fetchDzmmBillingUsage(accountId!, { signal: controller.signal });
        if (!active()) return;
        const readAt = Date.now();
        setBalanceRead({ key: requestKey, usage, readAt, loading: false, error: "", requiresAccount: false });
        // One follow-up lets a just-finished generation settle. Pending usage
        // thereafter is refreshed explicitly; this is not an ongoing poll.
        if (allowDelayedRefresh && hasUnsettledUsage(usage, readAt)) {
          delayedRefresh = setTimeout(() => { void read(false); }, 2000);
        }
      } catch (failure) {
        if (!active()) return;
        setBalanceRead({ key: requestKey, usage: null, readAt: 0, loading: false,
          error: failure instanceof Error ? failure.message : "余额暂时无法读取，请重试。",
          requiresAccount: failure instanceof DzmmBillingError && (failure.status === 401 || failure.status === 403) });
      }
    }
    void read(true);
    return () => { stopped = true; controller.abort(); clearTimeout(delayedRefresh); };
  }, [accountId, isGuest, enabled, requestKey]);

  useEffect(() => {
    onUsage?.(enabled && !isGuest && accountId ? currentRead?.usage ?? null : null);
  }, [accountId, isGuest, enabled, currentRead?.usage, onUsage]);

  if (!enabled || isGuest || !accountId) return null;

  const usage = currentRead?.usage;
  const loading = !currentRead || currentRead.loading;
  const floor = Math.max(8, modelMinCredits);
  const belowCurrentModel = Boolean(usage && usage.availableBalance > 0 && usage.availableBalance < floor);
  const lowBalance = Boolean(usage && usage.availableBalance >= floor && usage.availableBalance < Math.max(floor * 2, 24));
  const emptyOrDebt = Boolean(usage && (usage.availableBalance <= 0 || usage.debtCredits > 0));
  const canSwitchEconomy = belowCurrentModel && floor > 8 && Boolean(usage && usage.availableBalance >= 8) && Boolean(onSwitchEconomy);
  const needsAttention = Boolean(currentRead?.error) || emptyOrDebt || belowCurrentModel || lowBalance;
  if (!needsAttention) return null;

  return <div className={`${s.status} ${emptyOrDebt ? s.statusAlert : belowCurrentModel || lowBalance ? s.statusWarn : ""}`} aria-busy={loading}>
    <div className={s.balance} role="status" aria-live="polite">
      {usage ? <>
        <p>可用 <strong>{points(usage.availableBalance)} 金币</strong>
          {belowCurrentModel && <span className={s.hint}> · 当前「{modelLabel ?? "所选模型"}」需 {floor} 金币起</span>}
          {lowBalance && <span className={s.hint}> · 约还可聊 1 轮</span>}
          {loading && <span> · 刷新中…</span>}
        </p>
        {usage.debtCredits > 0 && <p className={s.pending}>待补足 {points(usage.debtCredits)} 金币，请查看余额与消费记录。{!XUMENG_PAYMENTS_ENABLED && "收款暂时关闭。"}</p>}
      </> : <p className={currentRead?.error ? s.error : undefined}>
        {currentRead?.error || "正在读取金币余额…"}
      </p>}
    </div>
    <div className={s.actions}>
      {canSwitchEconomy && (
        <button type="button" className={s.switchBtn} onClick={onSwitchEconomy}>
          切微光 1×（8币起）
        </button>
      )}
      {(currentRead?.error || emptyOrDebt) && (
        <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>
          {loading ? "读取中…" : currentRead?.error ? "重试余额" : "刷新"}
        </button>
      )}
      {currentRead?.requiresAccount && <button type="button" onClick={onRequireAccount}>重新登录</button>}
      {onRecharge && (
        <button type="button" className={s.rechargeBtn} onClick={onRecharge}>
          {XUMENG_PAYMENTS_ENABLED ? "快捷充值（¥6 起）" : "余额与明细"}
        </button>
      )}
    </div>
  </div>;
}
