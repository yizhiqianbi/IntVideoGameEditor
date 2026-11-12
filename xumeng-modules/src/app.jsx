import { useEffect, useState } from "react";
import Studio from "./studio.jsx";
import { OUTERWEAR_COPY } from "./remove-outerwear-client.js";

export const MODULES = [
  { id: "face", label: "AI换脸", line: "一张脸，放进另一张画面", mark: "脸" },
  { id: "coat", label: OUTERWEAR_COPY.title, line: OUTERWEAR_COPY.line, mark: "衣" },
  { id: "video", label: "图生视频", line: "一张图，让它动起来", mark: "动" },
  { id: "image", label: "文生图", line: "写一句，出一张图", mark: "图" },
  { id: "novel", label: "AI小说", line: "写一段想看的剧情", mark: "文" },
];

export function findModule(id) {
  if (id === "undress" || id === "coat") return MODULES.find(item => item.id === "coat");
  return MODULES.find(item => item.id === id);
}

function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const read = () => setPath(window.location.pathname);
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  function go(href) {
    if (window.location.pathname !== href) window.history.pushState(null, "", href);
    setPath(href);
  }
  return { path, go };
}

function Shell({ go, children }) {
  return (
    <main>
      <header className="top">
        <button type="button" className="brand" onClick={() => go("/")}>叙梦</button>
      </header>
      {children}
      <p className="foot">只生成虚构的成年角色。</p>
    </main>
  );
}

function Home({ go }) {
  return (
    <Shell go={go}>
      <section className="home" aria-label="创作模块">
        <div className="list">
          {MODULES.map(item => (
            <button type="button" className="banner" data-id={item.id} key={item.id} onClick={() => go(`/${item.id}`)}>
              <span className="banner-copy">
                <strong>{item.label}</strong>
                <small>{item.line}</small>
              </span>
              <span className="banner-mark" aria-hidden="true">{item.mark}</span>
            </button>
          ))}
        </div>
      </section>
    </Shell>
  );
}

export default function App() {
  const { path, go } = useRoute();
  const id = path.replace(/^\//, "");
  if (!id) return <Home go={go} />;
  const item = findModule(id);
  if (!item) {
    return (
      <Shell go={go}>
        <section className="missing">
          <p>没有这个模块。</p>
          <button type="button" className="primary" onClick={() => go("/")}>返回</button>
        </section>
      </Shell>
    );
  }
  return (
    <Shell go={go}>
      <Studio item={item} />
    </Shell>
  );
}
