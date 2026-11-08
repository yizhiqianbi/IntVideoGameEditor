import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseCharacterImport } from "../../../src/lib/dzmm-characters";
import { parseDzmmNovelDraft } from "../../../src/lib/dzmm-novels";
import { parseTaskMarketInstructions } from "../../../src/lib/dzmm-task-instructions";

// Offline validation only: never connects to databases, providers or accounts.
const file = resolve(process.argv[2] ?? "../../output/xumeng/demo-community-20261009/community.json");
const bytes = await readFile(file);
const data = JSON.parse(bytes.toString("utf8"));
const BATCH = "demo-community-20261009";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
assert.equal(data.schemaVersion, 1); assert.equal(data.isDemo, true); assert.equal(data.batchId, BATCH);
const created = Date.parse(data.generatedAt); assert.ok(Number.isFinite(created));
assert.ok(created <= Date.now() + 60000, "No invented future generation time");
const lengths = { profiles: 100, characters: 40, posts: 100, tasks: 24, novels: 8 };
for (const [key, size] of Object.entries(lengths)) assert.equal(data[key]?.length, size, key);
function provenance(item: any) { assert.equal(item.isDemo, true); assert.equal(item.batchId, BATCH); }
function unique(items: any[], key = "id") { assert.equal(new Set(items.map(v => v[key])).size, items.length, `Unique ${key}`); }
unique(data.profiles); unique(data.profiles, "nickname");
const profiles = new Map(data.profiles.map((v: any) => [v.id, v]));
for (const p of data.profiles) { provenance(p); assert.match(p.id, uuid); assert.match(p.nickname, /演示/); assert.ok(p.bio.length > 20); assert.ok(p.genres.length > 0); assert.equal(p.email, undefined); assert.equal(p.password, undefined); }
unique(data.characters); const characters = new Map(data.characters.map((v: any) => [v.id, v]));
for (const c of data.characters) {
  provenance(c); assert.equal(c.sourceKind, "original"); assert.equal(c.promptOrigin, "original"); assert.equal(c.sourceUrl, "");
  assert.match(c.name, /演示/); assert.match(c.cover, /^\/demo\/assets\/cover\/[A-Za-z0-9_-]+\.svg$/);
  const owner: any = profiles.get(c.publication?.authorId); assert.ok(owner); assert.equal(c.author, owner.nickname);
  assert.equal(c.publication.publishedAt, created); assert.equal(c.heat, "0"); assert.equal(c.likes, "0");
  const parsed = parseCharacterImport(c, c.id);
  const requiredFields = ["description", "personality", "scenario", "firstMessage", "systemPrompt"] as const;
  for (const k of requiredFields) assert.ok(parsed[k]?.trim(), k);
  assert.ok(parsed.firstMessage.length >= 70); assert.ok(c.suggestedReplies.length >= 3); unique(c.suggestedReplies.map((v: string) => ({ id: v })));
  assert.equal(c.createdAt, data.generatedAt); assert.match(c.creatorNotes, /演示/);
}
unique(data.posts); unique(data.posts.map((v: any) => ({ id: v.author.id })));
for (const p of data.posts) {
  provenance(p); assert.match(p.id, uuid); assert.match(p.title, /演示/); assert.ok(p.body.length >= 80);
  const owner: any = profiles.get(p.author?.id); assert.ok(owner); assert.equal(p.author.nickname, owner.nickname);
  assert.ok(["characters", "social", "life", "help"].includes(p.category));
  for (const key of ["upvotes", "downvotes", "replyCount", "myVote"]) assert.equal(p[key], 0);
  assert.equal(p.createdAt, created); assert.equal(p.updatedAt, created);
}
unique(data.tasks);
for (const t of data.tasks) {
  provenance(t); assert.match(t.id, uuid); assert.match(t.title, /演示/); assert.ok(t.description.length >= 60);
  const owner: any = profiles.get(t.owner?.id); assert.ok(owner); assert.equal(t.owner.nickname, owner.nickname);
  assert.ok(["roleplay", "writing", "feedback"].includes(t.category)); parseTaskMarketInstructions(t.instructions);
  if (t.characterId !== null) { const c: any = characters.get(t.characterId); assert.ok(c); assert.equal(t.characterName, c.name); }
  assert.equal(t.canClaim, false); assert.equal(t.participating, false); assert.equal(t.approvedCount, 0); assert.equal(t.submissionCount, 0);
  assert.equal(t.remainingSlots, t.slots); assert.equal(t.createdAt, created); assert.equal(t.updatedAt, created);
  assert.ok(t.deadlineAt > created); assert.match(t.reviewReason, /演示/);
}
unique(data.novels.map((v: any) => ({ id: v.draft.id })));
for (const n of data.novels) { provenance(n); assert.ok(profiles.has(n.ownerId)); const d = parseDzmmNovelDraft(n.draft); assert.match(d.title, /演示/); assert.ok(d.outline.length >= 130); assert.ok(d.outline.split("\n").filter(v => /^\d+\./.test(v)).length >= 4); assert.ok(d.chapters.length > 0); assert.ok(d.chapters[0].content.length >= 300); }
for (const key of ["sessions", "orders", "votes", "replies", "payments", "usage", "signins", "assignments"]) assert.equal(data[key], undefined);
const report = { ok: true, evidenceLevel: "offline-real-parsers", checkedAt: new Date().toISOString(), batchId: BATCH, counts: lengths, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, productionWrites: 0, accountsCreated: 0, externalRequests: 0 };
if (process.argv[3]) await writeFile(resolve(process.argv[3]), JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report) + "\n");
