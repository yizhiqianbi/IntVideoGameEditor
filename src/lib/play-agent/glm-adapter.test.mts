import test from "node:test";
import assert from "node:assert/strict";

import glmAdapterModule from "./glm-adapter";

const { normalizeGlmCodingErrorMessage } =
  glmAdapterModule as typeof import("./glm-adapter");

test("extracts a readable glm coding error message", () => {
  const message = normalizeGlmCodingErrorMessage({
    error: {
      code: "1309",
      message: "您的GLM Coding Plan套餐已到期，暂无法使用。",
    },
  });

  assert.equal(message, "您的GLM Coding Plan套餐已到期，暂无法使用。");
});
