"use client";

import Link from "next/link";
import { useState } from "react";

type CanvasItem = { id: string; kind: "image" | "video" | "note"; title: string; meta: string; left: number; top: number };

const initialItems: CanvasItem[] = [
  { id: "hero", kind: "image", title: "雨夜 · 酒店套房", meta: "参考图 / 1K", left: 390, top: 90 },
  { id: "character", kind: "image", title: "林晚 · 26岁", meta: "角色参考 / 已锁定", left: 650, top: 248 },
  { id: "shot", kind: "video", title: "门关上之后", meta: "RI2V / 15s / 草稿", left: 905, top: 104 },
  { id: "logline", kind: "note", title: "故事核心", meta: "两个人的选择发生在门关上之后。", left: 150, top: 238 },
];

export default function WorkspaceHome() {
  const [items, setItems] = useState(initialItems);
  const [prompt, setPrompt] = useState("");
  const [activeTool, setActiveTool] = useState("选择");
  const [notice, setNotice] = useState("画布已准备好");

  function runAgent() {
    const copy = prompt.trim();
    if (!copy) { setNotice("告诉 Agent 你想创作什么"); return; }
    setNotice("Agent 正在理解你的画布…");
    window.setTimeout(() => {
      setItems((current) => [...current, { id: `note-${Date.now()}`, kind: "note", title: "Agent 读到的新想法", meta: copy, left: 380, top: 480 }]);
      setPrompt("");
      setNotice("已把想法放到画布上");
    }, 600);
  }

  return <main className="loomic-shell">
    <header className="loomic-topbar"><div className="loomic-brand"><span className="brand-mark">P</span><span>PENCIL</span><small>STUDIO</small></div><div className="workspace-name">未命名项目 <span>⌄</span></div><div className="topbar-right"><span className="save-state"><i /> 已保存</span><button className="topbar-button">分享 ↗</button><button className="avatar">BS</button></div></header>
    <div className="loomic-body">
      <aside className="loomic-sidebar">
        <button className="new-project" onClick={() => setNotice("已创建新的空白画布")}>＋ <span>新建项目</span></button>
        <div className="side-section"><span className="side-label">工作区</span><button className="side-link active"><span>◈</span> 全部画布 <b>4</b></button><button className="side-link"><span>✦</span> 我的收藏</button><button className="side-link"><span>▧</span> 最近使用</button></div>
        <div className="side-section project-section"><div className="side-label-row"><span className="side-label">项目</span><button onClick={() => setNotice("项目菜单已打开")}>＋</button></div><button className="project-link selected"><i /> 门关上之后 <small>3</small></button><button className="project-link"><i /> 雨夜人物设定</button><button className="project-link"><i /> 品牌视觉探索</button></div>
        <div className="side-bottom"><button className="side-link"><span>⚙</span> 设置</button><button className="side-link"><span>?</span> 帮助中心</button><div className="side-account"><span className="avatar">BS</span><span><b>boing shaw</b><small>Pro workspace</small></span><span>•••</span></div></div>
      </aside>

      <section className="loomic-main">
        <div className="canvas-toolbar"><div className="toolbar-tools"><button className={activeTool === "选择" ? "tool active" : "tool"} onClick={() => setActiveTool("选择")}>⌁ <span>选择</span></button><button className={activeTool === "文字" ? "tool active" : "tool"} onClick={() => setActiveTool("文字")}>T <span>文字</span></button><button className={activeTool === "素材" ? "tool active" : "tool"} onClick={() => setActiveTool("素材")}>◉ <span>素材</span></button><span className="tool-divider" /><button className="tool" onClick={() => setNotice("画布已整理")}>⌘ <span>整理布局</span></button></div><div className="canvas-actions"><button onClick={() => setNotice("已撤销上一步操作")}>↶</button><button onClick={() => setNotice("已重做")}>↷</button><span className="tool-divider" /><button onClick={() => setItems([])}>清空画布</button><button className="canvas-zoom">85%　−　＋</button></div></div>
        <div className="loomic-canvas"><div className="loomic-canvas-grid" /><div className="canvas-location"><span>CANVAS / 门关上之后</span><small>{items.length} 个元素</small></div><div className="canvas-ruler">{["01","02","03","04","05"].map((x) => <span key={x}>{x}</span>)}</div>{items.map((item) => <button key={item.id} className={`loomic-item ${item.kind} ${item.id === "shot" ? "item-focus" : ""}`} style={{ left: item.left, top: item.top }} onClick={() => setNotice(`已选中：${item.title}`)}><div className="item-image">{item.kind === "image" && item.id === "hero" ? <div className="art-room"><i /><b /></div> : null}{item.kind === "image" && item.id === "character" ? <div className="art-person"><i /><b /></div> : null}{item.kind === "video" ? <div className="art-video"><span>▶</span><b>01</b></div> : null}{item.kind === "note" ? <div className="art-note">✦</div> : null}</div><div className="item-info"><strong>{item.title}</strong><small>{item.meta}</small></div><span className="item-menu">•••</span></button>)}<div className="canvas-connector connector-one" /><div className="canvas-connector connector-two" /><div className="canvas-minimap"><span>CANVAS MAP</span><i /><b /><em /></div><div className="canvas-floating"><button>＋</button><button>−</button><button>⌗</button></div><div className="canvas-status">{notice}<span>×</span></div></div>
      </section>

      <aside className="loomic-agent"><div className="agent-heading"><div><span className="side-label">PENCIL AGENT</span><h1>一起创作。</h1></div><button onClick={() => setNotice("Agent 面板已收起")}>−</button></div><p className="agent-copy">描述你的想法。Agent 会理解当前画布，把它变成可以继续编辑的视觉素材。</p><div className="agent-chips"><button onClick={() => setPrompt("把这个故事整理成 3 个电影感分镜")}>生成分镜</button><button onClick={() => setPrompt("为林晚补一张正面角色参考图")}>补充参考图</button><button onClick={() => setPrompt("让这组画面更像雨夜悬疑短剧")}>统一氛围</button></div><div className="agent-messages"><div className="agent-message"><span className="agent-avatar">✦</span><p>我看到了一个角色、一处场景和一个待生成镜头。你可以让我继续扩展故事，也可以直接打开视频工作台。</p></div><div className="agent-message user-message"><p>先把门关上之后做成一段 15 秒镜头。</p></div></div><div className="agent-composer"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); runAgent(); } }} placeholder="让 Agent 帮你做点什么…" /><div className="composer-tools"><button>＋</button><span>Shift + Enter 换行</span><button className="send-button" onClick={runAgent}>↑</button></div></div><div className="video-entry"><div><span className="video-icon">▶</span><span><b>视频工作台</b><small>分镜、首帧、参考图与 H3 生成</small></span></div><Link href="/studio">打开 ↗</Link></div><div className="agent-footer"><span>模型</span><button>Grok 4.6　⌄</button><span className="model-status">● 在线</span></div></aside>
    </div>
  </main>;
}
