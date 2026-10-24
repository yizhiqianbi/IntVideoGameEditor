/** Browser acceptance fixture. Only the eighteen local static card JSON GETs; all chat data stays in memory. */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import CharacterDetail from "../../../../src/components/dzmm/character-detail";
import CharacterRichText, { hasCharacterMarkup } from "../../../../src/components/dzmm/character-rich-text";
import s from "../../../../src/components/dzmm/tavern.module.css";
import { DZMM_EXPORTED_FULL_CHARACTERS, exportCharacterJson, type Character } from "../../../../src/lib/dzmm-characters";
import { XUMENG_EXPORTED_CARD_RECORDS } from "../../../../src/lib/xumeng-exported-cards";
import { getDzmmConversationOpening } from "../../../../src/lib/dzmm-conversation-opening";
import { captureDzmmConversationOpening, applyDzmmConversationOpening } from "../../../../src/lib/dzmm-conversation-context";
import { prepareDzmmRequest } from "../../../../src/lib/dzmm-context";
import { buildDzmmPromptPlan, validateDzmmChatInput } from "../../../../src/lib/dzmm-chat";
import { DZMM_INITIAL_STATE, hydrateDzmmState, type DzmmSavedConversation } from "../../../../src/lib/dzmm-storage";
import "../../src/page.css";

const expectedHashes: Record<string, string> = {
  peiyu: "7dd714fdd35d4f479b91540700b25628cf518768b50222309e14722b56e2756a",
  shenyan: "43842967b7d93bef5e7e8b18df02370e9327fb7f232297d981c8985438430a7c",
  tangtuantuan: "e4338fd4941f07857447f50b349568d3d001e07e024bde889c29672528d71d34",
  wangushi: "6bf91f72bddd973191b3953560059a89383a823215f4aea8710b3652387cf3a9",
  huoyushen: "872bb81fb07273c7487cd2dd14c5b71d694048a12a676c286ed800bf39ee229b",
  jiwenqing: "6abc3b7a08cf82c9eb5a78b0322f471840dc31932410105de997e1ce8d784ce3",
  naifuer: "20c61ec2cf36462f69cecb002a2fa8b7dab31f6e450103cb2f1b710faac095ee",
  songzhixia: "ee3319fd0387d11cdabd1335f559514572af2c1953a8b748622893fb36ea8571",
  caleb: "cc6a6a66f2fe8e6e396e22eab4b4f9b3bb8b545c0891b9382e32e1f253c55d09",
  edmund-harrower: "70c96d304edde86c27e68b2ccee40be799ae6e1036bae5a70a97c0843130930c",
  frankie-doyle: "0798ae866eed8bd637a3e0e764ef166edb780f21379621f49c90bda0af54e210",
  redline-salvage: "fde4d3d2f68a025cca1c87e5f9961ab178914d61a161f98dac1098714fb06c15",
  rosalind: "f530d2f7d3ad042fab235e78e918c77cbe5c726764bac15a832bec9a96247d86",
  the-lighthouse: "61b9eb8e932f7d61d5e27a727832307136438460ba0e509ee8e0914ec67d6e5c",
  jiangchiye: "37b81f31102af1eeea6a464163d2256019307ab1b05bd83615e9dbb21fea198a",
  sunianzhi: "3f09b432271db35f89d84bdb9388fe8edfe53c1693b21b7fc8e04387a251a52c",
  xuanjing: "65587996b1087bf946f1a3e9874d6d17f820526f9bb667c58528d949dbedf4a2",
  nie-xiaoqian: "5a6a3574edb1cef1099842175571d13a6834f06e1508c03e41eb6fb7aa4701a3",
};
const cards = DZMM_EXPORTED_FULL_CHARACTERS;
const allowedPaths = new Set(XUMENG_EXPORTED_CARD_RECORDS.map(record => record.downloadUrl));
const network = { localOriginalGets: 0, blockedFetches: 0, modelCalls: 0, storageWrites: 0 };
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input), location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  if (url.origin !== location.origin || method !== "GET" || !allowedPaths.has(url.pathname)) {
    network.blockedFetches++;
    return Response.json({ error: "本夹具仅允许公开原始 JSON 的本地只读请求。" }, { status: 501 });
  }
  network.localOriginalGets++;
  return nativeFetch(input, init);
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
async function sha(value: string | ArrayBuffer) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
const fingerprint = (value: unknown) => sha(JSON.stringify(canonical(value)) ?? "undefined");
const fieldPairs = [["name", "name"], ["description", "description"], ["personality", "personality"], ["scenario", "scenario"],
  ["firstMessage", "first_mes"], ["messageExamples", "mes_example"], ["systemPrompt", "system_prompt"],
  ["postHistoryInstructions", "post_history_instructions"], ["creatorNotes", "creator_notes"],
  ["alternateGreetings", "alternate_greetings"], ["tags", "tags"]] as const;
