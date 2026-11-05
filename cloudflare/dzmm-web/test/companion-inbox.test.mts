import test from "node:test";
import assert from "node:assert/strict";
import inboxModule from "../../../src/app/xumeng/girlfriend/companion-inbox.ts";

const { clearPersonTranscript, clipCompanionTranscript, inboxEntries, inboxView, publishCompanionTranscript, readPersonTranscript } = inboxModule as typeof import("../../../src/app/xumeng/girlfriend/companion-inbox.ts");

class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length() { return this.map.size; }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

test("chat inbox keeps send order, hides sales cues, and counts unread after the seen line", () => {
  const entries = inboxEntries([
    { id: "1", role: "assistant", text: "在吗", createdAt: "2026-10-29T02:34:00.000Z" },
    { id: "2", role: "user", text: "对方刚打开聊天。先发第一条。", createdAt: "2026-10-29T02:35:00.000Z" },
    { id: "3", role: "user", text: "干啥呢发这么性感照片", createdAt: "2026-10-29T02:36:00.000Z" },
    { id: "4", role: "assistant", text: "[XUMENG_PRIVATE_STYLE v1]\nsecret\n[/XUMENG_PRIVATE_STYLE]\n嘴这么甜", createdAt: "2026-10-29T02:36:30.000Z" },
  ], [
    { id: "p", createdAt: "2026-10-29T02:34:10.000Z" },
  ]);
  assert.deepEqual(entries.map(entry => entry.id), ["1", "p", "3", "4"]);
  assert.equal(entries[1]?.text, "[图片]");
  const readThroughPhoto = inboxView(entries, "p");
  assert.equal(readThroughPhoto.preview, "嘴这么甜");
  assert.equal(readThroughPhoto.unread, 1);
  assert.equal(inboxView(entries, null).unread, 0);
  assert.equal(inboxView(entries, "4").unread, 0);
  assert.equal(inboxView(entries.slice(0, 2), "1").preview, "[图片]");
});

test("voice and pictures stay on this device, and a reopened copy does not double the line", () => {
  const store = new MemoryStorage();
  const account = "9e378544-4c8b-4036-a7a4-63703b50edf2";
  const at = "2026-11-05T04:07:00.000Z";
  const voice = "data:audio/wav;base64,UklGRg==";
  publishCompanionTranscript(account, "cast-ningning", "s1", [
    { id: "a", role: "assistant", text: "坏老公，人家哪有没理你呀", createdAt: at },
    {
      id: "b", role: "assistant", text: "[表情]", createdAt: "2026-11-05T04:07:08.000Z",
      media: [
        { kind: "voice", url: voice, mimeType: "audio/wav", durationMs: 640 },
        { kind: "image", url: "https://cdn.example.test/yume.png", mimeType: "image/png", alt: "照片" },
        { kind: "emoji", text: "🥺" },
        { kind: "image", url: "blob:http://localhost/secret" },
        { kind: "image", url: "javascript:alert(1)" },
      ],
    },
  ], store);
  store.setItem(`xumeng-companion-transcript:${account}:cast-ningning:old`, JSON.stringify({
    sessionId: "old",
    messages: [{ id: "a2", role: "assistant", text: "坏老公，人家哪有没理你呀", createdAt: at }],
  }));
  const saved = readPersonTranscript(account, "cast-ningning", store);
  assert.deepEqual(saved.messages.map(message => message.text), ["坏老公，人家哪有没理你呀", ""]);
  const media = saved.messages[1]?.media ?? [];
  assert.deepEqual(media.map(item => item.kind), ["audio", "image", "emoji"]);
  assert.equal(media[0]?.url, voice);
  assert.equal(media[0]?.durationMs, 640);
  assert.equal(media[1]?.url, "https://cdn.example.test/yume.png");
  assert.equal(media[2]?.text, "🥺");
  const entries = inboxEntries(saved.messages);
  assert.equal(entries.at(-1)?.text, "[语音]");
  const huge = "data:audio/wav;base64," + "A".repeat(1_500_000);
  publishCompanionTranscript(account, "cast-ningning", "s1", [
    { id: "a", role: "assistant", text: "坏老公，人家哪有没理你呀", createdAt: at },
    { id: "big", role: "assistant", text: "", createdAt: "2026-11-05T04:07:20.000Z", media: [{ kind: "voice", url: huge, mimeType: "audio/wav" }] },
  ], store);
  const trimmed = readPersonTranscript(account, "cast-ningning", store);
  assert.deepEqual(trimmed.messages.map(message => message.text), ["坏老公，人家哪有没理你呀"]);
});

test("each person keeps her own transcript, and an older session copy still opens", () => {
  const store = new MemoryStorage();
  const account = "9e378544-4c8b-4036-a7a4-63703b50edf2";
  store.setItem(`xumeng-companion-preview:${account}:cast-tangtang`, JSON.stringify({
    sessionId: "old-session",
    messages: [
      { id: "u", role: "user", text: "帮我", createdAt: "2026-11-05T03:29:00.000Z" },
      { id: "a", role: "assistant", text: "今晚先坐近一点", createdAt: "2026-11-05T04:07:00.000Z" },
    ],
  }));
  store.setItem(`xumeng-companion-transcript:${account}:cast-peiwan:other`, JSON.stringify({
    sessionId: "other",
    messages: [{ id: "p", role: "assistant", text: "击剑馆新到一副手套", createdAt: "2026-11-05T04:05:00.000Z" }],
  }));
  const tangtang = readPersonTranscript(account, "cast-tangtang", store);
  assert.deepEqual(tangtang.messages.map(message => message.text), ["帮我", "今晚先坐近一点"]);
  assert.equal(tangtang.sessionId, "old-session");
  assert.deepEqual(readPersonTranscript(account, "cast-peiwan", store).messages.map(message => message.text), ["击剑馆新到一副手套"]);
  store.setItem(`xumeng-companion-transcript:${account}:cast-tangtang:old-session`, store.getItem(`xumeng-companion-preview:${account}:cast-tangtang`) || "");
  publishCompanionTranscript(account, "cast-tangtang", "new-session", [
    { id: "a", role: "assistant", text: "今晚先坐近一点。", createdAt: "2026-11-05T04:07:00.000Z" },
    { id: "b", role: "user", text: "再留一会儿", createdAt: "2026-11-05T04:08:00.000Z" },
  ], store);
  assert.deepEqual(readPersonTranscript(account, "cast-tangtang", store).messages.map(message => message.text), ["帮我", "今晚先坐近一点。", "再留一会儿"]);
  clearPersonTranscript(account, "cast-tangtang", store);
  assert.deepEqual(readPersonTranscript(account, "cast-tangtang", store).messages, []);
  assert.equal(readPersonTranscript(account, "cast-peiwan", store).messages.length, 1);
});
