"use client";

import { useEffect, useState } from "react";
import Studio from "./studio.jsx";
import { OUTERWEAR_COPY } from "./remove-outerwear-client.js";

export const MODULES = [
  { id: "face", label: "AI换脸", line: "一张脸，放进另一张画面", mark: "脸" },
  { id: "coat", label: OUTERWEAR_COPY.title, line: OUTERWEAR_COPY.line, mark: "衣" },
  { id: "video", label: "图生视频", line: "一张图，让它动起来", mark: "动" },
  { id: "image", label: "AI生图", line: "写文字，或加参考图", mark: "图" },
  { id: "novel", label: "AI小说", line: "写一段想看的剧情", mark: "文" },
];

export function findModule(id) {
  if (id === "undress" || id === "coat") return MODULES.find(item => item.id === "coat");
  return MODULES.find(item => item.id === id);
}

function useRoute() {
  const [path, setPath] = useState("/");
  useEffect(() => {
    const read = () => setPath(window.location.pathname);
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  function go(href) {
    if (window.location.pathname !== href) window.history.pushState(null, "", href);
    setPath(href);
  }
  return { path, go };
}

function Shell({ go, home = false, title, children }) {
  return (
    <main>
      {home ? null : (
        <header className="top">
          <button type="button" className="brand" onClick={() => go("/")}>返回</button>
          {title ? <h1 id="module-title" className="top-title">{title}</h1> : <span />}
          {title ? <button type="button" className="works" onClick={() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth" })}>我的作品</button> : <span />}
        </header>
      )}
      {children}
      <p className="foot">只生成虚构的成年角色。</p>
    </main>
  );
}

const HUB = {
  video: { label: "图生视频", line: "将图片转为动态视频" },
  image: { label: "AI生图", line: "输入文字，生成专属画面" },
  face: { label: "AI换脸", line: "上传图片，生成换脸作品" },
  coat: { label: OUTERWEAR_COPY.title, line: "一键变换造型" },
  novel: { label: "AI小说", line: "一键创作你的故事" },
};

function HubCard({ id, feature = false, go }) {
  const item = HUB[id];
  return (
    <button type="button" className={feature ? "tech-feature" : "tech-card"} data-id={id} onClick={() => go(`/${id}`)}>
      <span className="banner-copy">
        <strong>{item.label}</strong>
        <small>{item.line}</small>
      </span>
    </button>
  );
}

function Home({ go }) {
  const [fromXumeng, setFromXumeng] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFromXumeng(params.get("from") === "xumeng");
  }, []);
  return (
    <Shell go={go} home>
      <section className="home" aria-label="创作模块">
        <header className="xm-top">
          <span className="xm-top-brand"><i aria-hidden="true">☾</i>叙梦 <em>·</em> AI 生成</span>
          <a className="xm-back" href="https://xumengchat.top" target="_blank" rel="noopener noreferrer">返回叙梦 →</a>
        </header>
        {fromXumeng ? (
          <section className="xumeng-hero" aria-label="从叙梦进入">
            <p className="xm-kicker">从叙梦角色卡进入</p>
            <h1>把她的封面，做成一段视频</h1>
            <p className="xm-line">用角色封面作为第一帧生成图生视频；也可以文生图、换脸、换造型或写小说。</p>
            <div className="xm-actions">
              <button type="button" className="xm-primary" onClick={() => go("/video")}>用封面做视频</button>
              <button type="button" className="xm-ghost" onClick={() => go("/image")}>文生图</button>
            </div>
            <p className="xm-note">这里只生成虚构的成年角色。</p>
          </section>
        ) : (
          <header className="tech-hero">
            <p className="tech-kicker">AI科技</p>
            <h1>把想象变成作品</h1>
            <p>影像 · 故事 · 创意</p>
          </header>
        )}
        <HubCard id="video" feature go={go} />
        <div className="tech-grid">
          {["image", "face", "coat", "novel"].map(id => <HubCard id={id} key={id} go={go} />)}
        </div>
      </section>
    </Shell>
  );
}

export default function App() {
  const { path, go } = useRoute();
  const id = path.replace(/^\//, "");
  const content = !id ? <Home go={go} /> : (() => {
    const item = findModule(id);
    return item ? (
      <Shell go={go} title={item.label}>
        <Studio item={item} />
      </Shell>
    ) : (
      <Shell go={go}>
        <section className="missing">
          <p>没有这个模块。</p>
          <button type="button" className="primary" onClick={() => go("/")}>返回</button>
        </section>
      </Shell>
    );
  })();
  return <div className="modules">{content}</div>;
}
