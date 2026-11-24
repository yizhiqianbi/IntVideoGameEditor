import { test } from "node:test";
import assert from "node:assert/strict";
import archive from "../src/lib/drama-archive";
const { parseArchive, packArchive, unpackArchive } = archive;
const doc = {
  version: 1,
  title: "A story",
  story: "Summary",
  ratio: "16:9",
  provider: "fal",
  tone: "standard",
  apiKey: "MUST_NOT_EXPORT",
  assets: [
    {
      id: "a",
      kind: "scene",
      title: "Lake",
      description: "Sunrise",
      imageUrl: "data:image/png;base64,aGVsbG8=",
      position: { x: 1, y: 2 },
    },
  ],
  shots: [
    {
      id: "s",
      title: "Opening",
      prompt: "Pan",
      mode: "t2v",
      firstFrame: "",
      lastFrame: "",
      references: "",
      assetIds: ["a"],
      position: { x: 3, y: 4 },
    },
  ],
};
test("archive preserves project settings and associations without credentials", () => {
  const d = parseArchive(doc);
  assert.equal(d.provider, "fal");
  assert.equal(d.story, "Summary");
  assert.deepEqual(d.shots[0].assetIds, ["a"]);
  assert.ok(!JSON.stringify(d).includes("MUST_NOT_EXPORT"));
});
test("position locks survive archive export and import on shots and materials", async () => {
  const locked = parseArchive({ ...doc, shots: doc.shots.map(s => ({ ...s, positionLocked: true })), assets: doc.assets.map(a => ({ ...a, positionLocked: true })) });
  const { doc: restored, urls } = await unpackArchive(await packArchive(locked));
  try {
    assert.equal(restored.shots[0].positionLocked, true);
    assert.equal(restored.assets[0].positionLocked, true);
    assert.equal(parseArchive(doc).shots[0].positionLocked, false);
  } finally { urls.forEach(URL.revokeObjectURL); }
});
test("retired archive tone opens in general mode", () => {
  const d = parseArchive({ ...doc, tone: "mature" });
  assert.equal(d.tone, "standard");
});
test("archive keeps a 3–15 second shot duration", () => {
  const d = parseArchive({
    ...doc,
    shots: [{ ...doc.shots[0], duration: 8 }],
  });
  assert.equal(d.shots[0].duration, 8);
});
test("structured prompt fields and auto model pick survive archive parse", () => {
  const d = parseArchive({
    ...doc,
    shots: [
      {
        ...doc.shots[0],
        modelPick: "auto",
        promptFields: { action: "亲吻", camera: "中近景", sound: "呼吸" },
      },
    ],
    promptSettings: { style: "写实", camera: "中近景", lighting: "", audio: "", negative: "" },
  });
  assert.equal(d.shots[0].modelPick, "auto");
  assert.equal(d.shots[0].promptFields?.camera, "中近景");
  assert.equal(d.promptSettings?.style, "写实");
});
test("shot end stills survive archive parse", () => {
  const d = parseArchive({
    ...doc,
    shots: [{ ...doc.shots[0], endStill: "data:image/jpeg;base64,YQ==", endFrameAssetId: "a" }],
  });
  assert.equal(d.shots[0].endStill, "data:image/jpeg;base64,YQ==");
  assert.equal(d.shots[0].endFrameAssetId, "a");
});
test("invalid references and duplicate ids are rejected", () => {
  assert.throws(() =>
    parseArchive({
      ...doc,
      shots: [{ ...doc.shots[0], assetIds: ["missing"] }],
    }),
  );
  assert.throws(() =>
    parseArchive({ ...doc, shots: [{ ...doc.shots[0], id: "a" }] }),
  );
});
test("old archives without parentId become a linear chain", () => {
  const d = parseArchive({
    ...doc,
    shots: [
      { ...doc.shots[0], id: "s1" },
      { ...doc.shots[0], id: "s2" },
      { ...doc.shots[0], id: "s3" },
    ],
  });
  assert.equal(d.shots[0].parentId, undefined);
  assert.equal(d.shots[1].parentId, "s1");
  assert.equal(d.shots[2].parentId, "s2");
});
test("declared parentId is preserved as a tree", () => {
  const d = parseArchive({
    ...doc,
    shots: [
      { ...doc.shots[0], id: "root", parentId: "" },
      { ...doc.shots[0], id: "left", parentId: "root" },
      { ...doc.shots[0], id: "right", parentId: "root" },
    ],
  });
  assert.equal(d.shots[0].parentId, undefined);
  assert.equal(d.shots[1].parentId, "root");
  assert.equal(d.shots[2].parentId, "root");
});
test("ZIP embeds and restores media without its original source", async () => {
  const blob = await packArchive(doc);
  const { doc: restored, urls } = await unpackArchive(blob);
  try {
    assert.equal(restored.title, doc.title);
    assert.deepEqual(restored.shots[0].assetIds, ["a"]);
    assert.equal(
      await (await fetch(restored.assets[0].imageUrl)).text(),
      "hello",
    );
  } finally {
    urls.forEach(URL.revokeObjectURL);
  }
});