type SourceCard = (typeof XUMENG_EXPORTED_CARD_RECORDS)[number]["card"];
type DownloadCheck = { id: string; name: string; route: string; pass: boolean; bytes?: number; expectedSha256: string;
  actualSha256?: string; originalStructureMatches?: boolean; fieldChecks?: Array<{ field: string; pass: boolean; sourceHash: string; runtimeHash: string }>; error?: string };

async function checkDownloads(): Promise<DownloadCheck[]> {
  return Promise.all(XUMENG_EXPORTED_CARD_RECORDS.map(async record => {
    const card = cards.find(candidate => candidate.id === record.id)!;
    const base = { id: card.id, name: card.name, route: record.downloadUrl, expectedSha256: expectedHashes[record.slug] };
    try {
      const response = await fetch(record.downloadUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`本地原件 HTTP ${response.status}`);
      const bytes = await response.arrayBuffer(), actualSha256 = await sha(bytes);
      const source = JSON.parse(new TextDecoder().decode(bytes)) as SourceCard, data = source.data;
      const comparisons: Array<[string, unknown, unknown]> = fieldPairs.map(([runtime, original]) => [runtime, card[runtime], data[original]]);
      comparisons.push(["author", card.author, data.creator], ["version", record.version, data.character_version],
        ["characterBook.name", card.characterBook?.name, data.character_book.name],
        ["characterBook.entries", card.characterBook?.entries, data.character_book.entries.map(entry => ({
          id: String(entry.id), name: entry.comment, keys: entry.keys, secondaryKeys: entry.secondary_keys,
          content: entry.content, enabled: entry.enabled, constant: entry.constant, selective: entry.selective,
          insertionOrder: entry.insertion_order, position: entry.position,
        }))]);
      const fieldChecks = await Promise.all(comparisons.map(async ([field, runtime, original]) => {
        const [runtimeHash, sourceHash] = await Promise.all([fingerprint(runtime), fingerprint(original)]);
        return { field, pass: runtimeHash === sourceHash, runtimeHash, sourceHash };
      }));
      const originalStructureMatches = await fingerprint(source) === await fingerprint(record.card);
      return { ...base, bytes: bytes.byteLength, actualSha256, originalStructureMatches, fieldChecks,
        pass: actualSha256 === base.expectedSha256 && record.sha256 === base.expectedSha256 && originalStructureMatches && fieldChecks.every(check => check.pass) };
    } catch (error) { return { ...base, pass: false, error: error instanceof Error ? error.message : "本地原件核验失败" }; }
  }));
}

