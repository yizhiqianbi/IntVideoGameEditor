"use client";

import { useState } from "react";
import type { XumengLocale } from "../../lib/xumeng-i18n";
import { xumengPage } from "../../lib/xumeng-page-copy";
import { AigenEdit } from "./aigen-edit";
import Icon from "./icons";
import s from "./aigen-hub.module.css";

type Props = { locale?: XumengLocale; onRoute: (route: string) => void; onBack: () => void };

const KIND_KEY = "xumeng-aigen-kind";

/** 站内 AI 生成工作台：生图 / 图生视频 / 小说原生入口，换脸与换造型逐步原生接入。 */
export function AigenHub({ locale = "zh-Hans", onRoute, onBack }: Props) {
  const copy = xumengPage(locale);
  const [mode, setMode] = useState<"hub" | "face" | "coat">("hub");
  const open = (kind: "image" | "video") => {
    try { sessionStorage.setItem(KIND_KEY, kind); } catch { /* storage may be unavailable */ }
    onRoute("generation");
  };
  if (mode !== "hub") return <AigenEdit kind={mode} locale={locale} onBack={() => setMode("hub")} />;
  return <main className={s.page}>
    <header className={s.header}>
      <button type="button" className={s.back} onClick={onBack}><Icon name="back" size={16} />{copy.back}</button>
      <div className={s.title}><h1>{copy.generate}</h1><p>角色封面 · 图生视频 · 文生图 · 小说</p></div>
    </header>
    <section className={s.grid} aria-label={copy.generate}>
      <button type="button" className={`${s.card} ${s.feature}`} onClick={() => open("video")}>
        <span className={s.mark}><Icon name="video" size={22} /></span>
        <span className={s.copy}><strong>图生视频</strong><small>上传一张图，让它动起来</small></span>
        <span className={s.go}><Icon name="chevron" size={16} /></span>
      </button>
      <button type="button" className={`${s.card} ${s.feature}`} onClick={() => open("image")}>
        <span className={s.mark}><Icon name="image" size={22} /></span>
        <span className={s.copy}><strong>AI 生图</strong><small>文字或参考图，生成专属画面</small></span>
        <span className={s.go}><Icon name="chevron" size={16} /></span>
      </button>
      <button type="button" className={s.card} onClick={() => onRoute("novels/new/novel")}>
        <span className={s.mark}><Icon name="book" size={20} /></span>
        <span className={s.copy}><strong>AI 小说</strong><small>写一段想看的剧情</small></span>
        <span className={s.go}><Icon name="chevron" size={16} /></span>
      </button>
      <button type="button" className={s.card} onClick={() => setMode("face")}>
        <span className={s.mark}><Icon name="sparkles" size={20} /></span>
        <span className={s.copy}><strong>AI 换脸</strong><small>画面图 + 人脸图，只替换面部</small></span>
        <span className={s.go}><Icon name="chevron" size={16} /></span>
      </button>
      <button type="button" className={s.card} onClick={() => setMode("coat")}>
        <span className={s.mark}><Icon name="user" size={20} /></span>
        <span className={s.copy}><strong>换造型</strong><small>一张图，按提示词换外层造型</small></span>
        <span className={s.go}><Icon name="chevron" size={16} /></span>
      </button>
    </section>
    <p className={s.note}>生图与图生视频消耗金币；小说在工作台里创作。只生成虚构的成年角色。</p>
  </main>;
}

export default AigenHub;
