import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  addDirectorSegment,
  alignedLength,
  CONTINUATION_OVERLAP,
  directorClipLanes,
  directorOutputSeconds,
  directorPrompt,
  directorTrackHeight,
  editDirectorWindow,
  emptyDirector,
  framesForSeconds,
  mergeDirectorReferences,
  seedDirectorPrompt,
  setDirectorDuration,
  slimDirectorForSubmit,
  toTimelineData,
  validateTimelineDirector,
} from "../src/lib/drama-timeline";
import { buildDirectorGraph } from "../src/lib/drama-comfy";

test("overlapping director clips pack into scrollable lanes", () => {
  const a = {
    id: "a",
    mediaId: "m1",
    name: "one",
    sourceDuration: 8,
    start: 0,
    trimStart: 0,
    duration: 8,
    hasAudio: true,
    referenceMode: "edit" as const,
  };
  const b = { ...a, id: "b", mediaId: "m2", name: "two", start: 2 };
  const packed = directorClipLanes([a, b]);
  assert.equal(packed.count, 2);
  assert.equal(packed.lanes.get("a"), 0);
  assert.equal(packed.lanes.get("b"), 1);
  const sequential = directorClipLanes([a, { ...b, start: 8 }]);
  assert.equal(sequential.count, 1);
  assert.ok(directorTrackHeight([a, b]) > directorTrackHeight([a]));
});

test("single-segment director serializes a global prompt without windows", () => {
  const director = validateTimelineDirector({
    ...emptyDirector(15),
    enabled: true,
    globalPrompt: "A woman closes the door.",
  });
  const data = JSON.parse(
    toTimelineData(director, {}, {}, "fallback from the inspector"),
  );
  assert.equal(data.globalPrompt, "A woman closes the door.");
  assert.equal(data.segmentConfig.count, 0);
  assert.equal(directorOutputSeconds(director), 15);
});

test("director prompt stays on the dock and wins over the inspector fallback", () => {
  const director = seedDirectorPrompt(
    { ...emptyDirector(15), enabled: true },
    "assembled inspector prompt",
  );
  assert.equal(director.globalPrompt, "assembled inspector prompt");
  assert.equal(
    directorPrompt(director, "should not be used"),
    "assembled inspector prompt",
  );
  const kept = seedDirectorPrompt(
    { ...director, globalPrompt: "edited on the director" },
    "assembled inspector prompt",
  );
  assert.equal(kept.globalPrompt, "edited on the director");
});

test("adding a segment keeps an H3-legal overlap", () => {
  const next = addDirectorSegment({
    ...emptyDirector(15),
    enabled: true,
  });
  assert.equal(next.segments.length, 2);
  const overlap = next.segments[0].endFrame - next.segments[1].startFrame;
  assert.equal(overlap, CONTINUATION_OVERLAP);
  assert.equal((next.segments[1].endFrame - next.segments[1].startFrame - 5) % 17, 0);
  const data = JSON.parse(toTimelineData(next, {}, {}, "continue the same shot"));
  assert.equal(data.segmentConfig.mode, "timeline");
  assert.equal(data.segmentConfig.count, 2);
});

test("moving a later GEN window by a few frames keeps the continuation overlap", () => {
  const two = addDirectorSegment({ ...emptyDirector(15), enabled: true });
  const start = two.segments[1].startFrame;
  const nudged = editDirectorWindow(two.segments, 1, "move", start + 5);
  assert.equal(nudged[0].endFrame - nudged[1].startFrame, CONTINUATION_OVERLAP);
  assert.equal(nudged[1].endFrame - nudged[1].startFrame, two.segments[1].endFrame - start);
});

test("a large move can drop overlap, and the left edge can restore it", () => {
  const two = addDirectorSegment({ ...emptyDirector(15), enabled: true });
  const gapped = editDirectorWindow(
    two.segments,
    1,
    "move",
    two.segments[0].endFrame + 80,
  );
  assert.equal(gapped[0].endFrame - gapped[1].startFrame, 0);
  const slidBack = editDirectorWindow(
    gapped,
    1,
    "move",
    gapped[0].endFrame - CONTINUATION_OVERLAP,
  );
  assert.equal(slidBack[0].endFrame - slidBack[1].startFrame, CONTINUATION_OVERLAP);
  const restored = editDirectorWindow(
    gapped,
    1,
    "left",
    gapped[0].endFrame - CONTINUATION_OVERLAP,
  );
  assert.equal(restored[0].endFrame - restored[1].startFrame, CONTINUATION_OVERLAP);
});

