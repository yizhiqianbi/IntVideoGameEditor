"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DzmmPaymentError, type DzmmPaymentConfig, type DzmmPaymentMethod } from "../../lib/dzmm-payments";
import {
  claimDzmmSubscriptionCredit, createDzmmSubscriptionCheckout, fetchDzmmSubscriptionConfig,
  fetchDzmmSubscriptionOrder, fetchDzmmSubscriptionRequest, fetchDzmmSubscriptions, isDzmmSubscriptionCheckoutUrl,
  type DzmmSubscriptionConfig, type DzmmSubscriptionOrder, type DzmmSubscriptionOverview,
} from "../../lib/dzmm-subscriptions";
import {
  canRetryDzmmSubscriptionPurchaseIntent, clearDzmmSubscriptionPurchaseIntent, createDzmmSubscriptionPurchaseIntent,
  preserveDzmmSubscriptionFinalOrder, readDzmmSubscriptionPurchaseIntent, saveDzmmSubscriptionPurchaseIntent, type DzmmSubscriptionPurchaseIntent,
} from "../../lib/dzmm-subscription-intent";
import Icon from "./icons";
import s from "./subscription-center.module.css";
import { XUMENG_PAYMENTS_ENABLED } from "../../lib/xumeng-feature-availability";
import { NowPaymentsCenter } from "./nowpayments-center";

type Props = {
  userId: string; isGuest: boolean; paymentConfig: DzmmPaymentConfig | null;
  refreshKey?: number;
  returnOrderId?: string; cancelled?: boolean; onRequireAccount: () => void; onCreditChanged?: () => void;
};
const number = (value: number) => value.toLocaleString("zh-CN");
const money = (value: number) => new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: value % 100 === 0 ? 0 : 2 }).format(value / 100);
const date = (value: number) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const errorText = (error: unknown) => error instanceof Error ? error.message : "订阅服务暂时不可用，请稍后重试。";
const orderStatus: Record<DzmmSubscriptionOrder["status"], string> = {
  pending: "等待付款确认", paid: "付款已确认", expired: "订单已过期", failed: "付款未完成", refunded: "订单已退款",
};

