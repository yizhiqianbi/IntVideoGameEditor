"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { VIDEO_TEMPLATES } from "@/lib/catalog";
import { MEDIA, findWorkTool } from "@/lib/workbench";
import { Gate, useAdult } from "../../gate";
import Workbench from "../../workbench";

export default function ToolPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const tool = findWorkTool(id);
  const gate = useAdult();
  const [group, setGroup] = useState("all");
  const [videoId, setVideoId] = useState(VIDEO_TEMPLATES[0]?.id ?? "");

  if (!gate.ready) return <main className="boot" />;
  if (gate.left) return <main className="gate"><p>已离开。</p></main>;
  if (!gate.adult) return <Gate enter={gate.enter} leave={gate.leave} />;
  if (!tool) return <main className="gate"><p>没有这个功能。</p><Link href="/">返回</Link></main>;

  const home = `/?c=${tool.media}`;

  return <main>
    <header className="top">
      <Link className="brand" href={home}>叙梦</Link>
      <nav aria-label="分类">
        {MEDIA.map(item => <Link key={item.id} href={`/?c=${item.id}`} aria-current={item.id === tool.media ? "page" : undefined}>{item.label}</Link>)}
      </nav>
    </header>
    <p className="crumb"><Link href={home}>返回{MEDIA.find(item => item.id === tool.media)?.label}</Link></p>
    <Workbench toolId={tool.id} group={group} videoId={videoId} onGroup={setGroup} onVideo={setVideoId} />
    <p className="foot">叙梦只生成虚构的成年角色。 <a href="/admin">模板后台</a></p>
  </main>;
}
