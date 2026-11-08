import assert from "node:assert/strict";
import test from "node:test";
import feedbackModule from "./xumeng-feedback-client";
const { FeedbackError, fetchFeedback, fetchFeedbackHandoff, updateFeedback, parseFeedbackItem, feedbackDraftKey, serializeFeedbackDrafts, parseFeedbackDrafts } = feedbackModule as typeof import("./xumeng-feedback-client");
const accountId = "10000000-0000-4000-8000-000000000001";
const otherAccount = "10000000-0000-4000-8000-000000000002";
const id = "10000000-0000-4000-8000-000000000003";
const item = { id, revision: 1, status: "pending", note: "", text: "@original_fixture_bot 手机提交按钮被遮挡。", chatId: "-1001234567890", chatTitle: "原创反馈测试群", chatUsername: null,
  senderId: "101", senderName: "原创测试成员", senderUsername: "fixture_user", messageId: 42, threadId: null, messageUrl: "https://t.me/c/1234567890/42", messageAt: 1000,
  editedAt: null, createdAt: 1000, updatedAt: 1000, replyText: "原创引用文本", replySenderName: "测试引用成员", media: null, decidedBy: null, decidedAt: null };
const counts = { pending: 1, fix: 0, improve: 0, later: 0, done: 0 };
const page = { accountId, items: [item], limit: 20, offset: 0, total: 1, hasMore: false, counts, integrationConfigured: false };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
async function withFetch<T>(fetcher: typeof fetch, operation: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch; globalThis.fetch = fetcher;
  try { return await operation(); } finally { globalThis.fetch = previous; }
}

test("群反馈严格剔除raw update和配置值，原文按文字保留", () => {
  assert.deepEqual(parseFeedbackItem({ ...item, rawPayload: { secret: "discard" }, botToken: "never-retain", text: "<script>alert('text only')</script>" }), { ...item, text: "<script>alert('text only')</script>" });
  const media = { kind: "video", fileId: "fixture-file", fileUniqueId: "unique", mimeType: "video/mp4", fileName: "原创视频.mp4", size: 1024, width: 320, height: 240, duration: 5.25 };
  assert.deepEqual(parseFeedbackItem({ ...item, media }).media, media);
  assert.throws(() => parseFeedbackItem({ ...item, note: "过长".repeat(1001) }), FeedbackError);
  assert.throws(() => parseFeedbackItem({ ...item, replyText: "引用".repeat(1001) }), FeedbackError);
  assert.throws(() => parseFeedbackItem({ ...item, revision: 0 }), FeedbackError);
});

test("原消息链接仅允许安全的Telegram消息地址", () => {
  for (const messageUrl of ["javascript:alert(1)", "https://t.me.evil.example/c/123/42", "https://user:secret@t.me/c/123/42", "https://t.me/c/123/42?redirect=https://evil.example", "https://t.me/c/123/42#fragment"]) {
    assert.throws(() => parseFeedbackItem({ ...item, messageUrl }), FeedbackError);
  }
  assert.equal(parseFeedbackItem({ ...item, messageUrl: "https://t.me/original_group/42?thread=7" }).messageUrl, "https://t.me/original_group/42?thread=7");
});

test("搜索和分页保留结构，不会把搜索词当成其他参数", async () => {
  await withFetch(async (input, init) => {
    const url = new URL(String(input), "https://xumengchat.top");
    assert.equal(url.pathname, "/api/backend/v1/admin/feedback");
    assert.equal(url.searchParams.get("q"), "原创 &status=done");
    assert.equal(url.searchParams.get("status"), "pending");
    assert.equal(url.searchParams.getAll("status").length, 1);
    assert.equal(init?.method, "GET"); assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    return response(page);
  }, async () => {
    const result = await fetchFeedback(accountId, { q: "  原创 &status=done  ", status: "pending" });
    assert.equal(result.items[0].text, item.text); assert.equal(result.integrationConfigured, false); assert.deepEqual(result.counts, counts);
  });
});

