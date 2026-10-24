"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDzmmCheckout, DzmmPaymentError, fetchDzmmPaymentConfig, fetchDzmmPaymentOrder,
  fetchDzmmPaymentWallet, isDzmmCheckoutUrl, type DzmmPaymentConfig,
  type DzmmPaymentMethod, type DzmmPaymentOrder, type DzmmPaymentStatus, type DzmmPaymentWallet,
} from "../../lib/dzmm-payments";
import Icon from "./icons";
import { SubscriptionCenter } from "./subscription-center";
import { BillingCenter } from "./billing-center";
import s from "./recharge.module.css";
import { XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";

export type RechargeProps = {
  userId: string; isGuest: boolean; onRequireAccount: () => void;
  returnOrderId?: string; cancelled?: boolean; onBack?: () => void; focusVip?: boolean;
};
const STATUS: Record<DzmmPaymentStatus, string> = {
  pending: "待支付确认", paid: "已到账", partially_refunded: "部分退款", refunded: "已退款", expired: "已过期", failed: "未完成支付",
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "充值服务暂时不可用，请稍后再试。";
const points = (value: number) => value.toLocaleString("zh-CN");
function money(amountMinor: number, currency: string) {
  const formatter = new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency.toUpperCase(), currencyDisplay: currency === "cny" ? "symbol" : "code" });
  return formatter.format(amountMinor / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function Recharge({ userId, isGuest, onRequireAccount, returnOrderId, cancelled = false, onBack, focusVip = false }: RechargeProps) {
  const [config, setConfig] = useState<DzmmPaymentConfig | null>(null);
  const [wallet, setWallet] = useState<DzmmPaymentWallet | null>(null);
  const [selected, setSelected] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<DzmmPaymentMethod | "">("");
  const [loading, setLoading] = useState(true);
  const [billingRefresh, setBillingRefresh] = useState(0);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [error, setError] = useState("");
  const [inspectedOrderId, setInspectedOrderId] = useState<string | null>(null);
  const [order, setOrder] = useState<DzmmPaymentOrder | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [verificationTimedOut, setVerificationTimedOut] = useState(false);
  const [verificationRetry, setVerificationRetry] = useState(0);
  const mounted = useRef(false);
  const account = useRef("");
  const generation = useRef(0);
  const walletRead = useRef(0);
  const walletApplied = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const checkoutController = useRef<AbortController | null>(null);
  const verificationController = useRef<AbortController | null>(null);
  const paymentContext = useRef("");
  const pending = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const accountKey = `${userId}:${isGuest}`;
  account.current = accountKey;
  const subscriptionReturnId = returnOrderId?.startsWith("sp_") ? returnOrderId : undefined;
  const activeOrderId = inspectedOrderId ?? (subscriptionReturnId ? undefined : returnOrderId);
  const paymentKey = config ? `${accountKey}:${config.provider}:${config.mode}` : "";
  const configuredMode = config?.mode;
  const configuredProvider = config?.provider;
  const currentWallet = !isGuest && config && wallet?.accountId === userId && wallet.mode === config.mode && wallet.provider === config.provider ? wallet : null;
  const currentOrder = !isGuest && config && order?.accountId === userId && order.mode === config.mode && order.id === activeOrderId ? order : null;
  const packageId = config?.packages.some(item => item.id === selected) ? selected : config?.packages[0]?.id ?? "";
  const selectedPackage = config?.packages.find(item => item.id === packageId);
  const cnyCheckout = config?.provider === "guagua";
  const wechatMethods = config?.methods.filter(item => item.id === "wxpay") ?? [];
  const wechatReady = cnyCheckout && wechatMethods.length > 0;
  const methodId = wechatMethods.some(item => item.id === selectedMethod) ? selectedMethod : wechatMethods[0]?.id ?? "";
  const canResume = (entry: DzmmPaymentOrder) => XUMENG_PAYMENTS_ENABLED && !!config?.enabled && entry.provider === "guagua"
    && entry.provider === config.provider && entry.mode === config.mode && entry.status === "pending" && !!entry.checkoutUrl
    && entry.method === "wxpay" && config.methods.some(item => item.id === entry.method);

  const refresh = useCallback(async () => {
    const epoch = ++generation.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    setLoading(true); setError(""); setBillingRefresh(value => value + 1);
    try {
      const configuration = await fetchDzmmPaymentConfig(controller.signal);
      if (!mounted.current || account.current !== accountKey || generation.current !== epoch) return;
      const nextContext = `${accountKey}:${configuration.provider}:${configuration.mode}`;
      if (paymentContext.current !== nextContext) {
        paymentContext.current = nextContext;
        checkoutController.current?.abort(); checkoutController.current = null;
        verificationController.current?.abort();
        pending.current = false; requestIds.current.clear();
        setCheckoutBusy(false); setWallet(null); setOrder(null); setInspectedOrderId(null); setSelected(""); setSelectedMethod("");
        setVerifying(false); setVerificationError(""); setVerificationTimedOut(false);
      }
      setConfig(configuration);
      const walletEpoch = ++walletRead.current;
      const balance = isGuest ? null : await fetchDzmmPaymentWallet(controller.signal, { accountId: userId, mode: configuration.mode, provider: configuration.provider });
      if (!mounted.current || account.current !== accountKey || generation.current !== epoch || paymentContext.current !== nextContext) return;
      if (walletEpoch > walletApplied.current) { walletApplied.current = walletEpoch; setWallet(balance); }
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current && account.current === accountKey && generation.current === epoch) setError(errorText(failure));
    } finally {
      if (mounted.current && account.current === accountKey && generation.current === epoch) setLoading(false);
    }
  }, [accountKey, isGuest, userId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false; generation.current += 1;
      refreshController.current?.abort(); checkoutController.current?.abort(); verificationController.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (isGuest || !activeOrderId || !configuredMode || !configuredProvider || paymentContext.current !== paymentKey) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    verificationController.current = controller;
    const mode = configuredMode;
    const provider = configuredProvider;
    const deadline = Date.now() + 60_000;
    const cancellation = cancelled && activeOrderId === returnOrderId;
    const active = () => !stopped && !controller.signal.aborted && mounted.current && account.current === accountKey && paymentContext.current === paymentKey;
    async function verify() {
      setVerifying(true); setVerificationError(""); setVerificationTimedOut(false);
      try {
        const walletEpoch = ++walletRead.current;
        const result = await fetchDzmmPaymentOrder(activeOrderId as string, controller.signal, { accountId: userId, mode, provider });
        if (!active()) return;
        if (result.accountId !== userId) throw new Error("账户已切换，请登录订单所属账号后查看。");
        setOrder(result.order);
        if (walletEpoch > walletApplied.current) { walletApplied.current = walletEpoch; setWallet(result); }
        if (result.order.status === "pending" && !cancellation && Date.now() < deadline) {
          timer = setTimeout(() => { void verify(); }, 3000);
          return;
        }
        setVerificationTimedOut(result.order.status === "pending" && !cancellation);
      } catch (failure) {
        if (!active() || controller.signal.aborted) return;
        if (failure instanceof DzmmPaymentError && failure.status >= 500 && !cancellation && Date.now() < deadline) {
          timer = setTimeout(() => { void verify(); }, 3000);
          return;
        }
        setVerificationError(errorText(failure));
      }
      if (active()) setVerifying(false);
    }
    void verify();
    return () => { stopped = true; controller.abort(); if (verificationController.current === controller) verificationController.current = null; if (timer) clearTimeout(timer); };
  }, [accountKey, activeOrderId, cancelled, configuredMode, configuredProvider, isGuest, paymentKey, returnOrderId, userId, verificationRetry]);

  async function checkout() {
    if (!XUMENG_PAYMENTS_ENABLED || pending.current || loading || checkoutBusy) return;
    if (isGuest) { onRequireAccount(); return; }
    if (!config?.enabled || config.provider !== "guagua" || !selectedPackage || methodId !== "wxpay" || paymentContext.current !== paymentKey) return;
    pending.current = true; setCheckoutBusy(true); setError("");
    const captured = accountKey;
    const capturedContext = paymentKey;
    const requestKey = `${capturedContext}:${methodId}:${packageId}`;
    let redirecting = false;
    const controller = new AbortController();
    checkoutController.current = controller;
    try {
      let requestId = requestIds.current.get(requestKey);
      if (!requestId) { requestId = crypto.randomUUID(); requestIds.current.set(requestKey, requestId); }
      const body = { packageId, accountId: userId, requestId, mode: config.mode, provider: "guagua" as const, method: methodId as DzmmPaymentMethod };
      const result = await createDzmmCheckout(body, controller.signal, selectedPackage);
      if (controller.signal.aborted || !mounted.current || account.current !== captured || paymentContext.current !== capturedContext) return;
      if (result.order.status !== "pending") {
        requestIds.current.delete(requestKey);
        setInspectedOrderId(result.order.id); setVerificationRetry(previous => previous + 1);
        return;
      }
      if (!isDzmmCheckoutUrl(result.checkoutUrl, config.provider, result.order.id)) throw new Error("支付地址未通过验证，请重新读取订单。");
      window.location.assign(result.checkoutUrl);
      redirecting = true;
    } catch (failure) {
      if (failure instanceof DzmmPaymentError && failure.status === 409) { requestIds.current.delete(requestKey); void refresh(); }
      if (!controller.signal.aborted && mounted.current && account.current === captured && paymentContext.current === capturedContext) setError(errorText(failure));
    } finally {
      if (!redirecting && checkoutController.current === controller) {
        checkoutController.current = null;
        pending.current = false;
        if (mounted.current && account.current === captured && paymentContext.current === capturedContext) setCheckoutBusy(false);
      }
    }
  }

  async function resumePayment(entry: DzmmPaymentOrder) {
    if (!XUMENG_PAYMENTS_ENABLED) return;
    if (isGuest) { onRequireAccount(); return; }
    if (pending.current || checkoutBusy || loading || !config?.enabled || paymentContext.current !== paymentKey
      || entry.accountId !== userId || !canResume(entry)) return;
    if (!isDzmmCheckoutUrl(entry.checkoutUrl, entry.provider, entry.id)) { setError("该订单暂时不能继续支付，请刷新订单状态。"); return; }
    pending.current = true; setCheckoutBusy(true); setError("");
    const capturedContext = paymentKey;
    const controller = new AbortController();
    checkoutController.current = controller;
    let redirecting = false;
    try {
      const latestConfig = await fetchDzmmPaymentConfig(controller.signal);
      if (latestConfig.mode !== entry.mode || latestConfig.provider !== entry.provider || !latestConfig.enabled
        || ((entry.provider === "zpay" || entry.provider === "guagua") && !latestConfig.methods.some(item => item.id === entry.method))) {
        throw new DzmmPaymentError(409, latestConfig.enabled ? "支付渠道或方式已变更，请刷新余额与套餐后重试。" : "支付暂未开放，请刷新套餐后再试。");
      }
      const result = await fetchDzmmPaymentOrder(entry.id, controller.signal, { accountId: userId, mode: entry.mode, provider: entry.provider });
      if (controller.signal.aborted || !mounted.current || account.current !== accountKey || paymentContext.current !== capturedContext) return;
      if (result.order.status !== "pending") {
        setInspectedOrderId(result.order.id); setOrder(result.order); setVerificationRetry(previous => previous + 1);
        return;
      }
      if (result.order.provider !== entry.provider || result.order.method !== entry.method
        || !isDzmmCheckoutUrl(result.order.checkoutUrl, entry.provider, entry.id)) throw new Error("该订单暂时不能继续支付，请刷新订单状态。");
      window.location.assign(result.order.checkoutUrl);
      redirecting = true;
    } catch (failure) {
      if (failure instanceof DzmmPaymentError && failure.status === 409) void refresh();
      if (!controller.signal.aborted && mounted.current && account.current === accountKey && paymentContext.current === capturedContext) setError(errorText(failure));
    } finally {
      if (!redirecting && checkoutController.current === controller) {
        checkoutController.current = null; pending.current = false;
        if (mounted.current && account.current === accountKey && paymentContext.current === capturedContext) setCheckoutBusy(false);
      }
    }
  }

  const working = loading || checkoutBusy;
  const checkoutMessage = config?.enabled
    ? wechatReady ? "使用微信支付。扣款成功后，由本站确认再发放 Credit。"
      : "Credit 充值目前只接受微信支付。"
    : config?.note || "微信支付暂未开通。";
  const checkoutLabel = checkoutBusy ? "正在创建订单…" : !config?.enabled
    ? "微信支付暂未开通"
    : isGuest ? "登录后充值" : "微信支付";
  const cancelledReturn = cancelled && activeOrderId === returnOrderId;
  let orderMessage = verifying ? "正在向服务器核对订单，支付返回链接本身不会增加余额。" : "订单状态以服务器记录为准。";
  if (currentOrder?.status === "paid") orderMessage = `已确认到账 ${points(currentOrder.credits)} 充值点数。余额已读取服务器最新记录。`;
  else if (currentOrder?.status === "partially_refunded") orderMessage = `订单已部分退款，已退回 ${points(currentOrder.refundedCredits)} 点对应的款项，余额已更新。`;
  else if (currentOrder?.status === "refunded") orderMessage = "订单已退款，充值余额已按服务器记录更新。";
  else if (currentOrder?.status === "expired") orderMessage = XUMENG_PAYMENTS_ENABLED ? "该订单已过期，可以重新选择套餐充值。" : "该订单已过期。收款暂时关闭，历史记录仍保留。";
  else if (currentOrder?.status === "failed") orderMessage = "该订单尚未完成付款，请查看订单状态后重新操作。";
  else if (cancelledReturn && !verifying) orderMessage = XUMENG_PAYMENTS_ENABLED ? "你已退出支付页面。订单尚未确认到账，可继续支付或稍后核对。" : "你已返回本站。收款暂时关闭，已付款可稍后核对原订单。";
  else if (verificationTimedOut) orderMessage = "暂未收到到账确认，请稍后重新核对订单。充值余额以服务器记录为准。";

  const channelName = (provider: string, method: string | null) => method === "wxpay" || provider === "guagua" ? "微信支付" : provider === "nowpayments" ? "USDT" : "历史订单";
  const membership = <SubscriptionCenter userId={userId} isGuest={isGuest} paymentConfig={config} returnOrderId={subscriptionReturnId}
    refreshKey={billingRefresh}
    cancelled={cancelled && !!subscriptionReturnId} onRequireAccount={onRequireAccount} onCreditChanged={() => { void refresh(); }} />;
  return <main className={s.page}>
    <header className={s.header}>
      <div>
        {onBack && <button type="button" className={s.back} onClick={onBack}><Icon name="back" size={15} />返回</button>}
        <h1>{focusVip ? "会员" : "充值"}</h1>
        <p>微信支付购买 Credit。会员可用微信或 USDT。</p>
      </div>
      <button type="button" className={s.outline} disabled={working} onClick={() => void refresh()}>{loading ? "读取中…" : "刷新"}</button>
    </header>

    {!XUMENG_PAYMENTS_ENABLED && <p className={s.notice} role="note">新的付款暂未开放。已有余额、订单和会员仍可查看。</p>}
    {XUMENG_PAYMENTS_ENABLED && config && !config.enabled && <p className={s.notice} role="note">{config.note || "微信支付暂未开通。已有余额和订单仍可查看。"}</p>}

    <section className={s.balance} aria-label="Credit 余额">
      <span>可用</span>
      <strong>{currentWallet ? points(currentWallet.balance) : "—"}<small>Credit</small></strong>
      <p>{config?.modelBillingLinked ? "聊天按实际用量扣费。预留中的 Credit 不计入可用余额。" : "任务奖励、每日领取和购买进入同一余额。"}</p>
    </section>

    {isGuest && <section className={s.guest}><div><strong>登录后充值</strong><p>余额和订单保存在账户里。</p></div><button type="button" className={s.primary} onClick={onRequireAccount}>登录</button></section>}
    {error && <p className={s.error} role="alert">{error}</p>}
    {activeOrderId && <section className={s.returnState} aria-live="polite" aria-label="支付返回订单状态">
      <div className={s.returnTitle}><h2>{currentOrder ? STATUS[currentOrder.status] : cancelledReturn ? "已返回" : "正在核对"}</h2>{verifying && <span className={s.polling}>核对中</span>}</div>
      <p>{isGuest ? "登录订单所属账号后，可以核对是否到账。" : orderMessage}</p>
      <details className={s.orderId}><summary>订单编号</summary><code>{activeOrderId}</code></details>
      {verificationError && <p className={s.error} role="alert">{verificationError}</p>}
      <div className={s.returnActions}>
        {!isGuest && <button type="button" className={s.outline} disabled={verifying || checkoutBusy} onClick={() => setVerificationRetry(previous => previous + 1)}>重新核对</button>}
        {currentOrder && canResume(currentOrder) && <button type="button" className={s.primary} disabled={working || verifying} onClick={() => void resumePayment(currentOrder)}>继续支付</button>}
        {isGuest && <button type="button" className={s.outline} onClick={onRequireAccount}>登录查看</button>}
      </div>
    </section>}

    {focusVip && membership}

    {XUMENG_PAYMENTS_ENABLED && !focusVip && <section className={s.purchase} aria-labelledby="recharge-packages-title">
      <div className={s.sectionHeading}><h2 id="recharge-packages-title">购买 Credit</h2><span>微信支付</span></div>
      {config ? config.packages.length ? <>
        <fieldset className={s.packages} disabled={working}>
          <legend className={s.srOnly}>Credit 购买档位</legend>
          {config.packages.map(item => <label className={`${s.package} ${packageId === item.id ? s.selected : ""}`} key={item.id}>
            <input type="radio" name="recharge-package" value={item.id} checked={packageId === item.id} onChange={() => setSelected(item.id)} />
            <span className={s.packageCredits}>{points(item.credits)}<small>Credit</small></span>
            <span className={s.packagePrice}>{money(item.amountMinor, item.currency)}</span>
          </label>)}
        </fieldset>
        <div className={s.checkout}>
          <div>
            <strong>{selectedPackage ? `${points(selectedPackage.credits)} Credit · ${money(selectedPackage.amountMinor, selectedPackage.currency)}` : "请选择档位"}</strong>
            <p>{checkoutMessage}</p>
          </div>
          <button type="button" className={s.primary} disabled={working || !wechatReady || !config.enabled || !selectedPackage} onClick={() => void checkout()}>{checkoutLabel}</button>
        </div>
      </> : <p className={s.empty}>目前没有可购买的档位。</p> : <p className={s.empty}>{loading ? "正在读取档位…" : "暂时无法读取档位。"}</p>}
    </section>}

    {!focusVip && membership}

    <BillingCenter key={accountKey} userId={userId} isGuest={isGuest} modelBillingLinked={config?.modelBillingLinked ?? false} refreshKey={billingRefresh} onRequireAccount={onRequireAccount} />

    <section className={s.history} aria-labelledby="recharge-orders-title">
      <div className={s.sectionHeading}><h2 id="recharge-orders-title">订单</h2><span>{currentWallet ? `${currentWallet.orders.length}` : ""}</span></div>
      {isGuest ? <p className={s.empty}>登录后查看订单。</p> : currentWallet ? currentWallet.orders.length ? <ul>{currentWallet.orders.map(entry => <li className={s.order} key={entry.id}>
        <div className={s.orderMain}>
          <strong>{money(entry.amountMinor, entry.currency)}<span>{points(entry.credits)} Credit</span></strong>
          <time dateTime={new Date(entry.createdAt).toISOString()}>{date(entry.createdAt)} · {channelName(entry.provider, entry.method)}</time>
        </div>
        <div className={s.orderAction}>
          <span className={entry.status === "paid" ? s.paid : s.orderStatus}>{STATUS[entry.status]}</span>
          <button type="button" className={s.textButton} disabled={checkoutBusy} onClick={() => { setInspectedOrderId(entry.id); setVerificationRetry(previous => previous + 1); }}>核对</button>
          {canResume(entry) && <button type="button" className={s.outline} disabled={working} onClick={() => void resumePayment(entry)}>继续支付</button>}
        </div>
      </li>)}</ul> : <p className={s.empty}>还没有订单。</p> : <p className={s.empty}>{loading ? "正在读取订单…" : "暂时无法读取订单。"}</p>}
    </section>
  </main>;
}
