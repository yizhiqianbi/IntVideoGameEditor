"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Icon from "./icons";
import { createDzmmShare, type DzmmShare } from "../../lib/dzmm-shares";
import s from "./share-game.module.css";

type Props = { title: string; synopsis: string; sourceId: string; onClose: () => void };

const W = 720, H = 1080;

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const char of Array.from(text.replace(/\s+/g, " ").trim())) {
    const next = current + char;
    if (context.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = char;
      if (lines.length >= maxLines) break;
    } else current = next;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.join("").length < text.trim().length) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  return lines;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath(); context.moveTo(x + r, y); context.arcTo(x + w, y, x + w, y + h, r); context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r); context.arcTo(x, y, x + w, y, r); context.closePath();
}

export function ShareGame({ title, synopsis, sourceId, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [share, setShare] = useState<DzmmShare | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    void createDzmmShare({ kind: "game", title, body: synopsis, sourceId }, controller.signal)
      .then(value => { if (!stopped) setShare(value); })
      .catch(reason => { if (!stopped && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "分享卡片生成失败。"); })
      .finally(() => { if (!stopped) setBusy(false); });
    return () => { stopped = true; controller.abort(); };
  }, [sourceId, title, synopsis]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !share) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let cancelled = false;
    canvas.width = W; canvas.height = H;
    void (async () => {
      const background = context.createLinearGradient(0, 0, W, H);
      background.addColorStop(0, "#2b1020"); background.addColorStop(.55, "#180b14"); background.addColorStop(1, "#0d060a");
      context.fillStyle = background; context.fillRect(0, 0, W, H);
      const glow = context.createRadialGradient(560, 130, 10, 560, 130, 430);
      glow.addColorStop(0, "rgba(228,85,127,.55)"); glow.addColorStop(1, "rgba(228,85,127,0)");
      context.fillStyle = glow; context.fillRect(0, 0, W, H);
      const gold = context.createRadialGradient(110, 900, 10, 110, 900, 300);
      gold.addColorStop(0, "rgba(215,173,120,.22)"); gold.addColorStop(1, "rgba(215,173,120,0)");
      context.fillStyle = gold; context.fillRect(0, 0, W, H);
      context.strokeStyle = "rgba(255,255,255,.1)"; context.lineWidth = 2; context.strokeRect(36, 36, W - 72, H - 72);

      context.fillStyle = "#f8e8eb";
      context.font = '600 26px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      context.fillText("叙梦", 72, 108);
      context.fillStyle = "#c79aa9"; context.font = '500 16px -apple-system, "PingFang SC", sans-serif';
      context.fillText("XUMENG · GAME SHARE", 72, 136);
      context.fillStyle = "#e8c8a0"; context.font = '600 15px -apple-system, "PingFang SC", sans-serif';
      context.fillText("我在叙梦玩过", 72, 246);

      context.fillStyle = "#fff6f8"; context.font = '700 52px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      const titleLines = wrapText(context, share.title, W - 144, 3);
      titleLines.forEach((line, index) => context.fillText(line, 72, 318 + index * 64));

      context.fillStyle = "#d8b6c2"; context.font = '400 24px -apple-system, "PingFang SC", sans-serif';
      const bodyLines = wrapText(context, share.body || "在叙梦里，每一个选择都会留下故事。", W - 144, 6);
      bodyLines.forEach((line, index) => context.fillText(line, 72, 512 + index * 40));

      const qrSize = 210, cardX = W - 72 - qrSize - 28, cardY = 790;
      context.fillStyle = "rgba(255,255,255,.96)"; roundRect(context, cardX - 16, cardY - 16, qrSize + 32, qrSize + 100, 22); context.fill();
      const qrCanvas = document.createElement("canvas");
      await QRCode.toCanvas(qrCanvas, share.url, { width: qrSize, margin: 1, color: { dark: "#1a0c14", light: "#ffffff" } });
      if (cancelled) return;
      context.drawImage(qrCanvas, cardX, cardY);
      context.fillStyle = "#3a1a28"; context.font = '600 18px -apple-system, "PingFang SC", sans-serif';
      context.textAlign = "center"; context.fillText("扫码来到叙梦", cardX + qrSize / 2, cardY + qrSize + 34);
      context.textAlign = "left";
      context.fillStyle = "#f8e8eb"; context.font = '500 18px -apple-system, "PingFang SC", sans-serif';
      context.fillText(share.author, 72, 900);
      context.fillStyle = "#9d7386"; context.font = '400 14px -apple-system, "PingFang SC", sans-serif';
      context.fillText(share.url.replace("https://", ""), 72, 928);
      context.fillStyle = "#c79aa9"; context.font = '400 14px -apple-system, "PingFang SC", sans-serif';
      context.fillText("分享自 xumengchat.top", 72, 1000);
    })();
    return () => { cancelled = true; };
  }, [share]);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `叙梦-${(share?.title ?? "分享").slice(0, 20)}.png`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  }

  async function copy() {
    if (!share) return;
    try { await navigator.clipboard.writeText(share.url); setStatus("链接已复制"); }
    catch { setStatus("复制失败，请手动复制下方链接"); }
    window.setTimeout(() => setStatus(""), 2200);
  }

  return <div className={s.backdrop} role="dialog" aria-modal="true" aria-label="分享游戏">
    <div className={s.sheet}>
      <header className={s.head}>
        <div><p>分享卡片</p><h2>{title}</h2></div>
        <button type="button" className={s.close} onClick={onClose} aria-label="关闭"><Icon name="close" size={18} /></button>
      </header>
      {busy && <p className={s.hint} role="status">正在生成海报…</p>}
      {error && <div className={s.errorBox} role="alert"><p>{error}</p><button type="button" onClick={onClose}>关闭</button></div>}
      {!busy && !error && share && <>
        <div className={s.poster}><canvas ref={canvasRef} aria-label="分享海报预览" /></div>
        <p className={s.caption}>扫码打开分享页，也可以保存海报发到微信 / 小红书。</p>
        <div className={s.actions}>
          <button type="button" className={s.primary} onClick={download}><Icon name="download" size={16} />保存海报</button>
          <button type="button" className={s.secondary} onClick={() => void copy()}><Icon name="copy" size={16} />复制链接</button>
          <a className={s.secondary} href={share.url} target="_blank" rel="noopener noreferrer">打开分享页</a>
        </div>
        {status && <p className={s.status} role="status">{status}</p>}
      </>}
    </div>
  </div>;
}

export default ShareGame;
