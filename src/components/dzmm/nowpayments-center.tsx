"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canRetryDzmmNowPaymentsIntent, clearDzmmNowPaymentsIntent, createDzmmNowPaymentsCheckout, createDzmmNowPaymentsIntent,
  dzmmNowPaymentsStatus, fetchDzmmNowPaymentsConfig, fetchDzmmNowPaymentsOrder, recoverDzmmNowPaymentsOrder,
  formatDzmmNowPaymentsAmount, isDzmmNowPaymentsFinal, preserveDzmmNowPaymentsOrder,
  matchesDzmmNowPaymentsClipboardTarget,
  readDzmmNowPaymentsIntent, saveDzmmNowPaymentsIntent,
  type DzmmNowPaymentsConfig, type DzmmNowPaymentsIntent, type DzmmNowPaymentsOrder,
} from "../../lib/dzmm-nowpayments";
import { paymentAddressQrDataUrl } from "../../lib/xumeng-payment-qr";
import Icon from "./icons";
import s from "./nowpayments-center.module.css";

type Props = { userId: string; isGuest: boolean; refreshKey?: number; onRequireAccount: () => void; onCreditChanged?: () => void };
const message = (failure: unknown) => failure instanceof Error ? failure.message : "原购买结果暂时无法核对，请稍后刷新。";

