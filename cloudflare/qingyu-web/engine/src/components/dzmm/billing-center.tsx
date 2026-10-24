"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchDzmmBillingConfig, fetchDzmmBillingUsage, type DzmmBillingConfig,
  type DzmmBillingUsage, type DzmmBillingUsageItem,
} from "../../lib/dzmm-billing-client";
import Icon from "./icons";
import { XUMENG_GENERATION_WORKSPACE_ENABLED } from "../../lib/xumeng-feature-availability";
import s from "./billing-center.module.css";

type Props = { userId: string; isGuest: boolean; modelBillingLinked: boolean; refreshKey: number; onRequireAccount: () => void };
const points = (value: number) => value.toLocaleString("zh-CN");
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const errorText = (value: unknown) => value instanceof Error ? value.message : "消费服务暂时无法读取，请稍后刷新。";
const status: Record<DzmmBillingUsageItem["status"], string> = { reserved: "预留中", pending: "等待用量核对", settled: "已结算", released: "已返还" };

/** Kept separate from payment loading: unavailable accounting must not hide reviewed packages or orders. */
export function BillingCenter({ userId, isGuest, modelBillingLinked, refreshKey, onRequireAccount }: Props) {
  const [config, setConfig] = useState<DzmmBillingConfig | null>(null);
  const [usage, setUsage] = useState<DzmmBillingUsage | null>(null);
  const [usageReadAt, setUsageReadAt] = useState(0);
  const [configError, setConfigError] = useState("");
  const [usageError, setUsageError] = useState("");
  const [usageRefreshFailed, setUsageRefreshFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const currentAccount = useRef(`${userId}:${isGuest}`);
  currentAccount.current = `${userId}:${isGuest}`;
  const mounted = useRef(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const paging = useRef<AbortController | null>(null);
  const accountKey = `${userId}:${isGuest}`;
  const currentUsage = !isGuest && usage?.accountId === userId ? usage : null;
  const linked = config ? config.enabled : modelBillingLinked;

  const refresh = useCallback(async () => {
    const read = ++epoch.current;
    controller.current?.abort(); paging.current?.abort(); paging.current = null;
    const request = new AbortController(); controller.current = request;
    setLoading(true); setLoadingMore(false); setConfigError(""); setUsageError("");
    const active = () => mounted.current && !request.signal.aborted && epoch.current === read && currentAccount.current === accountKey;
    const results = await Promise.allSettled([
      fetchDzmmBillingConfig(request.signal),
      isGuest ? Promise.resolve(null) : fetchDzmmBillingUsage(userId, { signal: request.signal }),
    ]);
    if (!active()) return;
    if (results[0].status === "fulfilled") setConfig(results[0].value);
    else { setConfig(null); setConfigError(errorText(results[0].reason)); }
    if (results[1].status === "fulfilled") {
      setUsage(results[1].value); setUsageReadAt(Date.now()); setUsageRefreshFailed(false);
    } else {
      // A failed read must not discard the user's already loaded history.
      // Keep only this account's snapshot, and label it until a fresh read succeeds.
      setUsage(previous => !isGuest && previous?.accountId === userId ? previous : null);
      setUsageRefreshFailed(true); setUsageError(errorText(results[1].reason));
    }
    setLoading(false);
  }, [accountKey, isGuest, userId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; epoch.current += 1; controller.current?.abort(); paging.current?.abort(); };
  }, [refresh, refreshKey]);

  async function loadMore() {
    if (!currentUsage?.nextCursor || usageRefreshFailed || loading || paging.current) return;
    const read = epoch.current;
    const cursor = currentUsage.nextCursor;
    const request = new AbortController(); paging.current = request;
    setLoadingMore(true); setUsageError("");
    const active = () => mounted.current && !request.signal.aborted && epoch.current === read && currentAccount.current === accountKey;
    try {
      const next = await fetchDzmmBillingUsage(userId, { cursor, signal: request.signal });
      if (!active()) return;
      setUsageReadAt(Date.now());
      setUsage(previous => {
        if (previous?.accountId !== userId || previous.nextCursor !== cursor) return previous;
        const present = new Set(previous.items.map(item => item.id));
        return { ...next, items: [...previous.items, ...next.items.filter(item => !present.has(item.id))] };
      });
    } catch (failure) { if (active()) setUsageError(errorText(failure)); }
    finally {
      if (paging.current === request) paging.current = null;
      if (active()) setLoadingMore(false);
    }
  }

  return <section className={s.section} aria-labelledby="billing-title">
    <div className={s.heading}><div><h2 id="billing-title">聊天费率与消费记录</h2><p>查看正式账户的 Token 用量和 Credit 扣费。</p></div><button type="button" className={s.outline} disabled={loading || loadingMore} onClick={() => void refresh()}><Icon name="refresh" size={14} />{loading ? "读取中…" : "刷新消费"}</button></div>
    {linked ? <div className={s.rules} role="note">
      <strong>聊天按服务器实际用量结算</strong>
      {config?.enabled ? <p>发送前会暂时预留 Credit，完成后返还未使用部分；失败且没有有效输出时不会扣费。</p> : <p>聊天扣费已接入，当前费率暂时无法读取，请刷新后查看。</p>}
      <p>每轮消息会按服务器实际用量结算，较长的上下文可能需要更多 Credit。{config?.memoryBilled ? "长对话自动整理剧情记忆也会单独计费。" : config?.enabled ? "自动整理剧情记忆不计费。" : "自动记忆计费状态以服务器配置为准。"}</p>
      <p>发送前暂时预留 Credit，完成后返还未使用部分；没有有效输出的失败请求不会扣费。超过 {config ? config.reservationTtlMs / 60_000 : 10} 分钟未完成的预留会自动返还。</p>
    </div> : <p className={s.notice} role="note">当前尚未接入聊天扣费。开放后的 Token 费率和记忆计费规则会显示在这里。</p>}
    {configError && <p className={s.error} role="status">{configError} 充值套餐与支付订单仍可单独查看。</p>}
    {currentUsage && usageRefreshFailed && <p className={s.notice} role="note">刷新未成功，以下保留上次读取的记录和统计，可能不是最新状态。请重新刷新后继续加载。</p>}
    {currentUsage && <div className={s.metrics}><span>已结算消费 <strong>{points(currentUsage.totalSpent)} Credit</strong></span><span>暂时预留 <strong>{points(currentUsage.reservedCredits)} Credit</strong></span>{currentUsage.debtCredits > 0 && <span>待补足 <strong>{points(currentUsage.debtCredits)} Credit</strong></span>}</div>}
    {isGuest ? <div className={s.guest}><p>登录后查看本人的消费记录。</p><button type="button" className={s.outline} onClick={onRequireAccount}>登录查看消费</button></div> : currentUsage?.items.length ? <ul className={s.list}>{currentUsage.items.map(item => {
      const expired = (item.status === "reserved" || item.status === "pending") && item.expiresAt <= usageReadAt;
      return <li className={s.item} key={item.id}>
      <div className={s.itemMain}><strong>{item.operation === "memory" ? "剧情记忆整理" : "角色聊天"}<span>{item.outcome === "cancelled" ? " · 已停止" : item.outcome === "failed" ? " · 生成未完成" : ""}</span></strong><time dateTime={new Date(item.createdAt).toISOString()}>{date(item.createdAt)} · {item.model}</time><p>{item.promptTokens === null ? "Token 用量待核对" : `输入 ${points(item.promptTokens)} · 输出 ${points(item.completionTokens!)} Token`}{item.usageExceedsReservation ? " · 扣费已按预留上限封顶" : ""}</p>
      {item.costPolicy && <p>按服务器实际用量结算</p>}</div>
      <div className={s.itemAmount}><strong>{item.billingExempt ? "历史免扣" : item.status === "settled" ? `−${points(item.chargedCredits)}` : item.status === "released" ? "0" : `${expired ? "历史预留" : "预留"} ${points(item.reservedCredits)}`}<small> Credit</small></strong><span>{expired ? "已到期，预留已解除" : status[item.status]}{item.returnedCredits > 0 ? ` · 返还 ${points(item.returnedCredits)}` : ""}</span></div>
    </li>;
    })}</ul> : <p className={s.empty}>{loading ? "正在读取消费记录…" : usageError ? "暂时无法读取消费记录。" : "还没有聊天消费记录。"}</p>}
    {usageError && <div className={s.error} role="status"><p>{usageError}</p>{usageRefreshFailed && <button type="button" className={s.outline} disabled={loading || loadingMore} onClick={() => void refresh()}>重新刷新消费</button>}</div>}
    <p className={s.empty}>{XUMENG_GENERATION_WORKSPACE_ENABLED ? "图片和视频的费用、预留与结果可在" : "图片与视频新生成已暂停。已有结果和费用可在"} <a href="#generation">我的生成历史</a> 查看。</p>
    {currentUsage?.nextCursor && <button type="button" className={s.outline} disabled={loading || loadingMore || usageRefreshFailed} onClick={() => void loadMore()}>{loadingMore ? "读取中…" : usageRefreshFailed ? "刷新后继续加载" : "加载更多消费"}</button>}
  </section>;
}