function startSample(card: Character, index: number) {
  try {
    const opening = captureDzmmConversationOpening(card, index);
    const conversation: DzmmSavedConversation = { id: `fixture-${card.id}-${index}`, characterId: card.id, title: "本地原始开场验收", updatedAt: Date.UTC(2026, 9, 16), opening,
      messages: [...opening.messages.map((message, i) => ({ ...message, id: `opening-${i}` })), { id: "original-user", role: "user", content: "我想先看看周围，请按当前场景继续。" }] };
    const request = prepareDzmmRequest(applyDzmmConversationOpening(card, conversation), conversation.messages, "延续当前场景，不替用户决定行动。", "普通成年旅人", "balanced", 1024, { userName: "本地旅人" });
    const plan = buildDzmmPromptPlan(validateDzmmChatInput(request));
    const hydrated = hydrateDzmmState(JSON.stringify({ ...DZMM_INITIAL_STATE, favorites: [card.id], custom: [], conversations: [conversation],
      preferences: { ...DZMM_INITIAL_STATE.preferences, nickname: "本地旅人", preset: "延续当前场景。" } }));
    const restored = hydrated.state.conversations[0];
    const snapshotRestored = JSON.stringify(restored?.opening) === JSON.stringify(opening);
    // Hydration reconstructs { id, role, content }; capture creates { role, content, id }.
    // Compare complete values independently of object-key insertion order.
    const messagesRestored = JSON.stringify(canonical(restored?.messages)) === JSON.stringify(canonical(conversation.messages));
    const requestOpeningExact = JSON.stringify(request.character.openingMessages) === JSON.stringify(opening.messages);
    const segments = plan.diagnostics.segments.filter(segment => segment.source === "opening");
    return { id: card.id, name: card.name, index, opening: index ? "备用开场" : "主开场", pass: snapshotRestored && messagesRestored && requestOpeningExact && segments.length === opening.messages.length && hydrated.warnings.length === 0,
      snapshotRestored, messagesRestored, requestOpeningExact, openingSegments: segments.length, openingChars: opening.messages.reduce((sum, message) => sum + message.content.length, 0),
      activeWorldbookEntries: plan.diagnostics.loreEntries, totalWorldbookEntries: card.characterBook?.entries.length ?? 0,
      exampleMessages: plan.diagnostics.exampleMessages, historyWarnings: hydrated.warnings.length };
  } catch (error) { return { id: card.id, name: card.name, index, opening: index ? "备用开场" : "主开场", pass: false, error: error instanceof Error ? error.message : "请求组装失败" }; }
}
const startupChecks = cards.flatMap(card => [startSample(card, 0), startSample(card, 1)]);
const hostileMarkup = `<div id="unsafe-card-id" class="unsafe-card-class" style="background:red" onclick="window.__exportFixtureExecuted=true">安全正文前
  <details open ontoggle="window.__exportFixtureExecuted=true"><summary style="display:none">安全折叠标题</summary><p data-secret="unsafe">折叠正文保留标记</p></details>
  <script>window.__exportFixtureExecuted=true</script><style>body{display:none}</style>
  <img src="/__export-fixture-resource-must-not-load.png" onerror="window.__exportFixtureExecuted=true"><iframe src="/__export-fixture-frame-must-not-load"></iframe>
  <svg onload="window.__exportFixtureExecuted=true"><text>忽略的矢量内容</text></svg><form action="/__export-fixture-form"><input name="secret"></form>
  <a href="javascript:window.__exportFixtureExecuted=true">链接文字保留标记</a><p>安全正文后</p></div>`;
type SafetyCheck = { pass: boolean; ready: boolean; scriptExecuted: boolean; forbiddenElements: number; forbiddenAttributes: number; resourceRequests: number;
  foldedByDefault: boolean; foldedBodyPreserved: boolean; visibleTextPreserved: boolean };
