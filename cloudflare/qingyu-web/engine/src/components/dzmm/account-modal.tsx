"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent } from "react";
import type { DzmmAccountValues } from "@/lib/dzmm-cloud";
import {
  fetchDzmmEmailAuthConfig, requestDzmmEmailCode, requestDzmmPasswordResetCode, type DzmmEmailAuthConfig, type DzmmEmailCodeValues,
  type DzmmPasswordResetValues,
} from "@/lib/dzmm-email-auth";
import Icon from "./icons";
import { CommunityGuidelinesLink } from "./community-guidelines";
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
};

export default function AccountModal({ mode, onModeChange, onClose, onSubmit, onEmailSubmit, onPasswordReset, onClearError, submitting, error }: AccountModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [method, setMethod] = useState<"password" | "email">("password");
  const [forgotPassword, setForgotPassword] = useState(false);
  const [configuration, setConfiguration] = useState<DzmmEmailAuthConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState("");
  const [sendNotice, setSendNotice] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; email: string; expiresAt: number } | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const preferEmail = useRef(mode === "login");
  const methodSelected = useRef(false);
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
    void fetchDzmmEmailAuthConfig(controller.signal).then(result => {
      if (!mounted.current || controller.signal.aborted) return;
      setConfiguration(result);
      if (result.enabled && preferEmail.current && !methodSelected.current) setMethod("email");
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
    if (method === "email") {
      if (sending || !configuration?.enabled || !challenge || challenge.email !== emailRef.current) return;
      if (Date.now() >= challenge.expiresAt) { setLocalError("验证码已过期，请重新获取。"); return; }
      if (!/^[0-9]{6}$/.test(code)) { setLocalError("请输入邮件中的 6 位验证码。"); return; }
      setLocalError(""); onClearError(); verifying.current = true;
      const controller = new AbortController(); verifyController.current = controller;
      try { await onEmailSubmit({ email: challenge.email, challengeId: challenge.id, code, ...(nickname.trim() ? { nickname: nickname.trim() } : {}) }, controller.signal); }
      catch { /* Account adoption errors are displayed by the parent. */ }
      finally { verifying.current = false; if (verifyController.current === controller) verifyController.current = null; }
      return;
    }
    try { await onSubmit({ email: email.trim(), password, ...(mode === "register" ? { nickname: nickname.trim() } : {}) }); }
    catch { /* The parent displays the actual account API error. */ }
  }

  function switchMode() {
    setForgotPassword(false); selectMethod("password"); setPassword(""); setConfirmPassword("");
    onModeChange(mode === "register" ? "login" : "register");
  }

  function enterForgotPassword() {
    if (submitting || verifying.current) return;
    methodSelected.current = true;
    invalidateChallenge();
    setForgotPassword(true); setMethod("email"); setPassword(""); setConfirmPassword("");
    onModeChange("login");
  }

  function leaveForgotPassword() {
    if (submitting || verifying.current) return;
    setForgotPassword(false); selectMethod("password"); setPassword(""); setConfirmPassword("");
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
    methodSelected.current = true; invalidateChallenge(); setMethod(value); setPassword("");
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
      <div className={s.dialog} ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="account-title">
        <header><h2 id="account-title">{forgotPassword ? "重置密码" : method === "email" ? "邮箱验证码登录" : mode === "register" ? "创建账号" : "登录账号"}</h2><button type="button" onClick={onClose} disabled={submitting} aria-label="关闭账号窗口"><Icon name="close" /></button></header>
        {!forgotPassword && <div className={s.methods} role="group" aria-label="登录方式"><button type="button" aria-pressed={method === "email"} disabled={submitting} onClick={() => selectMethod("email")}>邮箱验证码</button><button type="button" aria-pressed={method === "password"} disabled={submitting} onClick={() => selectMethod("password")}>邮箱与密码</button></div>}
        <p className={s.hint}>{forgotPassword ? "通过邮箱验证码设置新的登录密码。" : method === "email" ? "验证邮箱后登录。首次使用会创建账号并保留当前游客记录；已有账号会加载该账号的记录。" : mode === "register" ? "注册后保留当前游客的角色、收藏和会话。" : "登录后加载这个账号的角色、收藏和会话。"}</p>
        {(configLoading || unavailable) && <p className={s.serviceNote} role="status">{configLoading ? "正在检查验证码登录服务…" : configError || configuration?.note || "邮箱验证码发送尚未配置，可使用邮箱与密码登录。"}</p>}
        <form className={s.form} onSubmit={submit}>
          <label>邮箱<input autoComplete="email" name="email" type="email" required maxLength={254} value={email} onChange={(event) => updateEmail(event.target.value)} disabled={submitting} /></label>
          {forgotPassword ? <>
            <div className={s.codeRow}><label>验证码<input autoComplete="one-time-code" name="resetCode" type="text" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={(event) => { setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6)); setLocalError(""); onClearError(); }} disabled={submitting || !validChallenge} /></label><button type="button" className={s.sendCode} onClick={() => void sendCode()} disabled={submitting || sending || unavailable || resendSeconds > 0}>{sending ? "正在发送…" : resendSeconds > 0 ? `${resendSeconds} 秒后重发` : challenge ? "重新发送" : "获取验证码"}</button></div>
            {sendNotice && <p className={s.sent} role="status">{sendNotice}</p>}
            {challenge && <small>{validChallenge ? "验证码 10 分钟内有效。" : "验证码已过期，请重新获取。"}</small>}
            <label>新密码<input autoComplete="new-password" name="newPassword" type="password" required minLength={12} maxLength={256} value={password} onChange={(event) => { setPassword(event.target.value); setLocalError(""); onClearError(); }} disabled={submitting} /><small>至少 12 个字符。</small></label>
            <label>确认新密码<input autoComplete="new-password" name="confirmPassword" type="password" required minLength={12} maxLength={256} value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setLocalError(""); onClearError(); }} disabled={submitting} /></label>
          </> : method === "email" ? <>
            <div className={s.codeRow}><label>验证码<input autoComplete="one-time-code" name="code" type="text" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={(event) => { setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6)); setLocalError(""); onClearError(); }} disabled={submitting || !validChallenge} /></label><button type="button" className={s.sendCode} onClick={() => void sendCode()} disabled={submitting || sending || unavailable || resendSeconds > 0}>{sending ? "正在发送…" : resendSeconds > 0 ? `${resendSeconds} 秒后重发` : challenge ? "重新发送" : "获取验证码"}</button></div>
            {sendNotice && <p className={s.sent} role="status">{sendNotice}</p>}
            {challenge && <small>{validChallenge ? "验证码 10 分钟内有效。" : "验证码已过期，请重新获取。"}</small>}
            <label>昵称（首次使用可选）<input autoComplete="nickname" name="nickname" maxLength={30} value={nickname} onChange={(event) => setNickname(event.target.value)} disabled={submitting} /></label>
          </> : <>
            {mode === "register" && <label>昵称<input autoComplete="nickname" name="nickname" required maxLength={30} value={nickname} onChange={(event) => setNickname(event.target.value)} disabled={submitting} /></label>}
            <label>密码<input autoComplete={mode === "register" ? "new-password" : "current-password"} name="password" type="password" required minLength={mode === "register" ? 12 : 1} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} />{mode === "register" && <small>至少 12 个字符。也可使用邮箱验证码创建账号。</small>}</label>
          </>}
          {(localError || error) && <p className={s.error} role="alert">{localError || error}</p>}
          <button className={s.submit} type="submit" disabled={submitting || forgotPassword && (sending || unavailable || !validChallenge || code.length !== 6 || password.length < 12 || password !== confirmPassword) || !forgotPassword && method === "email" && (sending || unavailable || !validChallenge || code.length !== 6)}>{submitting ? "正在连接…" : forgotPassword ? "重置密码" : method === "email" ? "验证并登录" : mode === "register" ? "注册并保留记录" : "登录"}</button>
        </form>
        <p className={s.guidelines}>社区交流与公开发布请遵守 <CommunityGuidelinesLink />。</p>
        {forgotPassword ? <footer><button type="button" onClick={leaveForgotPassword} disabled={submitting}>返回登录<Icon name="chevron" size={13} /></button></footer> : method === "password" && <footer><span>{mode === "register" ? "已有账号？" : "还没有账号？"}</span><button type="button" onClick={switchMode} disabled={submitting}>{mode === "register" ? "去登录" : "注册账号"}<Icon name="chevron" size={13} /></button>{mode === "login" && <button type="button" className={s.forgot} onClick={enterForgotPassword} disabled={submitting}>忘记密码？</button>}</footer>}
      </div>
    </div>
  );
}
