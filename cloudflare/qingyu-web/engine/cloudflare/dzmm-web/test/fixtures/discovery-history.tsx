/** Real CatalogDiscovery with an outer owner; detail intentionally unmounts it. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CatalogDiscovery, type CatalogDiscoveryFilters } from "../../../../src/components/dzmm/discovery-views";
import type { Character } from "../../../../src/lib/dzmm-characters";
import type { DzmmPreferences } from "../../../../src/lib/dzmm-storage";
import "../../src/page.css";

const now = Date.now();
const cover = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280"><rect width="400" height="280" fill="#c4d9cb"/><path d="M80 60h240v160H80zM200 60v160" fill="#eef4ec" stroke="#537763" stroke-width="8"/><text x="200" y="155" text-anchor="middle" font-size="24" fill="#314b3b">原创地图</text></svg>')}`;
function role(id: string, name: string, hoursAgo: number, heat: string, likes: string, tags = ["大世界", "一般向"]): Character {
  return { id, name, author: "本地原创验收", heat, likes, cover, tags,
    introduction: "地图与图书馆中的普通原创角色，用来检查分类筛选返回。", description: "角色协助旅人核对纸质地图。",
    personality: "细心、耐心。", scenario: "午后的原创图书馆。", firstMessage: "地图已经铺好，请来看看。",
    sourceUrl: "", sourceKind: "original", promptOrigin: "original", createdAt: new Date(now - hoursAgo * 3_600_000).toISOString() };
}
const characters = [
  role("qa-round13-map-morning", "地图员·晨间记录", 2, "10", "1"),
  role("qa-round13-map-afternoon", "地图员·午后记录", 1, "1", "10"),
  role("qa-round13-traveler", "远行者", 3, "5", "5"),
  role("qa-round13-map-old", "地图员·旧册", 45 * 24, "50", "50"),
  role("qa-round13-librarian", "图书馆管理员", 1, "3", "3", ["一般向"]),
];
const preferences: DzmmPreferences = { nickname: "本地验收", persona: "", preset: "", model: "balanced", dark: false, blockedTags: [] };
let blockedFetches = 0;
// No component in this fixture needs fetch. Reject any unexpected application request.
window.fetch = async () => {
  blockedFetches++;
  throw new Error("分类返回验收禁止 API 与外部请求。");
};

function Fixture() {
  const [filters, setFilters] = useState<CatalogDiscoveryFilters>({ sort: "hot", time: "all", query: "" });
  const [category, setCategory] = useState<string | null>("world");
  const [detail, setDetail] = useState<Character | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [visits, setVisits] = useState(0);
  const [returns, setReturns] = useState(0);
  const [mode, setMode] = useState<"controlled" | "uncontrolled">("controlled");
  function closeDetail() { setDetail(null); setReturns(value => value + 1); }
  function reset(nextMode: "controlled" | "uncontrolled") {
    setFilters({ sort: "hot", time: "all", query: "" }); setCategory("world"); setDetail(null);
    setVisits(0); setReturns(0); setFavorites([]); setMode(nextMode);
  }
  return <>
    <section className="fixture-panel" aria-label="分类返回隔离验收控制台">
      <h1>分类返回 · 真实组件隔离验收</h1>
      <p>只有普通原创测试角色；详情展示会卸载真实分类组件，返回时重新挂载。没有云端保存、模型、付款或投稿。</p>
      <p>使用真实控件：排序选“最新收录”、收录时间选“本月”、搜索“地图员”→应有 2 条结果→打开任一角色→返回→三项与结果应保留；再次查看详情仍应保留。</p>
      <p>通过产品“全部分类”换到“一般向”时，只清空分类关键词，排序与时间保持。底部状态也可检查父组件仍持有筛选条件。</p>
      <div className="fixture-actions">
        <button type="button" onClick={() => reset("controlled")}>重置为父层保留模式</button>
        <button type="button" onClick={() => reset("uncontrolled")}>对照：仅组件本地模式</button>
      </div>
      <pre aria-label="分类返回验收状态">{JSON.stringify({ mode, category, filters, detailId: detail?.id ?? null,
        detailVisits: visits, detailReturns: returns, mockWrites: 0, blockedFetches }, null, 2)}</pre>
    </section>
    {detail ? <main className="fixture-detail" aria-label="普通原创角色详情">
      <button type="button" onClick={closeDetail}>返回分类结果</button>
      <h1>{detail.name}</h1><p>{detail.introduction}</p>
      <p>本地验收只切换页面，不开启对话、不发送生成请求。</p>
    </main> : <CatalogDiscovery key={mode} characters={characters} authors={[]} favorites={favorites} preferences={preferences}
      initialCategory={category} onCategoryChange={setCategory}
      {...(mode === "controlled" ? { filters, onFiltersChange: setFilters } : {})}
      onCharacter={character => { setDetail(character); setVisits(value => value + 1); }}
      onFavorite={id => setFavorites(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])}
      onAuthor={() => { throw new Error("这个隔离场景没有作者页面。"); }} />}
  </>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