export function SubscriptionCenter({ userId, isGuest, paymentConfig, refreshKey = 0, returnOrderId, cancelled = false, onRequireAccount, onCreditChanged }: Props) {
  const [config, setConfig] = useState<DzmmSubscriptionConfig | null>(null);
  const [overview, setOverview] = useState<DzmmSubscriptionOverview | null>(null);
  const [selected, setSelected] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<DzmmPaymentMethod | "">("");
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<"purchase" | "claim" | "resume" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inspectedOrder, setInspectedOrder] = useState<string | null>(null);
  const [order, setOrder] = useState<DzmmSubscriptionOrder | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [verificationRetry, setVerificationRetry] = useState(0);
  const [purchaseIntent, setPurchaseIntent] = useState<DzmmSubscriptionPurchaseIntent | null>(null);
  const [intentReady, setIntentReady] = useState(false);
  const [intentSaved, setIntentSaved] = useState(false);
  const [intentError, setIntentError] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [lookupMissing, setLookupMissing] = useState(false);
  const [recoveryOrder, setRecoveryOrder] = useState<DzmmSubscriptionOrder | null>(null);
  const mounted = useRef(false);
  const currentContext = useRef("");
  const epoch = useRef(0);
  const reads = useRef(0);
  const applied = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const verificationController = useRef<AbortController | null>(null);
  const recoveryController = useRef<AbortController | null>(null);
  const intentEpoch = useRef(0);
  const intentOwner = useRef("");
  const intentRef = useRef<DzmmSubscriptionPurchaseIntent | null>(null);
  const intentOrder = useRef<{ requestId: string; orderId: string } | null>(null);
  const observedFinalOrders = useRef(new Map<string, DzmmSubscriptionOrder>());
  const actionPending = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const onChanged = useRef(onCreditChanged);
  const observedRefresh = useRef(refreshKey);
  onChanged.current = onCreditChanged;
  const contextKey = `${userId}:${isGuest}:${paymentConfig?.provider ?? "loading"}:${paymentConfig?.mode ?? "loading"}`;
  currentContext.current = contextKey;
  // Existing paid entitlements remain readable/claimable if new purchases switch to another live provider.
  const available = paymentConfig?.mode === "live";
  const activeOrderId = inspectedOrder ?? returnOrderId;
  const current = !isGuest && overview?.accountId === userId && available ? overview : null;
  const currentOrder = !isGuest && order?.accountId === userId && available && order.id === activeOrderId ? order : null;
  const currentIntent = !isGuest && purchaseIntent?.request.accountId === userId ? purchaseIntent : null;
  const recoveredOrder = !isGuest && recoveryOrder?.accountId === userId ? recoveryOrder : null;
  const plan = config?.plans.find(entry => entry.id === selected) ?? config?.plans[0];
  const wechatMethods = config?.methods.filter(entry => entry.id === "wxpay") ?? [];
  const methodId = wechatMethods.some(entry => entry.id === selectedMethod) ? selectedMethod : wechatMethods[0]?.id ?? "";
  const activeSubscription = current?.subscriptions.find(entry => entry.status === "active");
  const claimedSubscription = current?.subscriptions.find(entry => entry.id === current.checkin.subscriptionId);
  const lastSubscription = current?.subscriptions.filter(entry => entry.status === "expired" || entry.status === "revoked")
    .sort((a, b) => b.startsAt - a.startsAt)[0];
  const queued = current?.subscriptions.filter(entry => entry.status === "queued").sort((a, b) => a.startsAt - b.startsAt) ?? [];
  const receivedSubscription = current?.subscriptions.find(entry => entry.orderId === currentOrder?.id);
  const busy = loading || acting !== null || verifying || recovering;
  const purchaseBlocked = !isGuest && (!intentReady || intentOwner.current !== userId || !!intentError || !!currentIntent);
  const originalRetryAvailable = XUMENG_PAYMENTS_ENABLED && !!currentIntent && intentSaved && lookupMissing && !intentError
    && canRetryDzmmSubscriptionPurchaseIntent(currentIntent, config, paymentConfig);

  const finishIntent = useCallback((submitted: DzmmSubscriptionPurchaseIntent, result: DzmmSubscriptionOrder) => {
    if (!mounted.current || currentContext.current !== contextKey || submitted.request.accountId !== userId
      || intentRef.current?.request.requestId !== submitted.request.requestId || intentOrder.current?.requestId !== submitted.request.requestId
      || intentOrder.current.orderId !== result.id || result.status === "pending") return;
    try {
      if (!clearDzmmSubscriptionPurchaseIntent(window.sessionStorage, submitted, result)) throw new Error("购买记录已改变，请先恢复原记录。");
      intentRef.current = null; intentOrder.current = null;
      setPurchaseIntent(null); setIntentSaved(false); setIntentError(""); setLookupMissing(false);
    } catch (failure) { setIntentError(errorText(failure)); }
  }, [contextKey, userId]);

  const lookupIntent = useCallback(async (submitted: DzmmSubscriptionPurchaseIntent) => {
    if (submitted.request.accountId !== userId || isGuest || currentContext.current !== contextKey) return;
    const generation = intentEpoch.current;
    recoveryController.current?.abort();
    const controller = new AbortController(); recoveryController.current = controller;
    const active = () => mounted.current && !controller.signal.aborted && currentContext.current === contextKey
      && intentEpoch.current === generation && intentRef.current?.request.requestId === submitted.request.requestId;
    setRecovering(true); setRecoveryError(""); setLookupMissing(false);
    try {
      const result = await fetchDzmmSubscriptionRequest(submitted.request, submitted.plan, controller.signal);
      if (!active()) return;
      const recovered = preserveDzmmSubscriptionFinalOrder(result.order, result.order ? observedFinalOrders.current.get(result.order.id) : undefined);
      setRecoveryOrder(recovered); setLookupMissing(recovered === null);
      if (recovered) {
        intentOrder.current = { requestId: submitted.request.requestId, orderId: recovered.id };
        if (recovered.status !== "pending") observedFinalOrders.current.set(recovered.id, recovered);
        finishIntent(submitted, recovered);
      } else intentOrder.current = null;
    } catch (failure) { if (active()) setRecoveryError(`原购买结果尚未确认。${errorText(failure)}`); }
    finally {
      if (recoveryController.current === controller) {
        recoveryController.current = null;
        if (mounted.current && currentContext.current === contextKey && intentEpoch.current === generation) setRecovering(false);
      }
    }
  }, [contextKey, finishIntent, isGuest, userId]);

  const restoreIntent = useCallback(() => {
    if (isGuest || !mounted.current || currentContext.current !== contextKey) return;
    setRecoveryError("");
    try {
      const result = readDzmmSubscriptionPurchaseIntent(window.sessionStorage, userId);
      if (result.state === "blocked") { setIntentError(result.message); setIntentReady(true); return; }
      setIntentError(""); setIntentReady(true);
      if (result.state === "ready") {
        intentRef.current = result.intent; setPurchaseIntent(result.intent); setIntentSaved(true);
        void lookupIntent(result.intent);
      } else if (intentRef.current) {
        // A prepared UUID survives storage failure; reading an empty cache does not abandon it.
        setIntentSaved(false); setLookupMissing(false);
        setIntentError("原购买记录尚未安全保存，请重试保存购买记录后恢复。");
      } else { setPurchaseIntent(null); setIntentSaved(false); setLookupMissing(false); }
    } catch { setIntentError("购买记录暂时无法读取，已暂停新购买。请重试读取购买记录。"); setIntentReady(true); }
  }, [contextKey, isGuest, lookupIntent, userId]);

  const reload = useCallback(async (preserveError = false) => {
    if (!available) return;
    const generation = ++epoch.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    setLoading(true); if (!preserveError) setError("");
    try {
      const settings = await fetchDzmmSubscriptionConfig(controller.signal);
      if (!mounted.current || controller.signal.aborted || currentContext.current !== contextKey || generation !== epoch.current) return;
      setConfig(settings);
      if (!isGuest) {
        const read = ++reads.current;
        const state = await fetchDzmmSubscriptions({ accountId: userId, mode: "live", provider: "zpay" }, controller.signal);
        if (!mounted.current || controller.signal.aborted || currentContext.current !== contextKey || generation !== epoch.current) return;
        if (read > applied.current) { applied.current = read; setOverview(state); }
      }
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && currentContext.current === contextKey && generation === epoch.current) {
        setError(previous => preserveError && previous ? `${previous} 刷新状态失败：${errorText(failure)}` : errorText(failure));
      }
    } finally {
      if (mounted.current && currentContext.current === contextKey && generation === epoch.current) setLoading(false);
    }
  }, [available, contextKey, isGuest, userId]);

  useEffect(() => {
    mounted.current = true;
    setConfig(null); setOverview(null); setOrder(null); setInspectedOrder(null); setError(""); setNotice("");
    setSelected(""); setSelectedMethod(""); setActing(null); setVerificationError(""); setVerifying(false);
    actionPending.current = false; requestIds.current.clear();
    intentEpoch.current += 1; intentOwner.current = userId; intentRef.current = null; intentOrder.current = null;
    observedFinalOrders.current.clear();
    setPurchaseIntent(null); setIntentReady(isGuest); setIntentSaved(false); setIntentError("");
    setRecoveryError(""); setRecoveryOrder(null); setLookupMissing(false); setRecovering(false);
    if (!isGuest) restoreIntent();
    void reload();
    return () => {
      mounted.current = false; epoch.current += 1;
      refreshController.current?.abort(); actionController.current?.abort(); verificationController.current?.abort();
      intentEpoch.current += 1; recoveryController.current?.abort();
    };
  }, [isGuest, reload, restoreIntent, userId]);

  useEffect(() => {
    if (observedRefresh.current === refreshKey) return;
    observedRefresh.current = refreshKey;
    void reload();
  }, [refreshKey, reload]);

  useEffect(() => {
    if (!available || isGuest || !activeOrderId) return;
    const controller = new AbortController();
    verificationController.current = controller;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 60_000;
    const active = () => !stopped && !controller.signal.aborted && mounted.current && currentContext.current === contextKey;
    async function verify() {
      setVerifying(true); setVerificationError("");
      try {
        const read = ++reads.current;
        const result = await fetchDzmmSubscriptionOrder(activeOrderId as string, { accountId: userId, provider: "zpay", mode: "live" }, controller.signal);
        if (!active()) return;
        setOrder(result.order);
        if (result.order.status !== "pending") observedFinalOrders.current.set(result.order.id, result.order);
        if (intentOrder.current?.orderId === result.order.id) setRecoveryOrder(result.order);
        const submitted = intentRef.current;
        if (submitted) finishIntent(submitted, result.order);
        if (read > applied.current) { applied.current = read; setOverview(result); }
        const activated = result.subscriptions.some(entry => entry.orderId === result.order.id);
        if (!cancelled && (result.order.status === "pending" || (result.order.status === "paid" && !activated)) && Date.now() < deadline) {
          timer = setTimeout(() => { void verify(); }, 3000); return;
        }
        if (result.order.status === "paid") onChanged.current?.();
      } catch (failure) {
        if (!active()) return;
        if (!cancelled && failure instanceof DzmmPaymentError && failure.status >= 500 && Date.now() < deadline) {
          timer = setTimeout(() => { void verify(); }, 3000); return;
        }
        setVerificationError(errorText(failure));
      }
      if (active()) setVerifying(false);
    }
    void verify();
    return () => { stopped = true; controller.abort(); if (timer) clearTimeout(timer); if (verificationController.current === controller) verificationController.current = null; };
  }, [activeOrderId, available, cancelled, contextKey, finishIntent, isGuest, userId, verificationRetry]);

  function requestId(key: string) {
    let id = requestIds.current.get(key);
    if (!id) { id = crypto.randomUUID(); requestIds.current.set(key, id); }
    return id;
  }

  async function purchase(retryOriginal = false) {
    if (!XUMENG_PAYMENTS_ENABLED || actionPending.current || busy) return;
    if (isGuest) { onRequireAccount(); return; }
    const paymentReady = paymentConfig?.provider === "zpay" || (paymentConfig?.provider === "guagua" && methodId === "wxpay");
    if (!available || !paymentReady || !config?.enabled || !plan || !methodId || !intentReady || intentOwner.current !== userId || intentError) return;
    const existing = intentRef.current;
    if (retryOriginal ? !existing || !originalRetryAvailable : !!existing) return;
    let submitted: DzmmSubscriptionPurchaseIntent;
    try { submitted = existing ?? createDzmmSubscriptionPurchaseIntent(userId, plan, methodId as DzmmPaymentMethod); }
    catch (failure) { setIntentError(errorText(failure)); return; }
    intentRef.current = submitted; setPurchaseIntent(submitted); setLookupMissing(false); setRecoveryOrder(null); setRecoveryError("");
    try {
      saveDzmmSubscriptionPurchaseIntent(window.sessionStorage, submitted);
      setIntentSaved(true); setIntentError("");
    } catch (failure) { setIntentSaved(false); setIntentError(errorText(failure)); return; }
    const controller = new AbortController();
    actionController.current = controller; actionPending.current = true;
    setActing("purchase"); setError(""); setNotice("");
    let redirecting = false;
    try {
      const result = await createDzmmSubscriptionCheckout(submitted.request, submitted.plan, controller.signal);
      if (!mounted.current || controller.signal.aborted || currentContext.current !== contextKey) return;
      intentOrder.current = { requestId: submitted.request.requestId, orderId: result.order.id };
      if (result.order.status !== "pending") observedFinalOrders.current.set(result.order.id, result.order);
      setRecoveryOrder(result.order); finishIntent(submitted, result.order);
      if (result.order.status !== "pending") return;
      if (!isDzmmSubscriptionCheckoutUrl(result.checkoutUrl, result.order.id)) throw new Error("订阅支付地址未通过验证，请刷新订单。");
      window.location.assign(result.checkoutUrl); redirecting = true;
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted || currentContext.current !== contextKey) return;
      if (failure instanceof DzmmPaymentError && failure.status === 409) void reload();
      setError(errorText(failure));
      void lookupIntent(submitted);
    } finally {
      if (!redirecting && actionController.current === controller) {
        actionController.current = null; actionPending.current = false;
        if (mounted.current && currentContext.current === contextKey) setActing(null);
      }
    }
  }

  function retrySaveIntent() {
    const submitted = intentRef.current;
    if (busy || !submitted || submitted.request.accountId !== userId || currentContext.current !== contextKey) return;
    try {
      saveDzmmSubscriptionPurchaseIntent(window.sessionStorage, submitted);
      setIntentSaved(true); setIntentError(""); void lookupIntent(submitted);
    } catch (failure) { setIntentError(errorText(failure)); }
  }

  async function claim() {
    if (actionPending.current || busy) return;
    if (isGuest) { onRequireAccount(); return; }
    if (!current?.checkin.claimable || !current.checkin.subscriptionId) return;
    const controller = new AbortController();
    actionController.current = controller; actionPending.current = true;
    setActing("claim"); setError(""); setNotice("");
    const key = `${contextKey}:claim:${current.checkin.subscriptionId}:${current.checkin.dayKey}`;
    try {
      const read = ++reads.current;
      const result = await claimDzmmSubscriptionCredit({ accountId: userId, subscriptionId: current.checkin.subscriptionId,
        requestId: requestId(key), provider: "zpay", mode: "live" }, controller.signal);
      if (!mounted.current || controller.signal.aborted || currentContext.current !== contextKey) return;
      if (read > applied.current) { applied.current = read; setOverview(result); }
      setNotice(`今日已领取 ${number(result.claim.credits)} Credit，已计入你的余额。`);
      onChanged.current?.();
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted || currentContext.current !== contextKey) return;
      setError(errorText(failure)); void reload(true);
    } finally {
      if (actionController.current === controller) {
        actionController.current = null; actionPending.current = false;
        if (mounted.current && currentContext.current === contextKey) setActing(null);
      }
    }
  }

  async function resume(entry = currentOrder) {
    if (!XUMENG_PAYMENTS_ENABLED) return;
    if (actionPending.current || busy || !entry || entry.accountId !== userId || entry.status !== "pending") return;
    const controller = new AbortController();
    actionController.current = controller; actionPending.current = true; setActing("resume"); setError("");
    let redirecting = false;
    try {
      const latest = await fetchDzmmSubscriptionConfig(controller.signal);
      if (!mounted.current || controller.signal.aborted || currentContext.current !== contextKey) return;
      if (!latest.enabled || !latest.methods.some(item => item.id === entry.method)) throw new DzmmPaymentError(409, "订阅购买暂未开放，或支付方式已变更，请刷新后重试。");
      const result = await fetchDzmmSubscriptionOrder(entry.id, { accountId: userId, provider: "zpay", mode: "live" }, controller.signal);
      if (!mounted.current || controller.signal.aborted || currentContext.current !== contextKey) return;
      if (result.order.status !== "pending") observedFinalOrders.current.set(result.order.id, result.order);
      if (intentOrder.current?.orderId === result.order.id) {
        setRecoveryOrder(result.order); const submitted = intentRef.current; if (submitted) finishIntent(submitted, result.order);
      }
      if (result.order.status !== "pending") { setOrder(result.order); setOverview(result); setVerificationRetry(value => value + 1); return; }
      if (result.order.method !== entry.method || !isDzmmSubscriptionCheckoutUrl(result.order.checkoutUrl, entry.id)) throw new Error("该订阅订单暂时不能继续支付，请刷新状态。");
      window.location.assign(result.order.checkoutUrl); redirecting = true;
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted || currentContext.current !== contextKey) return;
      if (failure instanceof DzmmPaymentError && failure.status === 409) void reload();
      setError(errorText(failure));
    } finally {
      if (!redirecting && actionController.current === controller) {
        actionController.current = null; actionPending.current = false;
        if (mounted.current && currentContext.current === contextKey) setActing(null);
      }
    }
  }

  let receiptMessage = "正在核对付款与会员权益。支付完成后，请以这里显示的开通结果为准。";
  if (receivedSubscription?.status === "active") receiptMessage = `已开通${receivedSubscription.label}，有效至 ${date(receivedSubscription.expiresAt)}。现在可查看今日签到状态。`;
  else if (receivedSubscription?.status === "queued") receiptMessage = `已购买${receivedSubscription.label}，将于 ${date(receivedSubscription.startsAt)} 生效，接续已有会员周期。`;
  else if (receivedSubscription?.status === "expired") receiptMessage = "这期会员已到期，已领取的 Credit 仍保留在余额中。";
  else if (receivedSubscription?.status === "revoked" || currentOrder?.status === "refunded") receiptMessage = "这笔会员权益已停止，具体处理结果以订单记录为准。";
  else if (currentOrder?.status === "paid") receiptMessage = "付款已确认，会员开通结果仍在核对中。请稍后重新核对。";
  else if (currentOrder?.status === "pending") receiptMessage = verifying
    ? XUMENG_PAYMENTS_ENABLED ? "正在等待付款确认。已付款请等候开通结果；尚未付款可在核对结束后继续支付此订单。" : "正在核对原订单付款结果。人民币收款已停用，请等待核对完成。"
    : XUMENG_PAYMENTS_ENABLED ? "暂未确认收到付款。已付款可重新核对；尚未付款可继续支付此订单。" : "暂未确认收到付款。人民币收款已停用，已付款可继续核对结果。";
  else if (currentOrder?.status === "expired") receiptMessage = XUMENG_PAYMENTS_ENABLED ? "订单已过期，未开通会员。你可以重新选择套餐购买。" : "订单已过期，未开通会员。人民币收款已停用。";
  else if (currentOrder?.status === "failed") receiptMessage = XUMENG_PAYMENTS_ENABLED ? "这笔付款未完成，未开通会员。你可以重新选择套餐购买。" : "这笔付款未完成，未开通会员。人民币收款已停用。";
  const receiptTitle = receivedSubscription?.status === "active" ? "VIP 已开通"
    : receivedSubscription?.status === "queued" ? "续订已确认 · 待生效"
    : currentOrder ? orderStatus[currentOrder.status] : "核对会员订单";
  const membershipStatus = activeSubscription ? "生效中" : queued.length ? "待生效"
    : lastSubscription?.status === "expired" ? "已到期" : lastSubscription?.status === "revoked" ? "已停止"
    : isGuest ? "登录后查看" : current ? "未开通" : loading || !paymentConfig ? "读取中" : "暂未读取";
  const membershipTitle = activeSubscription?.label ?? (queued.length ? queued[0].label : lastSubscription?.label) ?? "晴屿 VIP";
  const dailyReward = current?.checkin.claimed ? current.checkin.rewardCredits
    : activeSubscription?.dailyCredits ?? plan?.dailyCredits;

  if (current?.superAccess) return <section className={s.section} aria-labelledby="subscription-title">
    <div className={s.heading}>
      <div><h2 id="subscription-title">Super 全站权益</h2><p>管理员账号已开通全部会员功能，Credit 按普通账户规则结算。</p></div>
      <button type="button" className={s.outline} disabled={busy || !available} onClick={() => void reload()}><Icon name="refresh" size={14} />{loading ? "读取中…" : "刷新状态"}</button>
    </div>
    {error && <p className={s.error} role="alert">{error}</p>}
    <div className={s.membership}>
      <div className={s.membershipHeading}><h3>晴屿 Super</h3><span className={`${s.status} ${s.activeStatus}`}>Super 权限</span></div>
      <p className={s.period}>无需购买 VIP 即可使用会员功能，Credit 余额独立记录；权限以服务器当前账号角色为准。</p>
      <dl className={s.accountFacts}><div><dt>可用 Credit</dt><dd>{number(current.balance)}</dd></div><div><dt>Credit 结算</dt><dd>按普通账户规则</dd></div></dl>
      <ul className={s.mediaBenefits} aria-label="Super 媒体权益"><li><Icon name="chat" size={17} /><span>中文语音</span><strong>无每日额度限制</strong></li><li><Icon name="sparkles" size={17} /><span>剧情图片</span><strong>无每日额度限制</strong></li></ul>
      <p className={s.mediaNote}>单次生成长度、并发与服务可用性仍按站点限制执行。</p>
    </div>
    <NowPaymentsCenter userId={userId} isGuest={isGuest} refreshKey={refreshKey} onRequireAccount={onRequireAccount} onCreditChanged={onCreditChanged} />
  </section>;

  return <section className={s.section} aria-labelledby="subscription-title">
    <div className={s.heading}>
      <div><h2 id="subscription-title">会员</h2><p>有效期内每天领取一次 Credit。微信或 USDT 购买。</p></div>
      <button type="button" className={s.outline} disabled={busy || !available} onClick={() => void reload()}>
        <Icon name="refresh" size={14} />{loading ? "读取中…" : "刷新状态"}
      </button>
    </div>
    {(!XUMENG_PAYMENTS_ENABLED || (config && !config.enabled)) && <p className={s.coming} role="note"><strong>{!XUMENG_PAYMENTS_ENABLED ? "人民币购买已停用" : "购买暂未开放"}</strong><span>{!XUMENG_PAYMENTS_ENABLED ? "人民币收款已停用，历史订单与会员权益保留；USDT 购买状态见下方。" : config?.note || "已有会员权益仍可按有效期签到，新购买与续订请稍后再试。"}</span></p>}
    {error && <p className={s.error} role="alert">{error}</p>}
    {notice && <p className={s.notice} role="status">{notice}</p>}

    {!isGuest && (currentIntent || recoveredOrder || intentError) && <div className={s.receipt} aria-label="恢复 VIP 购买记录" aria-live="polite" aria-busy={recovering}>
      <div className={s.receiptHeading}><strong>{recoveredOrder ? `原订单 · ${orderStatus[recoveredOrder.status]}` : "恢复 VIP 购买记录"}</strong>{recovering && <span>恢复中…</span>}</div>
      <p>{recovering ? "正在找回原购买结果，不会重新创建订单。"
        : recoveredOrder?.status === "pending" ? XUMENG_PAYMENTS_ENABLED ? "已找回原订单。请继续这笔付款，避免重复开单。" : "已找回原订单。人民币收款已停用，已付款可继续核对结果。"
        : recoveredOrder ? "已确认原订单结果。会员是否生效，请以会员状态为准。"
        : lookupMissing ? XUMENG_PAYMENTS_ENABLED ? "当前查询未找到这次请求的订单。重试会沿用原请求编号和已确认套餐。" : "当前查询未找到这次请求的订单。人民币收款已停用，原记录会保留，可稍后重新核对。"
        : XUMENG_PAYMENTS_ENABLED ? "购买结果尚未确认。请先恢复原购买记录，再继续付款。" : "原购买结果尚未确认。人民币收款已停用，可恢复记录核对结果。"}</p>
      {(currentIntent || recoveredOrder) && <dl className={s.orderFacts}>
        <div><dt>原套餐</dt><dd>{currentIntent?.plan.label ?? recoveredOrder?.label}</dd></div>
        <div><dt>支付金额</dt><dd>{money(currentIntent?.plan.amountMinor ?? recoveredOrder!.amountMinor)}</dd></div>
        <div><dt>每日领取</dt><dd>{number(currentIntent?.plan.dailyCredits ?? recoveredOrder!.dailyCredits)} Credit</dd></div>
        <div><dt>支付方式</dt><dd>{(currentIntent?.request.method ?? recoveredOrder?.method) === "wxpay" ? "微信支付" : "支付宝"}</dd></div>
      </dl>}
      {recoveredOrder && <details className={s.orderNumber}><summary>查看原订单编号</summary><code>{recoveredOrder.id}</code></details>}
      {intentError && <p className={s.error} role="alert">{intentError}</p>}
      {recoveryError && <p className={s.error} role="alert">{recoveryError}</p>}
      {lookupMissing && currentIntent && intentSaved && !intentError && !originalRetryAvailable &&
        <p className={s.rules}>套餐或支付环境已变化，暂不能重试原购买请求。原记录会保留，你仍可恢复查询结果。</p>}
      <div className={s.actions}>
        {intentError && currentIntent && recoveredOrder?.status !== "pending" && recoveredOrder
          ? <button type="button" className={s.outline} disabled={busy} onClick={() => finishIntent(currentIntent, recoveredOrder)}>重试完成记录清理</button>
          : intentError && currentIntent ? <button type="button" className={s.outline} disabled={busy} onClick={retrySaveIntent}>重试保存购买记录</button>
          : null}
        {(currentIntent || intentError) && <button type="button" className={s.outline} disabled={busy} onClick={restoreIntent}>
          {recovering ? "恢复中…" : intentError && !currentIntent ? "重试读取购买记录" : "恢复原购买记录"}</button>}
        {XUMENG_PAYMENTS_ENABLED && lookupMissing && currentIntent && <button type="button" className={s.primary} disabled={busy || !originalRetryAvailable} onClick={() => void purchase(true)}>重试原购买请求</button>}
        {XUMENG_PAYMENTS_ENABLED && recoveredOrder?.status === "pending" && <button type="button" className={s.primary}
          disabled={busy || !!intentError || !intentSaved || !config?.enabled || !config.methods.some(entry => entry.id === recoveredOrder.method)}
          onClick={() => void resume(recoveredOrder)}>继续支付原订单</button>}
        {recoveredOrder && <button type="button" className={s.outline} disabled={busy || !available}
          onClick={() => { setInspectedOrder(recoveredOrder.id); setVerificationRetry(value => value + 1); }}>核对原订单付款</button>}
      </div>
      <p className={s.rules}>本标签页刷新或返回后可恢复原购买记录。订单结果未确认时，暂不创建新的购买订单。</p>
    </div>}

    {activeOrderId && <div className={s.receipt} aria-live="polite" aria-busy={verifying}>
      <div className={s.receiptHeading}><strong>{receiptTitle}</strong>{verifying && <span>核对中…</span>}</div>
      <p>{isGuest ? "登录订单所属账号后查看会员开通结果。" : receiptMessage}</p>
      {currentOrder && <dl className={s.orderFacts}>
        <div><dt>支付金额</dt><dd>{money(currentOrder.amountMinor)}</dd></div>
        <div><dt>会员周期</dt><dd>{currentOrder.durationDays} 天</dd></div>
        <div><dt>每日领取</dt><dd>{number(currentOrder.dailyCredits)} Credit</dd></div>
      </dl>}
      <details className={s.orderNumber}><summary>查看订单编号</summary><code>{activeOrderId}</code></details>
      {verificationError && <p className={s.error} role="alert">{verificationError}</p>}
      <div className={s.actions}>
        {isGuest ? <button type="button" className={s.primary} onClick={onRequireAccount}>登录查看订单</button>
          : <button type="button" className={s.outline} disabled={busy || !available} onClick={() => setVerificationRetry(value => value + 1)}>重新核对</button>}
        {XUMENG_PAYMENTS_ENABLED && currentOrder?.status === "pending" && config?.enabled && config.methods.some(item => item.id === currentOrder.method) &&
          <button type="button" className={s.primary} disabled={busy} onClick={() => void resume()}>{acting === "resume" ? "读取订单…" : "继续支付此订单"}</button>}
      </div>
    </div>}

    <div className={s.membership}>
      <div className={s.membershipHeading}>
        <h3>{membershipTitle}</h3><span className={`${s.status} ${activeSubscription ? s.activeStatus : ""}`}>{membershipStatus}</span>
      </div>
      <p className={s.period}>{activeSubscription
        ? `${date(activeSubscription.startsAt)} 至 ${date(activeSubscription.expiresAt)}（北京时间）`
        : isGuest ? "登录后查看你的会员与今日签到状态。"
        : queued.length ? `下一期将于 ${date(queued[0].startsAt)} 生效。`
        : lastSubscription?.status === "expired" ? `已于 ${date(lastSubscription.expiresAt)} 到期，已领取的 Credit 继续保留。`
        : lastSubscription?.status === "revoked" ? "这期会员已停止，请查看订单处理结果或联系管理员。"
        : current ? "会员周期以购买方案为准，生效后每天登录并手动领取 Credit。" : "刷新状态后查看会员有效期和签到记录。"}</p>
      {current && <dl className={s.accountFacts}>
        <div><dt>Credit 余额</dt><dd>{number(current.balance)}</dd></div>
        <div><dt>VIP 累计领取</dt><dd>{number(current.totalSubscriptionGranted)} <small>Credit</small></dd></div>
        {activeSubscription && <div><dt>本期已签到</dt><dd>{activeSubscription.claimsCount}<small> / {activeSubscription.maxClaims} 次</small></dd></div>}
      </dl>}
    </div>

    <div className={s.checkin} aria-label="VIP 每日签到">
      <div>
        <span className={s.eyebrow}>{current ? `${current.checkin.dayKey} · 北京时间` : "每日签到"}</span>
        <h3>{current?.checkin.claimed ? "今日 Credit 已领取" : "领取今日 Credit"}</h3>
        {dailyReward !== undefined && <strong className={s.dailyReward}>{number(dailyReward)} <span>Credit</span></strong>}
        <p>{current?.checkin.claimed ? "已计入你的余额，会员有效期内每天领取一次。" : activeSubscription ? "登录后点击领取，每天一次；当天未领取的额度不累计。" : "会员生效后，每天登录，在这里点击领取。"}</p>
      </div>
      <div className={s.checkinAction}>
        {isGuest ? <button type="button" className={s.outline} onClick={onRequireAccount}>登录领取 Credit</button>
          : current?.checkin.claimed ? <strong className={s.claimed}><Icon name="check" size={16} />今日已领取</strong>
          : <button type="button" className={s.primary} disabled={busy || !current?.checkin.claimable} onClick={() => void claim()}>
            {acting === "claim" ? "领取中…" : current?.checkin.claimable ? `领取今日 ${number(current.checkin.rewardCredits)} Credit`
              : !current ? loading || !paymentConfig ? "读取签到状态…" : "刷新后查看签到"
              : queued.length && !activeSubscription ? "生效后可签到" : activeSubscription ? "今日暂不可签到" : "开通后可签到"}
          </button>}
        {current && <small>下次重置：{date(current.checkin.resetAt)}</small>}
      </div>
    </div>
    {current?.checkin.claimed && activeSubscription && claimedSubscription && claimedSubscription.id !== activeSubscription.id &&
      <p className={s.rules}>今日领取来自「{claimedSubscription.label}」，每个账户每天仅领取一次 Credit。</p>}
    {queued.length > 0 && <div className={s.queuedSection}>
      <h3>已购 · 待生效</h3>
      <ul className={s.queued} aria-label="待生效会员">{queued.map(entry => <li key={entry.id}>
        <div><strong>{entry.label}</strong><span>{date(entry.startsAt)} 至 {date(entry.expiresAt)}</span></div>
        <span>每日 {number(entry.dailyCredits)} Credit</span>
      </li>)}</ul>
    </div>}

    {XUMENG_PAYMENTS_ENABLED && <div className={s.purchaseSection}>
      <div className={s.purchaseHeading}><h3>{activeSubscription || queued.length ? "续订 VIP" : "开通 VIP"}</h3><p>手动续订 · 不自动扣费</p></div>
      <ul className={s.mediaBenefits} aria-label="VIP 媒体权益">
        <li><Icon name="chat" size={17} /><span>中文语音</span><strong>每日 20 条</strong></li>
        <li><Icon name="sparkles" size={17} /><span>剧情图片</span><strong>每日 5 张</strong></li>
      </ul>
      <p className={s.mediaNote}>会员生效后，在聊天消息菜单生成语音与剧情图片。每日新生成额度独立于 Credit，北京时间零点重置；重复播放或查看同条消息的缓存不占新额度。单段语音最多 800 字。</p>
      {config?.plans.length ? <>
        <fieldset className={s.plans} disabled={busy || purchaseBlocked}><legend className={s.srOnly}>VIP 会员套餐</legend>
          {config.plans.map(entry => <label className={`${s.plan} ${entry.id === plan?.id ? s.selected : ""}`} key={entry.id}>
            <input type="radio" name="subscription-plan" checked={entry.id === plan?.id} onChange={() => setSelected(entry.id)} />
            <div className={s.planOffer}><span className={s.planName}>{entry.label}</span><strong className={s.price}>{money(entry.amountMinor)}<small> / {entry.durationDays} 天</small></strong></div>
            <div className={s.planBenefit}><span className={s.daily}>{number(entry.dailyCredits)}<small> Credit / 每日领取</small></span><span className={s.limit}>每期最多 {entry.maxClaims} 次 · 漏签不补</span></div>
          </label>)}
        </fieldset>
        <div className={s.purchase}>
          <div><strong>{plan ? `${plan.label} · ${money(plan.amountMinor)} / ${plan.durationDays} 天` : "选择会员"}</strong>
            <p>{methodId ? "使用微信支付。确认后开通，每天手动领取。" : "微信支付暂未开通。USDT 在下方。"}</p>
          </div>
          <button type="button" className={s.primary} disabled={busy || purchaseBlocked || !config.enabled || !plan || !methodId} onClick={() => void purchase()}>
            {acting === "purchase" ? "读取订单…" : !methodId ? "微信支付暂未开通" : !config.enabled ? "购买暂未开放" : isGuest ? "登录后开通"
              : purchaseBlocked ? currentIntent ? "先处理原购买记录" : "先恢复购买记录"
              : `${activeSubscription || queued.length ? "续订" : "开通"} · ${plan ? money(plan.amountMinor) : "微信支付"}`}
          </button>
        </div>
      </> : <p className={s.empty}>{loading || !paymentConfig ? "正在读取 VIP 套餐…"
        : !available ? "VIP 购买暂不可用，请稍后刷新状态。"
        : error ? "暂时无法读取 VIP 套餐，请稍后刷新状态。" : "VIP 套餐准备中，开放后可在这里购买。"}</p>}
    </div>}
    <ul className={s.rulesList} aria-label="VIP 领取与续订规则">
      <li>每日北京时间 00:00 重置，每天手动领取一次；每期领取上限以购买方案与会员状态为准，当天未领取的额度不补发。</li>
      <li>{XUMENG_PAYMENTS_ENABLED ? "无需 VIP 也可直接购买 Credit，两种来源进入同一余额，已到账 Credit 不随会员到期失效。" : "人民币充值已停用，已有余额与会员每日权益继续保留；USDT 购买状态见下方。"}</li>
      <li>{config?.modelBillingLinked ? "Credit 可用于按实际 Token 结算的聊天，费率与记忆计费规则见消费区。" : "当前 Credit 尚未接入聊天扣费。"}</li>
    </ul>
    <NowPaymentsCenter userId={userId} isGuest={isGuest} refreshKey={refreshKey} onRequireAccount={onRequireAccount} onCreditChanged={onCreditChanged} />
  </section>;
}
