import { useState } from "react";
import { createRoot } from "react-dom/client";
import GenerationHistory from "../../../../src/components/dzmm/generation-history";
import type { GenerationJob } from "../../../../src/lib/xumeng-generation";
import "../../src/page.css";

const accounts = ["original-history-a", "original-history-b"] as const;
const requestId = "76767676-7676-4676-8676-767676767676";
const API = "/api/backend/v1/generation";
let activeAccount: string = accounts[0], unavailable = false, slowNext = false, videoReady = false;
const requests: { method: string; path: string; account: string }[] = [];
let blocked = 0, lateResponses = 0;
const timestamp = Date.UTC(2026, 9, 15, 9);
const job = (id: string, prompt: string, kind: "image" | "video", ready: boolean): GenerationJob => ({ id, prompt, kind, modelId: "original-isolated-model", aspectRatio: "16:9",
  ...(kind === "video" ? { duration: 5 } : {}), status: ready ? "ready" : "processing", createdAt: timestamp, updatedAt: timestamp,
  reservedCredits: 12, chargedCredits: ready ? 8 : 0, expiresAt: timestamp + 86400_000, finalizedAt: ready ? timestamp : null,
  costBasis: ready ? "provider_usage" : null, exceedsReservation: false, ...(ready ? { assetUrl: `${API}/assets/${id}`, mimeType: kind === "image" ? "image/png" : "video/mp4" } : {}) });
const originals = {
  [accounts[0]]: { image: job("original-map-image", "甲账号原创地图室图片", "image", true), video: () => job("original-map-video", "甲账号原创地图翻页视频", "video", videoReady) },
  [accounts[1]]: { image: job("original-lantern-image", "乙账号原创灯塔图片", "image", true), video: () => job("original-lantern-video", "乙账号原创灯塔视频", "video", false) },
};
const savedDraft = JSON.stringify({ prompt: "原创地图室未提交草稿，请勿清除", unrelated: "preserve" });
const savedRequest = JSON.stringify({ fingerprint: JSON.stringify({ accountId: accounts[0], kind: "image", prompt: "原创远航地图" }), requestId, status: "submitted", expectedMaxCredits: 12 });
sessionStorage.setItem(`qingyu-generation-draft:${accounts[0]}`, savedDraft);
sessionStorage.setItem(`qingyu-generation-request:${accounts[0]}`, savedRequest);
let refreshCounters = () => {};
window.fetch = async (input, init) => {
  const req = input instanceof Request ? input : null, url = new URL(req?.url ?? String(input), location.origin);
  const method = init?.method ?? req?.method ?? "GET", account = activeAccount;
  requests.push({ method, path: url.pathname, account }); refreshCounters();
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  if (url.origin !== location.origin || method !== "GET" || !url.pathname.startsWith(API + "/")) { blocked++; refreshCounters(); return json({ error: "仅允许本地历史 GET；模型、支付和生成全部拒绝。" }, 501); }
  // Deliberately ignore AbortSignal for this delayed response: the component must
  // still reject a late response after an account switch/unmount.
  if (slowNext) { slowNext = false; await new Promise(resolve => setTimeout(resolve, 1600)); lateResponses++; refreshCounters(); }
  if (unavailable) return json({ error: "隔离服务暂不可用（503）" }, 503);
  const record = originals[account as keyof typeof originals];
  if (!record) return json({ error: "本地账号不存在" }, 401);
  if (url.pathname === API + "/jobs") return json({ accountId: account, jobs: [record.image, record.video()] });
  if (url.pathname === `${API}/jobs/original-map-video` && account === accounts[0]) { videoReady = true; return json({ accountId: account, job: record.video() }); }
  if (url.pathname === `${API}/jobs/original-lantern-video` && account === accounts[1]) return json({ accountId: account, job: record.video() });
  if (url.pathname === `${API}/requests/${requestId}` && account === accounts[0]) return json({ accountId: account, job: job("original-recovered-image", "原请求恢复的原创远航地图", "image", true) });
  blocked++; refreshCounters(); return json({ error: "隔离接口未定义" }, 501);
};
function Fixture() {
  const [account, setAccount] = useState<string>(accounts[0]), [guest, setGuest] = useState(false), [visible, setVisible] = useState(true);
  const [, setTick] = useState(0); refreshCounters = () => queueMicrotask(() => setTick(tick => tick + 1));
  function switchAccount(value: string, nextGuest = false) { activeAccount = value; setAccount(value); setGuest(nextGuest); }
  const snapshot = { account, guest, visible, unavailable, slowNext, videoReady, blocked, lateResponses, requests,
    originalDraftUnchanged: sessionStorage.getItem(`qingyu-generation-draft:${accounts[0]}`) === savedDraft,
    originalRequestUnchanged: sessionStorage.getItem(`qingyu-generation-request:${accounts[0]}`) === savedRequest };
  return <><section className="fixture"><h1>生成历史 · 真实组件隔离验收</h1><p>只有普通原创测试数据，所有 fetch 由本地替身接管；图片为本地固定 PNG，视频仅为空播放器夹具，不声称真实视频可播放。</p>
    <div className="fixture-actions"><button onClick={() => switchAccount(accounts[0])}>切到甲账号</button><button onClick={() => switchAccount(accounts[1])}>切到乙账号</button><button onClick={() => switchAccount("guest", true)}>切到访客</button>
      <button onClick={() => { unavailable = !unavailable; refreshCounters(); }}>{unavailable ? "恢复本地服务" : "模拟服务 503"}</button>
      <button onClick={() => { slowNext = true; refreshCounters(); }}>下次响应延迟 1.6 秒</button><button onClick={() => setVisible(value => !value)}>{visible ? "卸载历史组件" : "重新挂载历史组件"}</button>
      <button onClick={refreshCounters}>刷新计数</button></div><details open><summary>请求与原稿校验</summary><pre aria-label="生成历史验收状态">{JSON.stringify(snapshot, null, 2)}</pre></details></section>
    {visible && <GenerationHistory userId={account} isGuest={guest} onRequireAccount={() => switchAccount(accounts[0])} />}</>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
