"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent } from "react";
import type { DzmmAccountValues } from "@/lib/dzmm-cloud";
import {
  fetchDzmmEmailAuthConfig, requestDzmmEmailCode, requestDzmmPasswordResetCode, type DzmmEmailAuthConfig, type DzmmEmailCodeValues,
  type DzmmPasswordResetValues,
} from "@/lib/dzmm-email-auth";
import Icon from "./icons";
import s from "./account-modal.module.css";

export type AccountModalProps = {
  mode: "login" | "register";
  initialReferralCode?: string;
  onModeChange: (mode: "login" | "register") => void;
  onClose: () => void;
  onSubmit: (values: DzmmAccountValues) => Promise<void>;
  onEmailSubmit: (values: DzmmEmailCodeValues, signal?: AbortSignal) => Promise<void>;
  onPasswordReset: (values: DzmmPasswordResetValues, signal?: AbortSignal) => Promise<void>;
  onClearError: () => void;
  submitting: boolean;
  error: string | null;
  intro?: string;
};

export default function AccountModal({ mode, initialReferralCode = "", onModeChange, onClose, onSubmit, onEmailSubmit, onPasswordReset, onClearError, submitting, error, intro }: AccountModalProps) {
  const [signupGift, setSignupGift] = useState<{ credits: number; targetConversationRounds: number } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  useEffect(() => { if (initialReferralCode) setReferralCode(previous => previous || initialReferralCode); }, [initialReferralCode]);
  const [method, setMethod] = useState<"password" | "email">("password");
  const [forgotPassword, setForgotPassword] = useState(false);
  const [configuration, setConfiguration] = useState<DzmmEmailAuthConfig | null>(null);
  const [social, setSocial] = useState<{ google: boolean; telegram: boolean } | null>(null);
  const [socialBusy, setSocialBusy] = useState<"google" | "telegram" | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState("");
  const [sendNotice, setSendNotice] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; email: string; expiresAt: number } | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const mounted = useRef(false);
  const emailRef = useRef("");
  const resendTimes = useRef(new Map<string, number>());
  const requestGeneration = useRef(0);
  const sendController = useRef<AbortController | null>(null);
  const verifyController = useRef<AbortController | null>(null);
  const verifying = useRef(false);
  // A click event bubbles from the dialog to the overlay after a drag. Keep
  // the pointer-down target so dragging a field selection outside the dialog
  // cannot be mistaken for an intentional backdrop click.
  const pointerDownOnOverlay = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const submittingRef = useRef(submitting);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void fetch("/api/backend/v1/auth/signup/config", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const value = await response.json();
      if (mounted.current && !controller.signal.aborted && value.enabled === true && Number.isSafeInteger(value.credits) && value.credits > 0 && Number.isInteger(value.targetConversationRounds)) setSignupGift(value);
    }).catch(() => { /* Registration remains available if bonus configuration is unavailable. */ });
    void fetch("/api/backend/v1/auth/social/config", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = response.ok ? await response.json() : null;
      if (!mounted.current || controller.signal.aborted) return;
      setSocial({ google: value?.google === true, telegram: value?.telegram === true });
    }).catch(() => { if (mounted.current && !controller.signal.aborted) setSocial({ google: false, telegram: false }); });
    void fetchDzmmEmailAuthConfig(controller.signal).then(result => {
      if (!mounted.current || controller.signal.aborted) return;
      setConfiguration(result);
    }).catch(failure => {
      if (!controller.signal.aborted && mounted.current) setConfigError(failure instanceof Error ? failure.message : "验证码服务暂时无法连接，可使用密码登录。");
    }).finally(() => { if (!controller.signal.aborted && mounted.current) setConfigLoading(false); });
    return () => {
      mounted.current = false; requestGeneration.current += 1;
      controller.abort(); sendController.current?.abort(); verifyController.current?.abort();
    };
  }, []);
  useEffect(() => {
    const deadline = Math.max(resendAt, challenge?.expiresAt ?? 0);
    if (!deadline) return;
    const timer = setInterval(() => {
      const current = Date.now(); setNow(current);
      if (current >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [challenge?.expiresAt, resendAt]);
  useEffect(() => {
    if (challenge?.id) dialog.current?.querySelector<HTMLInputElement>('input[name="code"],input[name="resetCode"]')?.focus();
  }, [challenge?.id]);
  useEffect(() => { closeRef.current = onClose; submittingRef.current = submitting; }, [onClose, submitting]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingRef.current) closeRef.current();
      if (event.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),a[href]");
      if (!controls?.length) { event.preventDefault(); dialog.current?.focus(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (document.activeElement === dialog.current || !dialog.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || verifying.current) return;
    if (forgotPassword) {
      if (sending || !configuration?.enabled || !challenge || challenge.email !== emailRef.current) return;
      if (Date.now() >= challenge.expiresAt) { setLocalError("验证码已过期，请重新获取。"); return; }
      if (!/^[0-9]{6}$/.test(code)) { setLocalError("请输入邮件中的 6 位验证码。"); return; }
      if (password.length < 12 || password.length > 256 || password.includes("\0")) { setLocalError("新密码需要 12 至 256 个字符。"); return; }
      if (password !== confirmPassword) { setLocalError("两次输入的新密码不一致。"); return; }
      setLocalError(""); onClearError(); verifying.current = true;
      const controller = new AbortController(); verifyController.current = controller;
      try { await onPasswordReset({ email: challenge.email, challengeId: challenge.id, code, newPassword: password }, controller.signal); }
      catch { /* The parent displays the actual account API error. */ }
      finally { verifying.current = false; if (verifyController.current === controller) verifyController.current = null; }
      return;
    }
    if (mode === "register") {
      const name = nickname.normalize("NFKC").trim().replace(/\s+/g, " ");
      if (!name || name.length > 30 || nickname.includes("\0") || /[\u0000-\u001f\u007f]/.test(nickname) || name === "游客") {
        setLocalError(name === "游客" ? "这个名字不能使用。" : "名字需要 1 至 30 个字符。");
        return;
      }
      setLocalError(""); onClearError();
      try { await onSubmit({ nickname: name, ...(referralCode.trim() ? { referralCode: referralCode.trim().toUpperCase() } : {}) }); }
      catch { /* The parent displays the actual account API error. */ }
      return;
    }
    if (method === "email") {
      if (sending || !configuration?.enabled || !challenge || challenge.email !== emailRef.current) return;
      if (Date.now() >= challenge.expiresAt) { setLocalError("验证码已过期，请重新获取。"); return; }
      if (!/^[0-9]{6}$/.test(code)) { setLocalError("请输入邮件中的 6 位验证码。"); return; }
      setLocalError(""); onClearError(); verifying.current = true;
      const controller = new AbortController(); verifyController.current = controller;
      try { await onEmailSubmit({ email: challenge.email, challengeId: challenge.id, code, ...(nickname.trim() ? { nickname: nickname.trim() } : {}), ...(referralCode.trim() ? { referralCode: referralCode.trim().toUpperCase() } : {}) }, controller.signal); }
      catch { /* Account adoption errors are displayed by the parent. */ }
      finally { verifying.current = false; if (verifyController.current === controller) verifyController.current = null; }
      return;
    }
    try { await onSubmit({ email: email.trim(), password }); }
    catch { /* The parent displays the actual account API error. */ }
  }

  function switchMode() {
    setForgotPassword(false); selectMethod("password"); setPassword(""); setConfirmPassword(""); setShowPassword(false);
    onModeChange(mode === "register" ? "login" : "register");
  }

  function enterForgotPassword() {
    if (submitting || verifying.current) return;
    invalidateChallenge();
    setForgotPassword(true); setMethod("email"); setPassword(""); setConfirmPassword(""); setShowPassword(false);
    onModeChange("login");
  }

  function leaveForgotPassword() {
    if (submitting || verifying.current) return;
    setForgotPassword(false); selectMethod("password"); setPassword(""); setConfirmPassword(""); setShowPassword(false);
    onModeChange("login");
  }

  function invalidateChallenge() {
    requestGeneration.current += 1; sendController.current?.abort(); sendController.current = null;
    setSending(false); setChallenge(null); setCode(""); setSendNotice(""); setLocalError(""); onClearError();
  }
  function updateEmail(value: string) {
    setEmail(value);
    const normalized = value.trim().toLowerCase();
    if (normalized === emailRef.current) return;
    emailRef.current = normalized;
    invalidateChallenge(); setResendAt(resendTimes.current.get(normalized) ?? 0); setNow(Date.now());
  }
  function selectMethod(value: "password" | "email") {
    if (submitting || verifying.current) return;
    invalidateChallenge(); setMethod(value); setPassword(""); setShowPassword(false);
    if (value === "email") onModeChange("login");
  }
  async function sendCode() {
    if (sendController.current || submitting || verifying.current || !configuration?.enabled || Date.now() < resendAt) return;
    const capturedEmail = emailRef.current;
    const generation = ++requestGeneration.current;
    const controller = new AbortController(); sendController.current = controller;
    setSending(true); setLocalError(""); setSendNotice(""); setChallenge(null); setCode(""); onClearError();
    try {
      const result = forgotPassword
        ? await requestDzmmPasswordResetCode(capturedEmail, controller.signal)
        : await requestDzmmEmailCode(capturedEmail, controller.signal);
      if (controller.signal.aborted || !mounted.current || generation !== requestGeneration.current || emailRef.current !== capturedEmail) return;
      const sentAt = Date.now();
      const retryAt = sentAt + result.resendAfter * 1000;
      resendTimes.current.set(capturedEmail, retryAt);
      setNow(sentAt); setResendAt(retryAt);
      setChallenge({ id: result.challengeId, email: capturedEmail, expiresAt: sentAt + result.expiresIn * 1000 });
      setSendNotice(forgotPassword ? "如果该邮箱已注册，验证码已发送，请查收邮件。" : "验证码已发送，请查收邮件。");
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current && generation === requestGeneration.current) setLocalError(failure instanceof Error ? failure.message : "验证码发送失败，请稍后重试。");
    } finally {
      if (sendController.current === controller) { sendController.current = null; if (mounted.current) setSending(false); }
    }
  }
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const validChallenge = challenge?.email === emailRef.current && now < challenge.expiresAt;
  const unavailable = !configuration?.enabled;
  async function startSocial(provider: "google" | "telegram") {
    if (socialBusy || submitting) return;
    setSocialBusy(provider);
    setLocalError("");
    onClearError();
    try {
      const response = await fetch(`/api/backend/v1/auth/${provider}/start`, { credentials: "same-origin", cache: "no-store" });
      const body = await response.json().catch(() => null) as { url?: unknown; error?: unknown } | null;
      if (!response.ok || typeof body?.url !== "string") throw new Error(typeof body?.error === "string" ? body.error : "暂时无法使用这个登录方式。");
      const url = new URL(body.url);
      const host = provider === "google" ? "accounts.google.com" : "oauth.telegram.org";
      if (url.protocol !== "https:" || url.hostname !== host) throw new Error("登录地址无效。");
      window.location.assign(url.href);
    } catch (failure) {
      if (mounted.current) {
        setSocialBusy(null);
        setLocalError(failure instanceof Error ? failure.message : "暂时无法使用这个登录方式。");
      }
    }
  }
  function handleOverlayPointerDown(event: PointerEvent<HTMLDivElement>) {
    pointerDownOnOverlay.current = event.target === event.currentTarget;
  }
  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    const clickedBackdrop = event.target === event.currentTarget;
    const startedOnBackdrop = pointerDownOnOverlay.current;
    pointerDownOnOverlay.current = false;
    if (clickedBackdrop && startedOnBackdrop && !submitting) onClose();
  }

  return (
    <div className={s.overlay} onPointerDown={handleOverlayPointerDown} onClick={handleOverlayClick}>
      <div className={s.dialogShell}>
        <aside className={s.brandPanel} aria-hidden="true">
          <img src="/assets/xumeng/brand/xumeng-mark.svg" width="38" height="38" alt="" />
          <span className={s.brandName}>叙梦<small>XUMENG</small></span>
          <div className={s.brandCopy}><span>把故事带走</span><strong>登录叙梦，<br />让每一段关系继续。</strong><p>角色、收藏和会话会被安全保留，换设备也能接着聊。</p></div>
          <div className={s.brandFeatures}><span><Icon name="refresh" size={15} />跨设备同步</span><span><Icon name="chat" size={15} />保留故事进度</span><span><Icon name="sparkles" size={15} />新手奖励</span></div>
        </aside>
        <div className={s.dialog} ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="account-title">
        <header><div><span className={s.formEyebrow}>{forgotPassword ? "账号安全" : "叙梦账户"}</span><h2 id="account-title">{forgotPassword ? "重置密码" : mode === "register" ? "创建你的账号" : method === "email" ? "邮箱验证码登录" : "欢迎回来"}</h2></div><button type="button" onClick={onClose} disabled={submitting} aria-label="关闭账号窗口"><Icon name="close" /></button></header>
        {!forgotPassword && <div className={s.modeSwitch} role="group" aria-label="账号操作"><button type="button" aria-pressed={mode === "login"} disabled={submitting} onClick={() => { if (mode !== "login") switchMode(); }}>登录</button><button type="button" aria-pressed={mode === "register"} disabled={submitting} onClick={() => { if (mode !== "register") switchMode(); }}>注册</button></div>}
        {intro && !forgotPassword && <p className={s.intro}>{intro}</p>}
        {signupGift && !forgotPassword && (mode === "register" || method === "email") && <p className={s.hint}>首次注册赠送 {signupGift.credits.toLocaleString("zh-CN")} Credit。已有账号登录不重复赠送。</p>}
        {!forgotPassword && <div className={s.social}>
          <button type="button" onClick={() => void startSocial("google")} disabled={submitting || socialBusy !== null || !social?.google} title={social && !social.google ? "Google 登录尚未配置" : undefined}>{socialBusy === "google" ? "正在前往 Google…" : "使用 Google 继续"}</button>
          <button type="button" onClick={() => void startSocial("telegram")} disabled={submitting || socialBusy !== null || !social?.telegram} title={social && !social.telegram ? "Telegram 登录尚未配置" : undefined}>{socialBusy === "telegram" ? "正在前往 Telegram…" : "使用 Telegram 继续"}</button>
        </div>}
        {!forgotPassword && social && !social.google && !social.telegram && <p className={s.serviceNote} role="status">Google 和 Telegram 登录尚未开通，可继续使用邮箱登录。</p>}
        {!forgotPassword && <p className={s.divider}>或使用邮箱</p>}
        {!forgotPassword && mode !== "register" && <div className={s.methods} role="group" aria-label="登录方式"><button type="button" aria-pressed={method === "email"} disabled={submitting} onClick={() => selectMethod("email")}>邮箱验证码</button><button type="button" aria-pressed={method === "password"} disabled={submitting} onClick={() => selectMethod("password")}>邮箱与密码</button></div>}
        <p className={s.hint}>{forgotPassword ? "通过邮箱验证码设置新的登录密码。" : mode === "register" ? "注册后会保留当前游客的角色、收藏和会话。" : "登录后会同步你的角色、收藏和会话。"}</p>
        {mode !== "register" && (configLoading || unavailable) && <p className={s.serviceNote} role="status">{configLoading ? "正在检查验证码登录服务…" : configError || configuration?.note || "邮箱验证码发送尚未配置，可使用邮箱与密码登录。"}</p>}
        <form className={s.form} onSubmit={submit}>
          {mode === "register" ? <>
            <label>名字<input autoComplete="nickname" name="nickname" required maxLength={30} value={nickname} onChange={(event) => setNickname(event.target.value)} disabled={submitting} /><small>1 至 30 个字符，不能与已有账号重复。</small></label>
            <label>邀请码（可选）<input name="referralCode" placeholder="粘贴好友的邀请码" inputMode="text" maxLength={32} autoCapitalize="characters" value={referralCode} onChange={(event) => setReferralCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 32))} disabled={submitting} /><small>好友会先获得 20 Credit。之后你每个北京时间日完成一轮成功对话，好友再获得 500 Credit，最多 3 天，同一天只发一次。</small></label>
          </> : <>
          <label>邮箱<input autoComplete="email" name="email" type="email" placeholder="you@example.com" required maxLength={254} value={email} onChange={(event) => updateEmail(event.target.value)} disabled={submitting} /></label>
          {forgotPassword ? <>
            <div className={s.codeRow}><label>验证码<input autoComplete="one-time-code" name="resetCode" type="text" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={(event) => { setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6)); setLocalError(""); onClearError(); }} disabled={submitting || !validChallenge} /></label><button type="button" className={s.sendCode} onClick={() => void sendCode()} disabled={submitting || sending || unavailable || resendSeconds > 0}>{sending ? "正在发送…" : resendSeconds > 0 ? `${resendSeconds} 秒后重发` : challenge ? "重新发送" : "获取验证码"}</button></div>
            {sendNotice && <p className={s.sent} role="status">{sendNotice}</p>}
            {challenge && <small>{validChallenge ? "验证码 10 分钟内有效。" : "验证码已过期，请重新获取。"}</small>}
            <label>新密码<span className={s.passwordField}><input autoComplete="new-password" name="newPassword" type={showPassword ? "text" : "password"} required minLength={12} maxLength={256} value={password} onChange={(event) => { setPassword(event.target.value); setLocalError(""); onClearError(); }} disabled={submitting} /><button type="button" className={s.passwordToggle} onClick={() => setShowPassword(value => !value)} disabled={submitting}>{showPassword ? "隐藏" : "显示"}</button></span><small>至少 12 个字符。</small></label>
            <label>确认新密码<input autoComplete="new-password" name="confirmPassword" type="password" required minLength={12} maxLength={256} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setLocalError(""); onClearError(); }} disabled={submitting} /></label>
          </> : method === "email" ? <>
            <div className={s.codeRow}><label>验证码<input autoComplete="one-time-code" name="code" type="text" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={(event) => { setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6)); setLocalError(""); onClearError(); }} disabled={submitting || !validChallenge} /></label><button type="button" className={s.sendCode} onClick={() => void sendCode()} disabled={submitting || sending || unavailable || resendSeconds > 0}>{sending ? "正在发送…" : resendSeconds > 0 ? `${resendSeconds} 秒后重发` : challenge ? "重新发送" : "获取验证码"}</button></div>
            {sendNotice && <p className={s.sent} role="status">{sendNotice}</p>}
            {challenge && <small>{validChallenge ? "验证码 10 分钟内有效。" : "验证码已过期，请重新获取。"}</small>}
            <label>昵称（首次使用可选）<input autoComplete="nickname" name="nickname" maxLength={30} value={nickname} onChange={(event) => setNickname(event.target.value)} disabled={submitting} /></label>
            <label>邀请码（注册时填写，可选）<input name="referralCode" placeholder="粘贴好友的邀请码" inputMode="text" maxLength={32} autoCapitalize="characters" value={referralCode} onChange={(event) => setReferralCode(event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 32))} disabled={submitting} /><small>注册成功后，邀请人先获得 20 Credit。之后你每个北京时间日完成一轮成功对话，邀请人再获得 500 Credit，最多 3 天，同一天只发一次。</small></label>
          </> : <>
            <label>密码<span className={s.passwordField}><input autoComplete="current-password" name="password" type={showPassword ? "text" : "password"} placeholder="输入密码" required minLength={1} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} /><button type="button" className={s.passwordToggle} onClick={() => setShowPassword(value => !value)} disabled={submitting}>{showPassword ? "隐藏" : "显示"}</button></span>{!forgotPassword && <button type="button" className={s.forgotInline} onClick={enterForgotPassword} disabled={submitting}>忘记密码？</button>}</label>
          </>}
          </>}
          {(localError || error) && <p className={s.error} role="alert">{localError || error}</p>}
          <button className={s.submit} type="submit" disabled={submitting || (mode !== "register" && ((forgotPassword && (sending || unavailable || !validChallenge || code.length !== 6 || password.length < 12 || password !== confirmPassword)) || (!forgotPassword && method === "email" && (sending || unavailable || !validChallenge || code.length !== 6))))}>{submitting ? "正在连接…" : forgotPassword ? "重置密码" : mode === "register" ? "注册并保留记录" : method === "email" ? "验证并登录" : "登录"}</button>
        </form>
        {forgotPassword ? <footer><button type="button" onClick={leaveForgotPassword} disabled={submitting}>返回登录<Icon name="chevron" size={13} /></button></footer> : (mode === "register" || method === "password") && <footer><span>{mode === "register" ? "已有账号？" : "还没有账号？"}</span><button type="button" onClick={switchMode} disabled={submitting}>{mode === "register" ? "去登录" : "注册账号"}<Icon name="chevron" size={13} /></button></footer>}
        </div>
      </div>
    </div>
  );
}
