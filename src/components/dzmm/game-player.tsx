"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildXumengGamePreview, type XumengGame } from "../../lib/xumeng-games";
import Icon from "./icons";
import s from "./game-player.module.css";

export type GamePlayerProps = { game: XumengGame; onBack: () => void };

/** The host is a display shell; the game's HTML owns its own interaction. */
export function GamePlayer(props: GamePlayerProps) {
  return <HtmlGameShell key={`${props.game.id}:${props.game.version}`} {...props} />;
}

function FullscreenIcon({ active }: { active: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={active ? "M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6" : "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"} /></svg>;
}

function HtmlGameShell({ game, onBack }: GamePlayerProps) {
  const [running, setRunning] = useState(false);
  const [revision, setRevision] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [displayError, setDisplayError] = useState("");
  const shell = useRef<HTMLElement>(null), mounted = useRef(false);
  const preview = useMemo(() => {
    try { return { document: buildXumengGamePreview(game.source), error: "" }; }
    catch (failure) { return { document: "", error: failure instanceof Error ? failure.message : "游戏文件无法打开，请返回作品列表重试。" }; }
  }, [game.source]);
  useEffect(() => {
    mounted.current = true;
    setFullscreenAvailable(Boolean(document.fullscreenEnabled && shell.current?.requestFullscreen));
    const update = () => { if (mounted.current) setFullscreen(document.fullscreenElement === shell.current); };
    document.addEventListener("fullscreenchange", update);
    return () => { mounted.current = false; document.removeEventListener("fullscreenchange", update); };
  }, []);
  async function toggleFullscreen() {
    const target = shell.current;
    if (!target) return;
    setDisplayError("");
    try {
      if (document.fullscreenElement === target) await document.exitFullscreen();
      else await target.requestFullscreen();
    } catch { if (mounted.current) setDisplayError("浏览器未能切换整屏，可继续在当前窗口游玩。"); }
  }
  function restart() {
    if (!window.confirm("重新运行会重置这个窗口中的游戏状态。是否继续？")) return;
    setRevision(value => value + 1); setDisplayError("");
  }
  return <main ref={shell} className={s.player} aria-label={`${game.title}游戏`}>
    <header className={s.header}>
      <button className={s.iconButton} onClick={onBack} aria-label="返回游戏列表"><Icon name="back" size={19} /></button>
      <div className={s.heading}><p>游戏</p><h1>{game.title}</h1></div>
      <div className={s.actions}>
        {running && <button className={s.secondary} onClick={restart}><Icon name="refresh" size={15} />重新运行</button>}
        {fullscreenAvailable && <button className={s.secondary} onClick={() => void toggleFullscreen()} aria-pressed={fullscreen}><FullscreenIcon active={fullscreen} />{fullscreen ? "退出整屏" : "整屏查看"}</button>}
      </div>
    </header>
    {(preview.error || displayError) && <p className={s.error} role="alert">{preview.error || displayError}</p>}
    {!preview.error && <section className={s.canvas} aria-label="游戏窗口">
      {running ? <iframe key={revision} className={s.htmlFrame} title={`${game.title} · 游戏`} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" srcDoc={preview.document} /> : <div className={s.intro}><div className={s.introContent}>
        <div className={s.playMark}><Icon name="play" size={26} /></div>
        <h2>{game.title}</h2>
        {game.synopsis && <p>{game.synopsis}</p>}
        <button className={s.primary} onClick={() => setRunning(true)}><Icon name="play" size={17} />开始游戏</button>
      </div></div>}
    </section>}
    <footer className={s.footer}><p>本窗口不提供自动存档，进度由游戏作品自行管理；离开或重新运行可能重置未保存的状态。</p></footer>
  </main>;
}