test("无效查询不请求网络，错误账号回包不能进入当前收件箱", async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return response({ ...page, accountId: otherAccount }); }, async () => {
    await assert.rejects(fetchFeedback(accountId, { limit: 51 }), (e: unknown) => e instanceof FeedbackError && e.status === 400);
    await assert.rejects(fetchFeedback(accountId, { offset: -1 }), (e: unknown) => e instanceof FeedbackError && e.status === 400);
    await assert.rejects(fetchFeedback("invalid-account"), (e: unknown) => e instanceof FeedbackError && e.status === 401);
    assert.equal(calls, 0);
    await assert.rejects(fetchFeedback(accountId), (e: unknown) => e instanceof FeedbackError && e.status === 409);
    assert.equal(calls, 1);
  });
});

test("权限失败和畸形列表不伪装为空反馈", async () => {
  await withFetch(async () => response({ error: "需要 Super 账户。" }, 403), async () => {
    await assert.rejects(fetchFeedback(accountId), (e: unknown) => e instanceof FeedbackError && e.status === 403 && e.message === "需要 Super 账户。");
  });
  for (const broken of [{ ...page, counts: { ...counts, pending: -1 } }, { ...page, integrationConfigured: "false" }, { ...page, items: [], hasMore: true }, { ...page, offset: 20 }]) {
    await withFetch(async () => response(broken), async () => { await assert.rejects(fetchFeedback(accountId), (e: unknown) => e instanceof FeedbackError && e.status === 502); });
  }
});

test("人工判断使用PATCH及原revision，校验实际回执而不乐观宣称已保存", async () => {
  const updated = { ...item, revision: 2, status: "fix", note: "保持按钮可见", decidedBy: accountId, decidedAt: 2000, updatedAt: 2000 };
  await withFetch(async (input, init) => {
    assert.equal(String(input), `/api/backend/v1/admin/feedback/${id}`); assert.equal(init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(init?.body)), { accountId, revision: 1, status: "fix", note: "保持按钮可见" });
    return response({ accountId, item: updated });
  }, async () => { assert.deepEqual(await updateFeedback(id, { accountId, revision: 1, status: "fix", note: "  保持按钮可见  " }), updated); });
  for (const broken of [{ ...updated, revision: 1 }, { ...updated, status: "done" }, { ...updated, id: otherAccount }]) {
    await withFetch(async () => response({ accountId, item: broken }), async () => {
      await assert.rejects(updateFeedback(id, { accountId, revision: 1, status: "fix", note: "保持按钮可见" }), (e: unknown) => e instanceof FeedbackError && e.status === 502);
    });
  }
});

test("revision冲突返回最新内容，失败和重试仍携原判断稿", async () => {
  const latest = { ...item, revision: 3, status: "improve", note: "已有另一条判断", updatedAt: 3000 };
  const sent: string[] = [];
  await withFetch(async (_, init) => {
    sent.push(String(init?.body));
    if (sent.length === 1) throw new TypeError("isolated response loss");
    return response({ error: "反馈已更新", item: { ...latest, rawPayload: "discard" } }, 409);
  }, async () => {
    const action = { accountId, revision: 1, status: "fix" as const, note: "我的原决策稿" };
    await assert.rejects(updateFeedback(id, action), (e: unknown) => e instanceof FeedbackError && e.status === 503);
    await assert.rejects(updateFeedback(id, action), (e: unknown) => e instanceof FeedbackError && e.status === 409 && e.latest?.revision === 3 && e.latest.note === "已有另一条判断");
    assert.equal(sent[0], sent[1]); assert.equal(action.note, "我的原决策稿"); assert.equal(action.revision, 1);
  });
});

test("调用方取消后迟到回包不产生可用结果", async () => {
  const controller = new AbortController();
  await withFetch(async () => { controller.abort(); return response(page); }, async () => {
    await assert.rejects(fetchFeedback(accountId, {}, controller.signal), (e: unknown) => e instanceof DOMException && e.name === "AbortError");
  });
});

test("真实顶层409回执拒绝畸形或其他反馈的latest，保留提交稿", async () => {
  const action = { accountId, revision: 1, status: "fix" as const, note: "我的判断仍保留" };
  for (const latest of [{ ...item, id: otherAccount }, { ...item, status: "unknown" }, { ...item, note: "超".repeat(2001) }]) {
    await withFetch(async () => response({ error: "反馈已更新", item: latest }, 409), async () => {
      await assert.rejects(updateFeedback(id, action), (e: unknown) => e instanceof FeedbackError && e.status === 502 && e.latest === null);
      assert.deepEqual(action, { accountId, revision: 1, status: "fix", note: "我的判断仍保留" });
    });
  }
});

