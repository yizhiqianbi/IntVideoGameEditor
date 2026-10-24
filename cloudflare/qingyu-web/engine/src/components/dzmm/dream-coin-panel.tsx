"use client";

import { useEffect, useState, type FormEvent } from "react";
import { DreamCoinError, exchangeDreamCoin, fetchDreamCoin, formatDreamCoin, withdrawDreamCoin, type DreamCoinWallet } from "@/lib/dzmm-dream-coin";
import s from "./profile-settings.module.css";

const KIND: Record<string, string> = {
  invite_rebate: "邀请返利", creator_reward: "创作者激励", exchange: "兑换 Credit", withdraw_hold: "提现冻结", withdraw_release: "提现退回",
};
const STATUS: Record<string, string> = { pending: "待打款", paid: "已打款", rejected: "已退回" };

function yuanInput(value: string): number | null {
  if (!/^\d{1,6}$/.test(value)) return null;
  const yuan = Number(value);
  return yuan > 0 ? yuan * 100 : null;
}

export function DreamCoinPanel({ userId }: { userId: string }) {
  const [wallet, setWallet] = useState<DreamCoinWallet | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exchangeYuan, setExchangeYuan] = useState("1");
  const [withdrawYuan, setWithdrawYuan] = useState("10");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let active = true;
    void fetchDreamCoin(userId).then(value => { if (active) setWallet(value); }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : "梦币暂时无法加载。");
    });
    return () => { active = false; };
  }, [userId]);
  async function submit(event: FormEvent, action: "exchange" | "withdraw") {
    event.preventDefault();
    if (!wallet || busy) return;
    const amount = yuanInput(action === "exchange" ? exchangeYuan : withdrawYuan);
    if (!amount) { setError("请填写整数元。"); return; }
    setBusy(action); setError(""); setNotice("");
    try {
      const next = action === "exchange"
        ? await exchangeDreamCoin(userId, amount)
        : await withdrawDreamCoin(userId, amount, account);
      setWallet(next);
      setNotice(action === "exchange" ? `已兑换 ${formatDreamCoin(amount)}，Credit 已到账。` : "提现申请已提交，打款完成后会记在下面的记录里。");
    } catch (failure) {
      setError(failure instanceof DreamCoinError ? failure.message : "梦币操作没有完成，请稍后重试。");
    } finally { setBusy(""); }
  }
  if (error && !wallet) return <p className={s.error} role="alert">{error}</p>;
  if (!wallet) return <section className={s.referralCard} aria-label="梦币"><p>正在读取梦币…</p></section>;
  return <section className={s.referralCard} aria-label="梦币">
    <div className={s.referralHeading}><div><span className={s.referralEyebrow}>梦币</span><h2>按人民币记账，可兑换，可申请提现</h2></div><strong>{formatDreamCoin(wallet.balanceFen)}</strong></div>
    <p>1 梦币 = ¥1 = {wallet.creditsPerYuan} Credit。好友注册后 {wallet.earlyWindowDays} 天内的微信实付，按 {wallet.earlyRebatePercent}% 记入；之后按 {wallet.laterRebatePercent}%。创作者激励使用同一本账。提现最低 {formatDreamCoin(wallet.minWithdrawFen)}，两次成功提现至少间隔 {wallet.withdrawIntervalDays} 天，由站点人工打款。</p>
    {notice && <p className={s.status} role="status">{notice}</p>}
    {error && <p className={s.error} role="alert">{error}</p>}
    <form className={s.dreamForm} onSubmit={event => void submit(event, "exchange")}>
      <label>兑换为 Credit<input inputMode="numeric" value={exchangeYuan} onChange={event => setExchangeYuan(event.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="兑换梦币金额" /></label>
      <button className={s.outline} disabled={!!busy}>{busy === "exchange" ? "兑换中…" : "兑换"}</button>
    </form>
    <form className={s.dreamForm} onSubmit={event => void submit(event, "withdraw")}>
      <label>提现金额<input inputMode="numeric" value={withdrawYuan} onChange={event => setWithdrawYuan(event.target.value.replace(/\D/g, "").slice(0, 6))} aria-label="提现梦币金额" /></label>
      <label>收款账号<input value={account} maxLength={64} onChange={event => setAccount(event.target.value)} placeholder="支付宝或微信收款账号" aria-label="提现收款账号" /></label>
      <button className={s.outline} disabled={!!busy}>{busy === "withdraw" ? "提交中…" : "申请提现"}</button>
    </form>
    <ul className={s.dreamList} aria-label="梦币流水">{wallet.entries.length ? wallet.entries.map(entry => <li key={entry.id}><span>{KIND[entry.kind] ?? entry.note}</span><strong>{entry.amountFen > 0 ? "+" : ""}{formatDreamCoin(entry.amountFen)}</strong><time>{new Date(entry.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</time></li>) : <li>还没有梦币记录。</li>}</ul>
    {wallet.withdrawals.length > 0 && <ul className={s.dreamList} aria-label="提现记录">{wallet.withdrawals.map(item => <li key={item.id}><span>提现 {item.payoutAccount}</span><strong>{STATUS[item.status] ?? item.status}</strong><time>{formatDreamCoin(item.amountFen)}</time></li>)}</ul>}
  </section>;
}
