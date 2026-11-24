import { test } from "node:test";
import assert from "node:assert/strict";
import comfy from "../src/lib/drama-comfy";

test("H3 reports queue position and clears it once running", async () => {
  const original = globalThis.fetch;
  let running = false;
  globalThis.fetch = async (url) => Response.json(
    String(url).includes("/history/") ? {} : {
      queue_running: running ? [[0, "test-task"]] : [],
      queue_pending: running ? [] : [[0, "other-task"], [1, "test-task"]],
    },
  );
  try {
    assert.deepEqual(await comfy.comfyStatus("test-task"), {status: "IN_QUEUE", queuePosition: 2});
    running = true;
    assert.deepEqual(await comfy.comfyStatus("test-task"), {status: "IN_PROGRESS"});
  } finally { globalThis.fetch = original; }
});
