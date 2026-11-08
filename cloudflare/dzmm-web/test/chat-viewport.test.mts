import test from "node:test";
import assert from "node:assert/strict";
import { chatViewportAnchorTop, chatViewportFrame, chatViewportSettled } from "../../../src/lib/xumeng-chat-viewport.ts";

test("closed keyboard fills the layout viewport and can be remembered", () => {
  const snapshot = { layoutHeight: 844, visualHeight: 844, offsetTop: 0, fullHeight: 844, keyboardHeight: 0 };
  assert.equal(chatViewportSettled(snapshot), true);
  assert.deepEqual(chatViewportFrame(snapshot), { height: 844, keyboardOpen: false });
});

test("a shrunk visual viewport shortens the shell to the visible area", () => {
  const frame = chatViewportFrame({
    layoutHeight: 844, visualHeight: 520, offsetTop: 300, fullHeight: 844, keyboardHeight: 0,
  });
  assert.equal(frame.height, 520);
  assert.equal(frame.keyboardOpen, true);
});

test("a layout viewport that already shrank is not shrunk a second time", () => {
  const frame = chatViewportFrame({
    layoutHeight: 520, visualHeight: 360, offsetTop: 90, fullHeight: 844, keyboardHeight: 320,
  });
  assert.equal(frame.height, 520);
  assert.equal(frame.keyboardOpen, true);
  assert.equal(chatViewportSettled({
    layoutHeight: 520, visualHeight: 360, offsetTop: 90, fullHeight: 844, keyboardHeight: 320,
  }), false);
  assert.equal(chatViewportSettled({
    layoutHeight: 520, visualHeight: 520, offsetTop: 0, fullHeight: 844, keyboardHeight: 0,
  }), false);
});

test("virtual keyboard height shortens a layout that stayed full screen", () => {
  const frame = chatViewportFrame({
    layoutHeight: 844, visualHeight: 844, offsetTop: 0, fullHeight: 844, keyboardHeight: 320,
  });
  assert.equal(frame.height, 524);
  assert.equal(frame.keyboardOpen, true);
});

test("a pan offset alone does not shorten a viewport that still fills its layout", () => {
  const frame = chatViewportFrame({
    layoutHeight: 520, visualHeight: 520, offsetTop: 160, fullHeight: 0, keyboardHeight: 0,
  });
  assert.equal(frame.height, 520);
  assert.equal(frame.keyboardOpen, false);
});

test("a stale visual height taller than the window is clipped to the layout", () => {
  const frame = chatViewportFrame({
    layoutHeight: 520, visualHeight: 844, offsetTop: 0, fullHeight: 0, keyboardHeight: 0,
  });
  assert.equal(frame.height, 520);
});

test("anchor top cancels the gap between the shell and the visible top", () => {
  assert.equal(chatViewportAnchorTop(0, -280, 844), 280);
  assert.equal(chatViewportAnchorTop(280, 0, 844), 280);
  assert.equal(chatViewportAnchorTop(40, 40, 844), 0);
});