export function NowPaymentsCenter({ userId, isGuest, refreshKey = 0, onRequireAccount, onCreditChanged }: Props) {
  const [config, setConfig] = useState<DzmmNowPaymentsConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const [intent, setIntent] = useState<DzmmNowPaymentsIntent | null>(null);
  const [intentReady, setIntentReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [order, setOrder] = useState<DzmmNowPaymentsOrder | null>(null);
  const [returnOrderId, setReturnOrderId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(false), epoch = useRef(0), context = useRef("");
  const activeIntent = useRef<DzmmNowPaymentsIntent | null>(null), observedOrder = useRef<DzmmNowPaymentsOrder | null>(null);
  const configController = useRef<AbortController | null>(null), actionController = useRef<AbortController | null>(null);
  const actionPending = useRef(false), activated = useRef(new Set<string>()), changed = useRef(onCreditChanged);
  const clipboardEpoch = useRef(0);
  const owner = `${userId}:${isGuest}`; context.current = owner; changed.current = onCreditChanged;
  const ownIntent = !isGuest && intent?.request.accountId === userId ? intent : null;
  const ownOrder = !isGuest && order?.accountId === userId ? order : null;
  const plan = config?.plans[0];
  const ready = config?.enabled === true && !!config.payCurrency && !!plan;
  const hasUnresolved = !!ownIntent || (!!ownOrder && !isDzmmNowPaymentsFinal(ownOrder)) || (!!returnOrderId && !ownOrder);
  const receipt = ownOrder ? dzmmNowPaymentsStatus(ownOrder) : null;
  const shouldPoll = !!ownOrder && !isDzmmNowPaymentsFinal(ownOrder);
  const canRetryOriginal = canRetryDzmmNowPaymentsIntent(ownIntent, config, ownOrder, notFound);
  const duration = plan ? plan.durationDays === 90 ? "3 个月（90 天）" : `${plan.durationDays} 天` : "核对会员周期中";
  const paymentQr = useMemo(() => {
    if (!ownOrder?.payAddress) return null;
    try { return paymentAddressQrDataUrl(ownOrder.payAddress); } catch { return null; }
  }, [ownOrder?.payAddress]);

  const applyOrder = useCallback((incoming: DzmmNowPaymentsOrder, saved: DzmmNowPaymentsIntent | null) => {
    if (!mounted.current || context.current !== owner || incoming.accountId !== userId) return;
    const next = preserveDzmmNowPaymentsOrder(incoming, observedOrder.current);
    if (observedOrder.current?.id !== next.id || observedOrder.current.payAddress !== next.payAddress) { clipboardEpoch.current++; setCopied(false); }
    observedOrder.current = next; setOrder(next); setNotFound(false);
    if (saved && saved.request.requestId === next.requestId && isDzmmNowPaymentsFinal(next)) {
      try {
        if (!clearDzmmNowPaymentsIntent(window.sessionStorage, saved, next)) throw new Error("原购买记录已变化，暂不能开始新的购买。请继续核对原记录。");
        activeIntent.current = null; setIntent(null); setStorageError("");
      } catch (failure) { setStorageError(message(failure)); }
    }
    if (next.status === "paid" && next.membershipActivated && !activated.current.has(next.id)) {
      activated.current.add(next.id); changed.current?.();
    }
  }, [owner, userId]);

  const loadConfig = useCallback(async () => {
    configController.current?.abort();
    const controller = new AbortController(); configController.current = controller;
    const generation = epoch.current;
    setConfigLoading(true); setConfigError("");
    try {
      const next = await fetchDzmmNowPaymentsConfig(controller.signal);
      if (mounted.current && !controller.signal.aborted && context.current === owner && epoch.current === generation) setConfig(next);
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && context.current === owner && epoch.current === generation) {
        setConfig(null); setConfigError(message(failure));
      }
    } finally {
      if (configController.current === controller && mounted.current && context.current === owner && epoch.current === generation) setConfigLoading(false);
    }
  }, [owner]);

  const restore = useCallback(async (explicit?: DzmmNowPaymentsIntent | null, orderId?: string | null, retainedError = "") => {
    if (isGuest || !mounted.current || context.current !== owner || actionPending.current) return;
    const saved = explicit === undefined ? activeIntent.current : explicit;
    const target = orderId ?? observedOrder.current?.id ?? returnOrderId;
    if (!saved && !target) return;
    const controller = new AbortController(); actionController.current = controller; actionPending.current = true;
    const generation = epoch.current;
    setWorking(true); setReceiptError(retainedError); setNotFound(false);
    try {
      // Recovery is strictly read-only, including after a timeout or a reload.
      const found = saved ? await recoverDzmmNowPaymentsOrder(saved, observedOrder.current, controller.signal)
        : await fetchDzmmNowPaymentsOrder(userId, target!, controller.signal);
      if (!mounted.current || controller.signal.aborted || context.current !== owner || epoch.current !== generation) return;
      if (found) { applyOrder(found, saved); setReceiptError(""); } else setNotFound(true);
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && context.current === owner && epoch.current === generation) setReceiptError(retainedError || message(failure));
    } finally {
      if (actionController.current === controller) {
        actionController.current = null; actionPending.current = false;
        if (mounted.current && context.current === owner && epoch.current === generation) setWorking(false);
      }
    }
  }, [applyOrder, isGuest, owner, returnOrderId, userId]);
  const restoreRef = useRef(restore); restoreRef.current = restore;

  useEffect(() => {
    mounted.current = true; epoch.current++;
    activeIntent.current = null; observedOrder.current = null; activated.current.clear();
    clipboardEpoch.current++;
    actionPending.current = false; setWorking(false); setOrder(null); setIntent(null); setStorageError("");
    setReceiptError(""); setNotFound(false); setCopied(false); setIntentReady(false); setConfig(null);
    let saved: DzmmNowPaymentsIntent | null = null;
    if (!isGuest) {
      try { saved = readDzmmNowPaymentsIntent(window.sessionStorage, userId); activeIntent.current = saved; setIntent(saved); }
      catch (failure) { setStorageError(message(failure)); }
    }
    setIntentReady(true);
    const returned = new URLSearchParams(window.location.search).get("np_order");
    const validReturn = returned && /^sp_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(returned) ? returned : null;
    setReturnOrderId(validReturn);
    void loadConfig();
    if (!isGuest && (saved || validReturn)) void restoreRef.current(saved, validReturn);
    return () => { mounted.current = false; epoch.current++; configController.current?.abort(); actionController.current?.abort(); };
  }, [isGuest, loadConfig, userId]);

  const previousRefresh = useRef(refreshKey);
  useEffect(() => {
    if (previousRefresh.current === refreshKey) return;
    previousRefresh.current = refreshKey; void loadConfig();
  }, [loadConfig, refreshKey]);

  useEffect(() => {
    if (!shouldPoll) return;
    let polls = 0;
    const timer = setInterval(() => { if (++polls <= 20) void restoreRef.current(); else clearInterval(timer); }, 15_000);
    return () => clearInterval(timer);
  }, [ownOrder?.id, shouldPoll, owner]);

  async function purchase() {
    if (isGuest) { onRequireAccount(); return; }
    if (!ready || configLoading || !plan || !intentReady || storageError || hasUnresolved || actionPending.current || working || !mounted.current) return;
    clipboardEpoch.current++; setCopied(false);
    let saved: DzmmNowPaymentsIntent;
    try {
      saved = createDzmmNowPaymentsIntent(userId, plan, config!.payCurrency);
      activeIntent.current = saved; setIntent(saved);
      // Synchronous write + readback happen before the first network mutation.
      saveDzmmNowPaymentsIntent(window.sessionStorage, saved); setStorageError("");
    } catch (failure) { setStorageError(message(failure)); return; }
    observedOrder.current = null; setOrder(null);
    await submitOriginal(saved);
  }

  async function retryOriginal() {
    const saved = activeIntent.current;
    if (isGuest || !mounted.current || context.current !== owner || actionPending.current || working || configLoading || storageError
      || !canRetryDzmmNowPaymentsIntent(saved, config, observedOrder.current, notFound)) return;
    try { saveDzmmNowPaymentsIntent(window.sessionStorage, saved!); }
    catch (failure) { setStorageError(message(failure)); return; }
    await submitOriginal(saved!);
  }

  async function submitOriginal(saved: DzmmNowPaymentsIntent) {
    const controller = new AbortController(); actionController.current = controller; actionPending.current = true;
    const generation = epoch.current;
    setWorking(true); setReceiptError(""); setNotFound(false); setCopied(false);
    let failureMessage = "";
    try {
      const next = await createDzmmNowPaymentsCheckout(saved, controller.signal);
      if (mounted.current && !controller.signal.aborted && context.current === owner && epoch.current === generation) applyOrder(next, saved);
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && context.current === owner && epoch.current === generation) {
        failureMessage = message(failure); setReceiptError(failureMessage);
      }
    } finally {
      if (actionController.current === controller) {
        actionController.current = null; actionPending.current = false;
        if (mounted.current && context.current === owner && epoch.current === generation) setWorking(false);
      }
    }
    if (failureMessage && mounted.current && context.current === owner && epoch.current === generation) void restoreRef.current(saved, undefined, failureMessage);
  }

  function retryStorage() {
    if (working || isGuest || !mounted.current || context.current !== owner) return;
    try {
      const cached = readDzmmNowPaymentsIntent(window.sessionStorage, userId);
      const saved = activeIntent.current ?? cached;
      if (saved) { saveDzmmNowPaymentsIntent(window.sessionStorage, saved); activeIntent.current = saved; setIntent(saved); }
      setStorageError(""); setIntentReady(true);
      if (saved || returnOrderId) void restoreRef.current(saved, returnOrderId);
    } catch (failure) { setStorageError(message(failure)); }
  }

  async function copyAddress() {
    if (!ownOrder?.payAddress || !mounted.current || context.current !== owner) return;
    const address = ownOrder.payAddress, captured = ownOrder, generation = epoch.current, copyVersion = ++clipboardEpoch.current;
    const current = () => mounted.current && context.current === owner && epoch.current === generation && clipboardEpoch.current === copyVersion
      && matchesDzmmNowPaymentsClipboardTarget(observedOrder.current, captured, activeIntent.current?.request.requestId ?? null);
    try { await navigator.clipboard.writeText(address); if (current()) setCopied(true); }
    catch { if (current()) setReceiptError("地址未能自动复制，请选中下方完整地址复制后再核对。"); }
  }

  return <section className={s.section} aria-labelledby="nowpayments-title">
    <div className={s.heading}><div><h3 id="nowpayments-title">USDT</h3><p>{duration} · 用钱包转账，确认后开通</p></div>
      <button type="button" className={s.outline} disabled={configLoading || working} onClick={() => void loadConfig()}><Icon name="refresh" size={14} />{configLoading ? "读取中…" : "刷新购买状态"}</button></div>
    <div className={s.offer}><div><strong>{plan ? formatDzmmNowPaymentsAmount(plan.amountAtomic, plan.decimals) : "—"}<span> USDT / {duration}</span></strong><p>{plan ? `每天手动领取 ${plan.dailyCredits.toLocaleString("zh-CN")} Credit，每期最多 ${plan.maxClaims} 次；漏领不补。` : "正在核对会员方案。"}</p></div>
      <span className={ready ? s.open : s.closed}>{configLoading ? "读取中" : ready ? "可购买" : "暂未开放"}</span></div>
    {!ready && !configLoading && <p className={s.note}>USDT 购买暂未开放，已有会员权益与余额继续保留。</p>}
    {configError && <p className={s.error} role="status">{configError}</p>}
    <p className={s.rules}>确认付款金额、币种和网络后，用自己的钱包手动转账。链上确认后由服务器开通会员；提前续订会接续当前有效期，不会自动扣款。</p>
    <button type="button" className={s.primary} disabled={!ready || configLoading || working || !intentReady || !!storageError || hasUnresolved} onClick={() => void purchase()}>
      {working ? "正在核对…" : !ready ? "购买暂未开放" : isGuest ? "登录后购买 VIP" : hasUnresolved ? "先核对原购买记录" : `购买 / 续订 · ${plan ? formatDzmmNowPaymentsAmount(plan.amountAtomic, plan.decimals) : ""} USDT`}</button>
    {storageError && <div className={s.error} role="alert"><p>{storageError}</p><button type="button" className={s.outline} disabled={working} onClick={retryStorage}>恢复购买记录</button></div>}
    {(ownIntent || ownOrder || returnOrderId) && <div className={s.receipt} aria-label="USDT 购买记录" aria-live="polite" aria-busy={working}>
      <strong>{receipt?.title ?? "核对原购买记录"}</strong>
      <p>{receipt?.message ?? (notFound ? "已核对到原请求尚无订单。原方案和请求编号会保留；服务恢复后可重试这笔请求。" : "原购买请求已保留，正在核对服务器记录。")}</p>
      {(ownOrder || ownIntent) && <p>原方案：{ownOrder?.label ?? ownIntent!.plan.label} · {formatDzmmNowPaymentsAmount(ownOrder?.amountAtomic ?? ownIntent!.plan.amountAtomic, 6)} USDT / {ownOrder?.durationDays ?? ownIntent!.plan.durationDays} 天，每日领取 {ownOrder?.dailyCredits ?? ownIntent!.plan.dailyCredits} Credit，最多 {ownOrder?.maxClaims ?? ownIntent!.plan.maxClaims} 次。</p>}
      {!ready && !configLoading && ownOrder && !isDzmmNowPaymentsFinal(ownOrder) && <p>当前购买通道暂未开放，请勿继续转账；原订单仍可核对。</p>}
      {ready && !configLoading && ownOrder?.payAddress && ownOrder.payAmount && !isDzmmNowPaymentsFinal(ownOrder) && <div className={s.cashier} aria-label="USDT 付款资料">
        <dl><div><dt>准确付款金额</dt><dd>{ownOrder.payAmount} USDT</dd></div><div><dt>转账网络</dt><dd>TRON（TRC20）</dd></div></dl>
        <p>仅使用上方网络，按完整金额转账；钱包手续费另计。请勿向此地址发送其他币种或重复转账。</p>
        {paymentQr && <img className={s.qr} src={paymentQr} width={160} height={160} alt="本订单付款地址二维码" />}
        <label className={s.address}><span>本订单付款地址</span><input value={ownOrder.payAddress} readOnly aria-label="本订单 USDT 付款地址" onFocus={event => event.currentTarget.select()} /></label>
        <button type="button" className={s.outline} onClick={() => void copyAddress()}><Icon name="copy" size={14} />{copied ? "地址已复制" : "复制付款地址"}</button>
      </div>}
      {receiptError && <p className={s.error} role="alert">{receiptError}</p>}
      <div className={s.actions}><button type="button" className={s.outline} disabled={working} onClick={() => void restore()}><Icon name="refresh" size={14} />{working ? "核对中…" : "核对原订单"}</button>
        {canRetryOriginal && <button type="button" className={s.outline} disabled={working || configLoading || !!storageError} onClick={() => void retryOriginal()}>重试原购买请求</button>}</div>
      <details className={s.identifier}><summary>查看订单与请求编号</summary>{ownOrder && <code>{ownOrder.id}</code>}{ownIntent && <code>{ownIntent.request.requestId}</code>}</details>
    </div>}
  </section>;
}
