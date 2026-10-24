/** Real ForumView. Every application fetch is answered or rejected inside this tab. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ForumView from "../../../../src/components/dzmm/forum-view";
import type { DzmmForumPost, DzmmForumReply, DzmmForumReport } from "../../../../src/lib/dzmm-forum-types";
import "../../src/page.css";

const ACCOUNT = "55555555-5555-4555-8555-555555555555";
const ACCOUNT_B = "66666666-6666-4666-8666-666666666666";
const POST_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POST_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MISSING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const author = { id: ACCOUNT, nickname: "本地论坛体验者" };
const now = Date.now();
const posts = new Map<string, DzmmForumPost>([
  [POST_A, { id: POST_A, title: "A帖·雨巷书店的地图整理", body: "原创讨论：怎样把纸质地图的索引整理得更方便？欢迎交流。", category: "characters", tags: ["地图", "原创"], author,
    createdAt: now, updatedAt: now, upvotes: 0, downvotes: 0, myVote: 0, replyCount: 0 }],
  [POST_B, { id: POST_B, title: "B帖·海港图书馆的借阅计划", body: "原创讨论：海港图书馆准备周末开放，有哪些普通阅读活动可以安排？", category: "life", tags: ["阅读", "原创"], author,
    createdAt: now - 60_000, updatedAt: now - 60_000, upvotes: 0, downvotes: 0, myVote: 0, replyCount: 0 }],
]);
const replies = new Map<string, DzmmForumReply[]>();
const votes = new Map<string, -1 | 1>();
const reports = new Map<string, DzmmForumReport>();
const state = {
  accountId: ACCOUNT, isGuest: false, holdNextReply: false, failNextReply: false,
  pending: null as null | { postId: string; body: string; accountId: string; release: (success: boolean) => void },
  counts: {} as Record<string, number>, blockedRequests: 0, acceptedReplies: 0,
  note: "输入 A 帖草稿→查看 B 帖→返回 A 帖，检查正文是否串帖或丢失。",
  lastReply: null as null | { postId: string; body: string; accountId: string; status: number },
};
const controls = createRoot(document.getElementById("fixture-controls")!);
function route(postId: string | null) { location.hash = postId ? `forum/post/${postId}` : "forum"; }
function renderControls() {
  controls.render(<section className="fixture-panel" aria-label="论坛流程本地隔离控制台">
    <h1>论坛草稿与错误恢复 · 真实组件隔离验收</h1>
    <p>下方直接挂载真实 ForumView 和真实客户端请求函数。仅有两个普通原创帖子；所有应用请求在本标签页模拟，未连接生产、模型、订单或公开论坛。</p>
    <p>同帖验收：挂起下一次回复→填写并提交“已提交A”→等待时改为“新草稿B”→释放成功。跨帖验收：A 提交挂起→查看 B 并输入 B 草稿→释放 A→检查 B 草稿，再返回 A。失败验收：释放失败后正文仍在，下一次手动提交才能发布。</p>
    <div className="fixture-actions">
      <button type="button" onClick={() => route(POST_A)}>查看A帖</button>
      <button type="button" onClick={() => route(POST_B)}>查看B帖</button>
      <button type="button" onClick={() => route(null)}>查看广场</button>
      <button type="button" onClick={() => route(MISSING)}>打开404详情</button>
      <button type="button" disabled={Boolean(state.pending)} onClick={() => { state.holdNextReply = true; state.failNextReply = false; state.note = "下一次模拟回复 POST 等待手动释放；可继续使用真实正文输入或切帖。"; renderControls(); }}>挂起下一次回复</button>
      <button type="button" disabled={!state.pending} onClick={() => state.pending?.release(true)}>释放回复为成功</button>
      <button type="button" disabled={!state.pending} onClick={() => state.pending?.release(false)}>释放回复为失败</button>
      <button type="button" disabled={Boolean(state.pending)} onClick={() => { state.failNextReply = true; state.holdNextReply = false; state.note = "下一次回复立即返回本地503，模拟服务不写入。"; renderControls(); }}>下一次回复失败</button>
      <button type="button" onClick={() => { state.accountId = state.accountId === ACCOUNT ? ACCOUNT_B : ACCOUNT; state.note = "仅切换本地模拟账号，真实页面会按账号重新挂载。"; renderControls(); window.dispatchEvent(new Event("forum-fixture-account")); }}>切换模拟账号</button>
      <button type="button" onClick={() => { state.isGuest = !state.isGuest; state.note = "切换本地游客状态，不执行真实登录。"; renderControls(); window.dispatchEvent(new Event("forum-fixture-account")); }}>切换模拟游客</button>
      <button type="button" onClick={() => { location.hash = "forum"; location.reload(); }}>重置整个验收场景</button>
    </div>
    <p className="fixture-note" role="status" aria-label="验收动作说明">{state.note}</p>
    <pre aria-label="论坛模拟状态">{JSON.stringify({ accountId: state.accountId, isGuest: state.isGuest,
      holdNextReply: state.holdNextReply, pending: state.pending ? { postId: state.pending.postId, body: state.pending.body, accountId: state.pending.accountId } : null,
      pendingReplies: state.pending ? 1 : 0, acceptedReplies: state.acceptedReplies, lastReply: state.lastReply,
      replyCounts: [...posts.values()].map(post => ({ postId: post.id, count: (replies.get(post.id) ?? []).length })),
      blockedRequests: state.blockedRequests, requests: state.counts }, null, 2)}</pre>
  </section>);
}
function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function currentPost(post: DzmmForumPost) {
  let upvotes = 0, downvotes = 0;
  for (const [key, value] of votes) if (key.endsWith(`:${post.id}`)) { if (value === 1) upvotes++; else downvotes++; }
  return { ...post, replyCount: (replies.get(post.id) ?? []).length, upvotes, downvotes, myVote: votes.get(`${state.accountId}:${post.id}`) ?? 0 };
}
async function bodyOf(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown>> {
  try { return JSON.parse(typeof init?.body === "string" ? init.body : input instanceof Request ? await input.text() : "{}"); }
  catch { return {}; }
}
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url ?? String(input), location.origin);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const signal = init?.signal ?? request?.signal;
  signal?.throwIfAborted();
  const key = `${method} ${url.pathname}`;
  state.counts[key] = (state.counts[key] ?? 0) + 1;
  const finish = (value: unknown, status = 200) => { renderControls(); return response(value, status); };
  const fail = (status: number, error: string) => finish({ error }, status);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/backend/v1/forum/")) {
    state.blockedRequests++; return fail(501, "论坛隔离场景拒绝其他应用或外部请求。");
  }
  const path = url.pathname.slice("/api/backend/v1/forum".length);
  const body = method === "GET" ? {} : await bodyOf(input, init);
  const limit = Number(url.searchParams.get("limit") ?? 20), offset = Number(url.searchParams.get("offset") ?? 0);
  if (method !== "GET" && state.isGuest) return fail(403, "请先注册或登录，再参与广场讨论。");
  if (path === "/posts" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase(), category = url.searchParams.get("category"), tag = url.searchParams.get("tag");
    const listing = [...posts.values()].filter(post => (!q || `${post.title} ${post.body}`.toLowerCase().includes(q)) && (!category || post.category === category) && (!tag || post.tags.includes(tag)))
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    const popular = new Map<string, number>();
    for (const post of posts.values()) for (const item of post.tags) popular.set(item, (popular.get(item) ?? 0) + 1);
    return finish({ posts: listing.slice(offset, offset + limit).map(currentPost), total: listing.length, offset, limit, hasMore: offset + limit < listing.length,
      popularTags: [...popular].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)) });
  }
  if (path === "/posts" && method === "POST") {
    if (typeof body.title !== "string" || typeof body.body !== "string" || !body.title.trim() || !body.body.trim()) return fail(400, "标题和正文不能为空。");
    const post: DzmmForumPost = { id: crypto.randomUUID(), title: body.title.trim(), body: body.body.trim(), category: body.category as DzmmForumPost["category"], tags: body.tags as string[],
      author: { id: state.accountId, nickname: state.accountId === ACCOUNT ? author.nickname : "本地另一账号" }, createdAt: Date.now(), updatedAt: Date.now(), upvotes: 0, downvotes: 0, myVote: 0, replyCount: 0 };
    posts.set(post.id, post); return finish({ post }, 201);
  }
  const postMatch = /^\/posts\/([^/]+)$/.exec(path);
  if (postMatch) {
    const post = posts.get(postMatch[1]);
    if (!post) return fail(404, "主题不存在或已删除。");
    if (method === "GET") { const items = replies.get(post.id) ?? []; return finish({ post: currentPost(post), replies: items.slice(offset, offset + limit), total: items.length, offset, limit, hasMore: offset + limit < items.length }); }
    if (post.author.id !== state.accountId) return fail(404, "主题不存在或无法修改。");
    if (method === "PATCH") {
      const updated = { ...post, title: String(body.title ?? "").trim(), body: String(body.body ?? "").trim(), category: body.category as DzmmForumPost["category"], tags: body.tags as string[], updatedAt: Date.now() };
      posts.set(post.id, updated); return finish({ post: currentPost(updated) });
    }
    if (method === "DELETE") { posts.delete(post.id); replies.delete(post.id); return finish({ deleted: true }); }
  }
  const replyMatch = /^\/posts\/([^/]+)\/replies$/.exec(path);
  if (replyMatch && method === "POST") {
    const postId = replyMatch[1], accountId = state.accountId;
    if (!posts.has(postId)) return fail(404, "主题不存在或已删除。");
    if (typeof body.body !== "string" || !body.body.trim() || body.body.length > 4000) return fail(400, "回复需要1至4000个字符。");
    const text = body.body.trim();
    let success = !state.failNextReply;
    state.failNextReply = false;
    if (state.holdNextReply) {
      state.holdNextReply = false;
      success = await new Promise<boolean>(release => {
        state.pending = { postId, body: text, accountId, release };
        state.note = "模拟回复正在等待；正文、切帖和浏览器返回均使用真实组件。"; renderControls();
      });
      state.pending = null;
    }
    if (!success) { state.lastReply = { postId, body: text, accountId, status: 503 }; state.note = "模拟回复失败，服务没有写入。"; return fail(503, "本地模拟回复失败，正文应保留，请手动重试。"); }
    const reply: DzmmForumReply = { id: crypto.randomUUID(), postId, body: text, author: { id: accountId, nickname: accountId === ACCOUNT ? author.nickname : "本地另一账号" }, createdAt: Date.now() };
    replies.set(postId, [...(replies.get(postId) ?? []), reply]); state.acceptedReplies++;
    state.lastReply = { postId, body: text, accountId, status: 201 }; state.note = "模拟回复成功，只应清理原提交版本，其他草稿不应丢失。";
    return finish({ reply }, 201);
  }
  const deleteReply = /^\/replies\/([^/]+)$/.exec(path);
  if (deleteReply && method === "DELETE") {
    for (const [postId, items] of replies) { const item = items.find(reply => reply.id === deleteReply[1] && reply.author.id === state.accountId); if (item) { replies.set(postId, items.filter(reply => reply.id !== item.id)); return finish({ deleted: true }); } }
    return fail(404, "回复不存在或无法删除。");
  }
  const voteMatch = /^\/posts\/([^/]+)\/vote$/.exec(path);
  if (voteMatch && method === "PUT") {
    const post = posts.get(voteMatch[1]); if (!post) return fail(404, "主题不存在或已删除。");
    if (body.value !== -1 && body.value !== 0 && body.value !== 1) return fail(400, "投票值无效。");
    const voteKey = `${state.accountId}:${post.id}`; if (body.value === 0) votes.delete(voteKey); else votes.set(voteKey, body.value);
    return finish({ post: currentPost(post) });
  }
  const reportMatch = /^\/posts\/([^/]+)\/report$/.exec(path);
  if (reportMatch && method === "POST") {
    const post = posts.get(reportMatch[1]); if (!post) return fail(404, "主题不存在或已删除。");
    const existing = [...reports.values()].find(report => report.postId === post.id && report.reporter.id === state.accountId);
    if (existing) return finish({ reported: true });
    const id = crypto.randomUUID(); reports.set(id, { id, postId: post.id, title: post.title, reporter: { id: state.accountId, nickname: author.nickname }, reason: String(body.reason ?? ""), status: "pending", createdAt: Date.now(), updatedAt: Date.now() });
    return finish({ reported: true }, 201);
  }
  if (path === "/reports" && method === "GET") return fail(403, "本地普通账号不允许查看举报。");
  state.blockedRequests++; return fail(501, "论坛隔离场景没有此接口，未连接生产服务。");
};

function currentRoute() { const match = /^#forum\/post\/(.+)$/.exec(location.hash); return match?.[1]; }
function Fixture() {
  const [postId, setPostId] = useState(currentRoute);
  const [account, setAccount] = useState({ id: state.accountId, isGuest: state.isGuest });
  useEffect(() => {
    const changed = () => setPostId(currentRoute());
    const accountChanged = () => setAccount({ id: state.accountId, isGuest: state.isGuest });
    window.addEventListener("hashchange", changed); window.addEventListener("forum-fixture-account", accountChanged);
    return () => { window.removeEventListener("hashchange", changed); window.removeEventListener("forum-fixture-account", accountChanged); };
  }, []);
  return <ForumView key={account.id} userId={account.id} isGuest={account.isGuest} nickname={account.id === ACCOUNT ? author.nickname : "本地另一账号"}
    postId={postId} onPostChange={route} characters={[]} onCharacter={() => { state.note = "此场景不打开角色或模型。"; renderControls(); }}
    onRequireAccount={() => { state.note = "本地隔离场景不执行真实注册登录；可用控制台切换模拟游客。"; renderControls(); }} />;
}
renderControls();
createRoot(document.getElementById("root")!).render(<Fixture />);