test("决策草稿按账号隔离，畸形或错账号缓存不能覆盖当前判断", () => {
  const drafts = { [id]: { revision: 1, status: "fix" as const, note: "原创本机决策草稿" } };
  const raw = serializeFeedbackDrafts(accountId, drafts);
  assert.deepEqual(parseFeedbackDrafts(raw, accountId), drafts);
  assert.deepEqual(parseFeedbackDrafts(null, accountId), {});
  assert.notEqual(feedbackDraftKey(accountId), feedbackDraftKey(otherAccount));
  assert.throws(() => parseFeedbackDrafts(raw, otherAccount));
  assert.throws(() => parseFeedbackDrafts("{broken", accountId));
  assert.throws(() => serializeFeedbackDrafts(accountId, { [id]: { ...drafts[id], note: "超".repeat(2001) } }));
  assert.throws(() => parseFeedbackDrafts(JSON.stringify({ schemaVersion: 1, accountId, drafts: { [id]: { revision: 1, status: "auto-fix", note: "" } } }), accountId));
});

test("Codex交接只读获取已保存revision，保留Markdown原文供人工复制", async () => {
  const task = { accountId, feedbackId: id, revision: 2, status: "fix", note: "原创已保存判断", markdown: "# 原创反馈修复\n\n反馈原文：<script>仅为文字</script>\n", fileName: `xumeng-feedback-${id}-r2.md` };
  await withFetch(async (input, init) => {
    assert.equal(String(input), `/api/backend/v1/admin/feedback/${id}/handoff?revision=2`);
    assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store");
    return response({ ...task, dispatchToken: "discard", sent: true });
  }, async () => { assert.deepEqual(await fetchFeedbackHandoff(accountId, id, 2), task); });
});

test("Codex交接拒绝错误身份、版本、判断和下载文件路径，不声明已派发", async () => {
  const task = { accountId, feedbackId: id, revision: 2, status: "improve", note: "原创改进判断", markdown: "# 原创改进任务\n", fileName: `xumeng-feedback-${id}-r2.md` };
  for (const broken of [{ ...task, accountId: otherAccount }, { ...task, feedbackId: otherAccount }, { ...task, revision: 3 }, { ...task, status: "pending" }, { ...task, markdown: "" }, { ...task, fileName: "../../unexpected.md" }]) {
    await withFetch(async () => response(broken), async () => {
      await assert.rejects(fetchFeedbackHandoff(accountId, id, 2), (e: unknown) => e instanceof FeedbackError && (e.status === 502 || e.status === 409));
    });
  }
  let calls = 0;
  await withFetch(async () => { calls++; return response(task); }, async () => {
    await assert.rejects(fetchFeedbackHandoff(accountId, "bad-id", 2), FeedbackError);
    await assert.rejects(fetchFeedbackHandoff(accountId, id, 0), FeedbackError);
    assert.equal(calls, 0);
  });
});

test("Codex交接遇源编辑使用真实409latest重新核对，且拒绝串反馈", async () => {
  const latest = { ...item, revision: 3, status: "fix", note: "原判断", editedAt: 3000, updatedAt: 3000 };
  await withFetch(async () => response({ error: "需要重新保存判断", code: "review_required", item: latest }, 409), async () => {
    await assert.rejects(fetchFeedbackHandoff(accountId, id, 2), (e: unknown) => e instanceof FeedbackError && e.status === 409 && e.latest?.id === id && e.latest.revision === 3);
  });
  await withFetch(async () => response({ error: "需要重新保存判断", item: { ...latest, id: otherAccount } }, 409), async () => {
    await assert.rejects(fetchFeedbackHandoff(accountId, id, 2), (e: unknown) => e instanceof FeedbackError && e.status === 502 && e.latest === null);
  });
  const controller = new AbortController();
  await withFetch(async () => { controller.abort(); return response({ accountId, feedbackId: id, revision: 2, status: "fix", note: "", markdown: "# task", fileName: `xumeng-feedback-${id}-r2.md` }); }, async () => {
    await assert.rejects(fetchFeedbackHandoff(accountId, id, 2, controller.signal), (e: unknown) => e instanceof DOMException && e.name === "AbortError");
  });
});