function inspectSafety(container: HTMLElement): SafetyCheck {
  const rich = container.querySelector("[data-character-markup]"), fold = rich?.querySelector("details");
  const nodes = [...(rich?.querySelectorAll("*") ?? [])];
  const forbiddenElements = rich?.querySelectorAll("script,style,img,iframe,object,embed,svg,math,link,meta,base,a,form,input,button,video,audio,source,template").length ?? 0;
  const forbiddenAttributes = nodes.reduce((sum, node) => sum + node.attributes.length, 0);
  const resourceRequests = performance.getEntriesByType("resource").filter(entry => entry.name.includes("__export-fixture-")).length;
  const scriptExecuted = (window as Window & { __exportFixtureExecuted?: boolean }).__exportFixtureExecuted === true;
  const foldedByDefault = Boolean(fold && !fold.hasAttribute("open"));
  const foldedBodyPreserved = Boolean(fold?.textContent?.includes("折叠正文保留标记"));
  const visibleTextPreserved = Boolean(rich?.textContent?.includes("安全正文前") && rich?.textContent?.includes("安全正文后") && rich?.textContent?.includes("链接文字保留标记"));
  return { ready: Boolean(fold), pass: Boolean(fold) && !scriptExecuted && !forbiddenElements && !forbiddenAttributes && !resourceRequests && foldedByDefault && foldedBodyPreserved && visibleTextPreserved,
    scriptExecuted, forbiddenElements, forbiddenAttributes, resourceRequests, foldedByDefault, foldedBodyPreserved, visibleTextPreserved };
}