test("dragging a GEN edge keeps H3-legal length and ripples later windows", () => {
  const two = addDirectorSegment({ ...emptyDirector(15), enabled: true });
  const stretched = editDirectorWindow(two.segments, 0, "right", 500);
  assert.equal((stretched[0].endFrame - stretched[0].startFrame - 5) % 17, 0);
  assert.equal(
    stretched[1].startFrame - two.segments[1].startFrame,
    stretched[0].endFrame - two.segments[0].endFrame,
  );
});

test("duration slider can lengthen a multi-segment timeline", () => {
  const two = addDirectorSegment({ ...emptyDirector(15), enabled: true });
  const longer = setDirectorDuration(two, 40);
  assert.ok(directorOutputSeconds(longer) >= 29);
  assert.ok(directorOutputSeconds(longer) <= 40);
});

test("director graph uses planner plus finite sampler", () => {
  const g = buildDirectorGraph("prompt", "9:16", 7, 15, '{"videoClips":[]}');
  assert.equal(g["7"].class_type, "MiniMaxH3TimelinePlanner");
  assert.equal(g["8"].class_type, "MiniMaxH3FiniteSegmentSampler");
  assert.deepEqual(g["8"].inputs.finite_plan, ["7", 2]);
  assert.deepEqual(g["15"].inputs.images, ["8", 1]);
  assert.deepEqual(g["15"].inputs.audio, ["8", 2]);
  assert.ok(!g["11"]);
});

test("bound character cards become director images on every GEN window", () => {
  const two = addDirectorSegment({ ...emptyDirector(24), enabled: true });
  const merged = mergeDirectorReferences(
    two,
    { assetIds: ["card-1"] },
    [{ id: "card-1", title: "安琪", imageUrl: "https://example.com/anqi.png" }],
  );
  assert.equal(merged.images.length, 1);
  assert.equal(merged.images[0].id, "card-1");
  assert.deepEqual(merged.segments[0].imageIds, ["card-1"]);
  assert.deepEqual(merged.segments[1].imageIds, ["card-1"]);
  const data = JSON.parse(
    toTimelineData(merged, {}, { "card-1": "pencil_stills/anqi.png" }, "kiss"),
  );
  assert.equal(data.images[0].file, "pencil_stills/anqi.png");
  assert.deepEqual(data.segmentConfig.segments[0].images, ["card-1"]);
  assert.deepEqual(data.segmentConfig.segments[1].images, ["card-1"]);
});

test("empty GEN imageIds still serialize all hosted director images", () => {
  const two = addDirectorSegment({ ...emptyDirector(24), enabled: true });
  two.images = [{ id: "card-1", name: "安琪", url: "https://example.com/anqi.png" }];
  two.segments = two.segments.map((segment) => ({ ...segment, imageIds: [] }));
  const data = JSON.parse(
    toTimelineData(two, {}, { "card-1": "pencil_stills/anqi.png" }, "kiss"),
  );
  assert.deepEqual(data.segmentConfig.segments[0].images, ["card-1"]);
  assert.deepEqual(data.segmentConfig.segments[1].images, ["card-1"]);
});

test("director submit payload drops data URLs once the GPU file exists", () => {
  const slim = slimDirectorForSubmit({
    ...emptyDirector(15),
    enabled: true,
    images: [
      {
        id: "a",
        name: "安琪",
        url: "data:image/png;base64,AAAA",
        file: "pencil_stills/a.png",
      },
    ],
  });
  assert.equal(slim.images[0].file, "pencil_stills/a.png");
  assert.equal(slim.images[0].url, "comfy-input:pencil_stills/a.png");
  assert.equal(JSON.stringify(slim).includes("data:image"), false);
});

test("director submit refuses unhosted data URLs", () => {
  assert.throws(
    () =>
      slimDirectorForSubmit({
        ...emptyDirector(15),
        enabled: true,
        images: [{ id: "a", name: "安琪", url: "data:image/png;base64,AAAA" }],
      }),
    /尚未传到 GPU/,
  );
});
