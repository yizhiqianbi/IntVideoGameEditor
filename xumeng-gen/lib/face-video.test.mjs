import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FACE_VIDEO_MAX_BYTES,
  FACE_VIDEO_MAX_SECONDS,
  FACE_VIDEO_PROMPT,
  isVideoFile,
  videoFileProblem,
  videoSecondsProblem,
} from "./face-video.mjs";

test("mp4 and mov files count as video sources", () => {
  assert.equal(isVideoFile("clip.mp4", "video/mp4"), true);
  assert.equal(isVideoFile("clip.MOV", "video/quicktime"), true);
  assert.equal(isVideoFile("clip.m4v", ""), true);
  assert.equal(isVideoFile("scene.png", "image/png"), false);
  assert.equal(isVideoFile("scene.png", ""), false);
});

test("video file checks cover type and size", () => {
  assert.equal(videoFileProblem("clip.mp4", "video/mp4", 2_000_000), "");
  assert.match(videoFileProblem("clip.mp3", "audio/mpeg", 2_000_000), /MP4/);
  assert.match(videoFileProblem("clip.mp4", "video/mp4", FACE_VIDEO_MAX_BYTES + 1), /64MB/);
  assert.match(videoFileProblem("clip.mp4", "video/mp4", 10), /读不了/);
});

test("video duration is capped at thirty seconds", () => {
  assert.equal(videoSecondsProblem(8), "");
  assert.equal(videoSecondsProblem(FACE_VIDEO_MAX_SECONDS), "");
  assert.match(videoSecondsProblem(FACE_VIDEO_MAX_SECONDS + 5), /30 秒/);
  assert.match(videoSecondsProblem(0), /读不了/);
});

test("the video face prompt keeps the clip and only changes the face", () => {
  assert.match(FACE_VIDEO_PROMPT, /换到视频里的人物脸上/);
  assert.match(FACE_VIDEO_PROMPT, /保留视频原有的动作/);
  assert.match(FACE_VIDEO_PROMPT, /只改五官/);
  assert.match(FACE_VIDEO_PROMPT, /成年/);
});
