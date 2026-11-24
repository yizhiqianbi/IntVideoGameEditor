import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildDramaInput, DRAMA_MODELS } from "../src/lib/drama";
test("all modes enforce 15 second minimum cost config and route by capability", () => {
  for (const mode of ["t2v", "i2v", "ri2v"] as const) {
    const input = buildDramaInput({
      mode,
      prompt: "test",
      aspectRatio: "9:16",
      firstFrame: "https://example.com/start.png",
      lastFrame: "https://example.com/end.png",
      references: ["https://example.com/ref.png"],
      duration: 5,
      resolution: "768P",
    });
    assert.equal(input.duration, 15);
    assert.equal(input.resolution, "480P");
    assert.equal(input.prompt_expansion_mode, "balanced");
    if (mode === "i2v") {
      assert.equal(input.image_url, "https://example.com/start.png");
      assert.equal(input.end_image_url, "https://example.com/end.png");
      assert.ok(!("aspect_ratio" in input));
      assert.ok(!("reference_image_urls" in input));
    }
    if (mode === "ri2v") {
      assert.deepEqual(input.reference_image_urls, [
        "https://example.com/ref.png",
      ]);
      assert.ok(!("image_url" in input));
    }
  }
  assert.match(DRAMA_MODELS.t2v, /h3-max-turbo/);
  assert.match(DRAMA_MODELS.i2v, /h3-max-turbo/);
  assert.equal(DRAMA_MODELS.ri2v, "minimax/h3-max/reference-to-video");
});
test("invalid requests are rejected before charging", () => {
  const base = { prompt: "test", aspectRatio: "9:16" };
  for (const b of [
    { ...base, mode: "i2v" },
    { ...base, mode: "ri2v", references: [] },
    {
      ...base,
      mode: "ri2v",
      references: Array(10).fill("https://example.com/a.png"),
    },
    { ...base, mode: "i2v", firstFrame: "file:///etc/passwd" },
    { ...base, mode: "t2v", prompt: "" },
    { ...base, mode: "unknown" },
  ])
    assert.throws(() => buildDramaInput(b));
});
test("GPU accepts long prompts that exceed the fal 7000-character cap", () => {
  const prompt = "他把她抵在门上。".repeat(900);
  assert.ok(prompt.length > 7000);
  assert.throws(() =>
    buildDramaInput({
      mode: "t2v",
      prompt,
      aspectRatio: "9:16",
      provider: "fal",
    }),
  );
  const input = buildDramaInput({
    mode: "t2v",
    prompt,
    aspectRatio: "9:16",
    provider: "comfy",
  });
  assert.equal(input.prompt, prompt);
});

test("RI2V accepts GPU-hosted still filenames", () => {
  const input = buildDramaInput({
    mode: "ri2v",
    prompt: "test",
    aspectRatio: "9:16",
    references: [
      "comfy-input:pencil_stills/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    ],
  });
  assert.deepEqual(input.reference_image_urls, [
    "comfy-input:pencil_stills/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
  ]);
});
