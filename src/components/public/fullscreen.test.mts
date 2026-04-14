import test from "node:test";
import assert from "node:assert/strict";
import fullscreen from "./fullscreen.ts";

const {
  exitDocumentFullscreen,
  getFullscreenElement,
  isFullscreenSupported,
  requestElementFullscreen,
} = fullscreen;

test("getFullscreenElement returns standard fullscreen element first", () => {
  const element = { id: "stage" };
  const documentLike = {
    fullscreenElement: element,
    webkitFullscreenElement: null,
  };

  assert.equal(getFullscreenElement(documentLike), element);
});

test("getFullscreenElement falls back to webkit fullscreen element", () => {
  const element = { id: "stage" };
  const documentLike = {
    fullscreenElement: null,
    webkitFullscreenElement: element,
  };

  assert.equal(getFullscreenElement(documentLike), element);
});

test("requestElementFullscreen uses standard API when available", async () => {
  let called = false;
  const elementLike = {
    requestFullscreen: async () => {
      called = true;
    },
  };

  await requestElementFullscreen(elementLike);
  assert.equal(called, true);
});

test("requestElementFullscreen falls back to webkit API", async () => {
  let called = false;
  const elementLike = {
    webkitRequestFullscreen: async () => {
      called = true;
    },
  };

  await requestElementFullscreen(elementLike);
  assert.equal(called, true);
});

test("exitDocumentFullscreen uses standard API when available", async () => {
  let called = false;
  const documentLike = {
    exitFullscreen: async () => {
      called = true;
    },
  };

  await exitDocumentFullscreen(documentLike);
  assert.equal(called, true);
});

test("exitDocumentFullscreen falls back to webkit API", async () => {
  let called = false;
  const documentLike = {
    webkitExitFullscreen: async () => {
      called = true;
    },
  };

  await exitDocumentFullscreen(documentLike);
  assert.equal(called, true);
});

test("isFullscreenSupported detects either standard or webkit entrypoints", () => {
  assert.equal(isFullscreenSupported({ requestFullscreen() {} }), true);
  assert.equal(isFullscreenSupported({ webkitRequestFullscreen() {} }), true);
  assert.equal(isFullscreenSupported({}), false);
});
