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
  onRequireAccount: () => void;
  onRecharge?: () => void;
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

export function ChatBillingStatus({ accountId, isGuest, enabled, refreshKey, onRequireAccount, onRecharge }: ChatBillingStatusProps) {
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

  if (!enabled) return null;
  if (isGuest || !accountId) return <div className={s.status}>
    <p>聊天使用 Credit，登录后可查看余额。</p>
    <button type="button" onClick={onRequireAccount}>登录</button>
  </div>;

  const usage = currentRead?.usage;
  const loading = !currentRead || currentRead.loading;
  const unsettled = !!usage && hasUnsettledUsage(usage, currentRead!.readAt);
  return <div className={s.status} aria-busy={loading}>
    <div className={s.balance} role="status" aria-live="polite">
      {usage ? <>
        <p>可用 <strong>{points(usage.availableBalance)} Credit</strong>
          {usage.reservedCredits > 0 && <span> · 预留 {points(usage.reservedCredits)} Credit</span>}
          {loading && <span> · 刷新中…</span>}
        </p>
        {unsettled && <p className={s.pending}>待核对：预留金额尚未结算，可稍后刷新。</p>}
        {usage.debtCredits > 0 && <p className={s.pending}>待补足 {points(usage.debtCredits)} Credit，请查看余额与消费记录。{!XUMENG_PAYMENTS_ENABLED && "收款暂时关闭。"}</p>}
      </> : <p className={currentRead?.error ? s.error : undefined}>
        {currentRead?.error || "正在读取 Credit 余额…"}
      </p>}
    </div>
    <div className={s.actions}>
      <button type="button" disabled={loading} onClick={() => setRetry(value => value + 1)}>
        {loading ? "读取中…" : currentRead?.error ? "重试余额" : "刷新余额"}
      </button>
      {currentRead?.requiresAccount && <button type="button" onClick={onRequireAccount}>重新登录</button>}
      {onRecharge && <button type="button" onClick={onRecharge}>{XUMENG_PAYMENTS_ENABLED ? "充值" : "余额与明细"}</button>}
    </div>
  </div>;
}
