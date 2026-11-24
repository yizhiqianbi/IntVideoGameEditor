"use client";

import Link from "next/link";
import { useState } from "react";

const shots = ["门关上之后", "衬衫滑落", "贴着墙"];

export default function StudioPreview() {
  const [activeShot, setActiveShot] = useState(0);
  const [prompt, setPrompt] = useState("15秒连续中近景，镜头缓慢推近。暖色室内光，门外脚步声停下。");
  const [notice, setNotice] = useState("工作台预览模式");

  return <main className="studio-shell">
    <header className="studio-nav"><Link className="wordmark" href="/">PENCIL<span>STUDIO</span></Link><span className="studio-project">TOONFLOW / 门关上之后</span><div className="studio-actions"><span className="connection"><i /> GPU 已就绪</span><Link href="/" className="studio-exit">返回产品页</Link></div></header>
    <div className="studio-layout">
      <aside className="director-panel"><p className="small-label">DESIRE / DIRECTOR</p><h1>情绪分镜<br />Agent</h1><p className="panel-subtitle">欲望 → 身体设定 → 分镜 → 成片</p><label>情绪尺度</label><div className="dark-select">常规剧情 <span>⌄</span></div><p className="helper">悬疑与人物冲突，不含色情</p><label>故事梗概</label><textarea defaultValue="26岁的林晚和29岁的周衡在酒店套房门口争执。门关上之后，走廊里的脚步声停在门外。" /><button className="primary-control" onClick={() => setNotice("剧本 Agent 已整理出 3 个镜头")}>生成剧本与分镜 ↗</button><button className="secondary-control" onClick={() => setNotice("已载入示例故事")}>载入示例故事</button><div className="panel-divider" /><details><summary>固定提示词</summary><p>电影级灯光，连贯的角色外观，真实材质，保持镜头语言统一。</p></details><div className="asset-heading"><span>素材与设定</span><small>3 张卡片</small></div><div className="asset-list"><span>◎ 林晚 · 26岁 <small>参考</small></span><span>◎ 周衡 · 29岁 <small>参考</small></span><span>◇ 酒店套房 · 夜 <small>场景</small></span></div></aside>
      <section className="workspace-panel"><div className="workspace-toolbar"><span>情绪分镜画布 · 拖入身体参考图</span><div><button>撤销</button><button>重做</button><button>全选</button><button>复制</button><button>删除</button><button>整理布局</button><button onClick={() => setNotice("画布已清空")}>清空画布</button></div></div><div className="workspace-canvas"><div className="workspace-grid" /><div className="canvas-hint">PROJECT / 门关上之后 <span>·</span> 3 SHOTS</div><div className="work-reference reference-one"><span>REFERENCE / 参考卡</span><div className="work-portrait" /><b>林晚 · 26岁</b><small>生成女性，黑色长发，锁骨清晰</small></div><div className="work-reference reference-two"><span>REFERENCE / 参考卡</span><div className="work-pair" /><b>周衡 · 29岁</b><small>短发，背肩宽，深色衬衫</small></div><div className="work-scene"><span>SCENE / 场景卡</span><div className="work-room" /><b>酒店套房 · 夜</b><small>暖色灯光，深色木门</small></div>{shots.map((shot, i) => <button key={shot} className={`work-shot ${activeShot === i ? "selected" : ""}`} style={{ left: `${i * 245 + 490}px`, top: `${i === 0 ? 94 : i === 1 ? 250 : 94}px` }} onClick={() => setActiveShot(i)}><span>SHOT 0{i + 1}<em>{i === 0 ? "RI2V" : "T2V"} · 15s</em></span><b>0{i + 1}</b><strong>{shot}</strong><small>{i === 0 ? "待生成画面" : "草稿镜头 · 点击编辑"}</small></button>)}<div className="zoom-control"><span>+</span><span>−</span><span>⌗</span></div></div></section>
      <aside className="shot-panel"><p className="small-label">0{activeShot + 1} / SHOT DETAILS</p><div className="shot-panel-heading"><h2>{shots[activeShot]}</h2><span className="status-ready"><i /> 草稿</span></div><label>画面 Prompt</label><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /><label>避免出现的内容</label><textarea className="muted-input" defaultValue="无画面闪烁、无画面突变、无文字水印" /><label>生成模式</label><div className="dark-select">{activeShot === 0 ? "RI2V · 15s" : "T2V · 15s"}<span>⌄</span></div><label>视频模型</label><div className="dark-select">MiniMax H3 · 自有 GPU<span>⌄</span></div><button className="generate-button" onClick={() => setNotice(`镜头 0${activeShot + 1} 已加入生成队列`)}>生成 15s 镜头 ↗</button><div className="notice-bar">{notice}</div></aside>
    </div>
  </main>;
}
