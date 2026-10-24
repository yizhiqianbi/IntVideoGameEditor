import test from "node:test";
import assert from "node:assert/strict";

import openRouterModule from "./openrouter-adapter";

const { normalizeOpenRouterErrorMessage } =
  openRouterModule as typeof import("./openrouter-adapter");

test("extracts a readable openrouter error message", () => {
  const message = normalizeOpenRouterErrorMessage({
    error: {
      message: "No endpoints found that support tool use",
      code: 400,
    },
  });

  assert.equal(message, "No endpoints found that support tool use");
});