function Fixture() {
  const [selected, setSelected] = useState(cards[0].id), [openingIndex, setOpeningIndex] = useState(0), [notice, setNotice] = useState(`尚未启动；${cards.length * 2} 份请求投影已经在内存完成，未发送。 `);
  const [downloads, setDownloads] = useState<DownloadCheck[]>([]), [safety, setSafety] = useState<SafetyCheck | null>(null), [starts, setStarts] = useState(0);
  const safetyRef = useRef<HTMLDivElement>(null), card = cards.find(candidate => candidate.id === selected)!;
  const record = XUMENG_EXPORTED_CARD_RECORDS.find(candidate => candidate.id === selected)!;
  const opening = getDzmmConversationOpening(card, openingIndex), allDownloadsPass = downloads.length === XUMENG_EXPORTED_CARD_RECORDS.length && downloads.every(check => check.pass);
  useEffect(() => { let live = true; void checkDownloads().then(checks => { if (live) setDownloads(checks); }); return () => { live = false; }; }, []);
  useEffect(() => {
    const container = safetyRef.current!;
    const check = () => { const result = inspectSafety(container); if (result.ready) setSafety(result); };
    const observer = new MutationObserver(check); observer.observe(container, { childList: true, subtree: true }); check();
    return () => observer.disconnect();
  }, []);
  const snapshot = { selected, openingIndex, localStarts: starts, downloads, startupChecks, safety, network,
    allPass: allDownloadsPass && startupChecks.length === cards.length * 2 && startupChecks.every(check => check.pass) && safety?.pass === true,
    boundary: "只验证本地原件、组件 DOM 与请求构造/内存恢复；没有生产账户、持久化、外部模型或生产验收。" };
  (window as Window & { exportedCardsFixture?: unknown }).exportedCardsFixture = snapshot;
  function select(id: string) { setSelected(id); setOpeningIndex(0); setNotice("已切换真实目录角色，未保存任何会话。"); }
  function start() { const result = startSample(card, openingIndex); setStarts(value => value + 1); setNotice(`${card.name} · ${openingIndex ? "备用" : "主"}开场：${result.pass ? "请求组装和内存恢复通过" : "检查失败，请查看结果"}；未发送到模型。`); }
  function compatibleExport() {
    const url = URL.createObjectURL(new Blob([exportCharacterJson(card)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${record.slug}-qingyu-compatible.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("已下载晴屿兼容格式；字节一致的作者原件请用上方“下载作者原件”。");
  }
  return <main className={`${s.app} ${s.dark}`} onClickCapture={event => {
    const anchor = (event.target as Element).closest?.("a");
    if (anchor?.href && !anchor.href.startsWith("blob:")) { const url = new URL(anchor.href); if (url.origin !== location.origin) { event.preventDefault(); setNotice("本地夹具不打开外部来源或授权页面；链接保留在真实详情中。"); } }
  }}>
    <section className="fixture-panel"><h1>完整原始角色卡 · 本地隔离验收</h1>
      <p>十八张作者公开、CC BY 4.0 角色卡。使用正式 CharacterDetail、RichText、开场与请求函数。只读十八份本地原件，聊天数据仅在内存，刷新即丢弃。</p>
      <p className="fixture-note">原件路由：/assets/qingyu/exported-cards/ → 仓库 public/dzmm/exported-cards/。卡片自身数值为故事文本，本页不声称具备游戏状态引擎。</p>
      <div className="fixture-actions">{cards.map(item => <button key={item.id} aria-pressed={selected === item.id} onClick={() => select(item.id)}>{item.name}</button>)}</div>
      <div className="fixture-actions"><button aria-pressed={openingIndex === 0} onClick={() => setOpeningIndex(0)}>主开场</button><button aria-pressed={openingIndex === 1} onClick={() => setOpeningIndex(1)}>备用开场</button><button onClick={start}>启动当前开场（仅内存）</button>
        <a className="fixture-download" href={record.downloadUrl} download={`foreverse-${record.slug}.v2.json`}>下载作者原件</a></div>
      <p role="status">{notice}</p>
      <div className="fixture-checks"><article className="fixture-card"><strong className={downloads.length ? allDownloadsPass ? "fixture-ok" : "fixture-bad" : "fixture-wait"}>原件与字段：{downloads.length ? `${downloads.filter(check => check.pass).length} / ${XUMENG_EXPORTED_CARD_RECORDS.length} 通过` : "核验中"}</strong><span>真实静态 GET、固定 SHA-256、原始 JSON 结构与运行字段指纹。</span></article>
        <article className="fixture-card"><strong className={startupChecks.every(check => check.pass) ? "fixture-ok" : "fixture-bad"}>启动投影：{startupChecks.filter(check => check.pass).length} / {cards.length * 2} 通过</strong><span>主备开场进入请求、世界书激活、会话快照与历史恢复。</span></article>
        <article className="fixture-card"><strong className={safety ? safety.pass ? "fixture-ok" : "fixture-bad" : "fixture-wait"}>HTML 安全：{safety ? safety.pass ? "通过" : "失败" : "等待 DOM"}</strong><span>无脚本、资源、属性；折叠默认关闭且正文保留。</span></article></div>
      <details><summary>完整自动检查结果（不输出提示词全文）</summary><pre aria-label="原始卡自动验收结果">{JSON.stringify(snapshot, null, 2)}</pre></details>
    </section>
    <section className="fixture-panel" aria-label="当前开场预览"><h2>{card.name} · {openingIndex ? "备用开场" : "主开场"}</h2><p>原始开场的展示投影；下方详情仍显示该卡原始主开场。所有折叠均可实际展开。</p>
      <div className="fixture-opening">{opening.messages.map((message, index) => hasCharacterMarkup(message.content) ? <CharacterRichText key={`${selected}-${openingIndex}-${index}`} text={message.content} /> : <div className="fixture-text" key={index}>{message.content}</div>)}</div></section>
    <div className="fixture-detail"><CharacterDetail key={card.id} character={card} favorites={false} liked={false} likeCount="0" related={cards.filter(item => item.id !== selected)}
      onBack={() => setNotice("本页是本地夹具，无外部返回动作。")} onStart={start} onFavorite={() => setNotice("收藏仅为夹具按钮，无存储写入。")} onLike={() => setNotice("点赞不属于本轮验收，不发送请求。")}
      onExport={compatibleExport} onEdit={() => setNotice("本轮只读查看卡片，不修改作者原件。")} onSelect={item => select(item.id)} onNotice={setNotice} /></div>
    <section className="fixture-panel" aria-label="恶意 HTML 隔离样本"><h2>HTML 安全与折叠正文样本</h2><p>下方真实 RichText 输入包含脚本、事件、外部资源类标签与源样式。预期仅留下安全文字和默认关闭的折叠；点击折叠可核对正文。</p>
      <div ref={safetyRef}><CharacterRichText text={hostileMarkup} /></div><pre aria-label="恶意 HTML 检查结果">{JSON.stringify(safety, null, 2)}</pre></section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
