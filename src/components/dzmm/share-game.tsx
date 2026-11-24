"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import Icon from "./icons";
import { createDzmmShare, type DzmmShare } from "../../lib/dzmm-shares";
import { shareHookLine, sharePosterFileName, sharePosterImageUrl } from "../../lib/xumeng-share-poster";
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

export type XumengSharePoster = {
  title: string;
  hook: string;
  coverUrl?: string;
  url?: string;
  kicker?: string;
};

const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", sans-serif';

type LoadedImage = { image: HTMLImageElement; url: string };

async function loadImage(url: string): Promise<LoadedImage | null> {
  if (!url) return null;
  let objectUrl = "";
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size < 32 || (blob.type && !blob.type.startsWith("image/"))) return null;
    objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image"));
      image.src = objectUrl;
    });
    return { image, url: objectUrl };
  } catch {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return null;
  }
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  if (!image.naturalWidth || !image.naturalHeight) return;
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = Math.max(0, (image.naturalWidth - sw) / 2);
  const sy = Math.max(0, (image.naturalHeight - sh) * 0.12);
  context.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}

async function paintSharePoster(canvas: HTMLCanvasElement, poster: XumengSharePoster): Promise<void> {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("海报画布不可用。");
  canvas.width = W;
  canvas.height = H;
  const pageOrigin = location.origin;
  const [cover, mark] = await Promise.all([
    loadImage(sharePosterImageUrl(poster.coverUrl ?? "", pageOrigin)),
    loadImage("/assets/xumeng/brand/xumeng-mark.svg"),
  ]);
  try {
    const background = context.createLinearGradient(0, 0, W, H);
    background.addColorStop(0, "#2b1020");
    background.addColorStop(0.55, "#180b14");
    background.addColorStop(1, "#0d060a");
    context.fillStyle = background;
    context.fillRect(0, 0, W, H);
    const glow = context.createRadialGradient(560, 120, 10, 560, 120, 460);
    glow.addColorStop(0, "rgba(228,85,127,.42)");
    glow.addColorStop(1, "rgba(228,85,127,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, W, H);
    if (cover) drawCover(context, cover.image, 0, 0, W, H);

    const shade = context.createLinearGradient(0, H * 0.38, 0, H);
    shade.addColorStop(0, "rgba(12,6,10,0)");
    shade.addColorStop(0.34, "rgba(12,6,10,0.18)");
    shade.addColorStop(0.68, "rgba(18,8,15,0.9)");
    shade.addColorStop(1, "#12080f");
    context.fillStyle = shade;
    context.fillRect(0, 0, W, H);
    const top = context.createLinearGradient(0, 0, 0, 190);
    top.addColorStop(0, "rgba(12,6,10,0.62)");
    top.addColorStop(1, "rgba(12,6,10,0)");
    context.fillStyle = top;
    context.fillRect(0, 0, W, 190);

    context.fillStyle = "rgba(18,8,15,0.5)";
    roundRect(context, 40, 36, mark ? 214 : 168, 68, 34);
    context.fill();
    if (mark) {
      context.drawImage(mark.image, 50, 44, 52, 52);
    } else {
      context.fillStyle = "#d94c77";
      context.beginPath();
      context.arc(76, 70, 22, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fff6f8";
      context.font = `700 20px ${FONT}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("叙", 76, 71);
    }
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    canvas.dataset.shareCover = cover ? "loaded" : "missing";
    context.fillStyle = "#f8e8eb";
    context.font = `600 28px ${FONT}`;
    context.fillText("叙梦", mark ? 114 : 108, 78);
    context.fillStyle = "#e8c8a0";
    context.font = `600 14px ${FONT}`;
    context.fillText("XUMENG", mark ? 114 : 108, 100);

    const url = poster.url?.trim() ?? "";
    const textX = 56;
    const textWidth = url ? 420 : W - 112;
    const kicker = poster.kicker?.trim() || "叙梦";
    const hook = shareHookLine(poster.hook);
    context.font = `600 20px ${FONT}`;
    const kickerLine = wrapText(context, kicker, textWidth, 1)[0] ?? kicker;
    context.font = `700 52px ${FONT}`;
    const titleLines = wrapText(context, poster.title.trim() || "叙梦", textWidth, 2);
    context.font = `400 26px ${FONT}`;
    const hookLines = wrapText(context, hook, textWidth, 2);
    let cursor = 790;
    context.shadowColor = "rgba(0,0,0,.72)";
    context.shadowBlur = 16;
    context.shadowOffsetY = 2;
    context.fillStyle = "#e8c8a0";
    context.font = `600 20px ${FONT}`;
    context.fillText(kickerLine, textX, cursor);
    cursor += 64;
    context.fillStyle = "#fff6f8";
    context.font = `700 52px ${FONT}`;
    titleLines.forEach((line) => {
      context.fillText(line, textX, cursor);
      cursor += 64;
    });
    cursor += 6;
    context.fillStyle = "#f3d5df";
    context.font = `400 26px ${FONT}`;
    hookLines.forEach((line) => {
      context.fillText(line, textX, cursor);
      cursor += 38;
    });

    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    if (url) {
      try {
        const qrSize = 168;
        const cardX = W - 56 - qrSize;
        const cardY = 812;
        context.fillStyle = "rgba(255,255,255,.96)";
        roundRect(context, cardX - 14, cardY - 14, qrSize + 28, qrSize + 58, 18);
        context.fill();
        const qr = document.createElement("canvas");
        await QRCode.toCanvas(qr, url, { width: qrSize, margin: 1, color: { dark: "#1a0c14", light: "#ffffff" } });
        context.drawImage(qr, cardX, cardY);
        context.fillStyle = "#3a1a28";
        context.font = `600 16px ${FONT}`;
        context.textAlign = "center";
        context.fillText("扫码打开", cardX + qrSize / 2, cardY + qrSize + 30);
        context.textAlign = "left";
      } catch { /* The written link stays on the poster when the code cannot be drawn. */ }
    }

    context.fillStyle = "#c79aa9";
    context.font = `500 16px ${FONT}`;
    context.fillText("xumengchat.top", textX, 1036);
  } finally {
    if (cover) URL.revokeObjectURL(cover.url);
    if (mark) URL.revokeObjectURL(mark.url);
  }
}

export function SharePoster({ poster, onClose }: { poster: XumengSharePoster; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState("");
  const [coverState, setCoverState] = useState("");
  const [failed, setFailed] = useState("");
  const [canShareFile, setCanShareFile] = useState(false);
  const [status, setStatus] = useState("");
  const fileName = sharePosterFileName(poster.title);
  const shareUrl = poster.url?.trim() ?? "";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    setPreview("");
    setCoverState("");
    setFailed("");
    setCanShareFile(false);
    blobRef.current = null;
    void paintSharePoster(canvas, poster).then(async () => {
      if (cancelled) return;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), "image/png"));
      if (cancelled) return;
      if (!blob) { setFailed("海报没有生成，请重试。"); return; }
      blobRef.current = blob;
      const file = new File([blob], fileName, { type: "image/png" });
      setCanShareFile(Boolean(navigator.canShare?.({ files: [file] })));
      setCoverState(canvas.dataset.shareCover === "loaded" ? "loaded" : "missing");
      setPreview(canvas.toDataURL("image/png"));
    }).catch(() => {
      if (!cancelled) setFailed("海报没有生成，请重试。");
    });
    return () => { cancelled = true; };
  }, [fileName, poster]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function download() {
    const blob = blobRef.current;
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    setStatus("海报已保存");
  }

  async function shareFile() {
    const blob = blobRef.current;
    if (!blob) return;
    const file = new File([blob], fileName, { type: "image/png" });
    const payload: ShareData = { files: [file], title: poster.title, text: shareHookLine(poster.hook) };
    if (!navigator.canShare?.(payload)) { download(); return; }
    try {
      await navigator.share(payload);
      setStatus("已交给系统分享");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      download();
      setStatus("系统分享不可用，已改为保存海报");
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("链接已复制");
    } catch {
      setStatus("复制失败，请手动复制下方链接");
    }
  }

  const sheet = <div className={s.backdrop} role="dialog" aria-modal="true" aria-label="分享海报">
    <div className={s.sheet}>
      <header className={s.head}>
        <div><p>分享海报</p><h2>{poster.title}</h2></div>
        <button ref={closeRef} type="button" className={s.close} onClick={onClose} aria-label="关闭"><Icon name="close" size={18} /></button>
      </header>
      <canvas ref={canvasRef} className={s.buffer} aria-hidden="true" />
      {preview && <div className={s.poster}><img src={preview} alt="分享海报预览" data-share-poster="ready" data-share-cover={coverState} /></div>}
      {!preview && !failed && <p className={s.hint} role="status">正在生成海报…</p>}
      {failed && <div className={s.errorBox} role="alert"><p>{failed}</p><button type="button" onClick={onClose}>关闭</button></div>}
      {preview && !failed && <>
        <p className={s.caption}>{shareUrl ? "海报带封面、名字和二维码。可以保存，或发到微信 / 小红书。" : "保存这张海报再发出去。这张卡还没有公开链接。"}</p>
        <div className={s.actions}>
          {canShareFile && <button type="button" className={s.primary} onClick={() => void shareFile()}><Icon name="send" size={16} />分享海报</button>}
          <button type="button" className={canShareFile ? s.secondary : s.primary} onClick={download}><Icon name="download" size={16} />保存海报</button>
          {shareUrl && <button type="button" className={s.secondary} onClick={() => void copyLink()}><Icon name="copy" size={16} />复制链接</button>}
        </div>
        {shareUrl && <p className={s.url}>{shareUrl}</p>}
        {status && <p className={s.status} role="status">{status}</p>}
      </>}
    </div>
  </div>;

  if (typeof document === "undefined") return sheet;
  return createPortal(sheet, document.body);
}
