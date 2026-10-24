import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import mediaModule from "./dzmm-character-media";
import charactersModule from "./dzmm-characters";
const { getDzmmCharacterMedia, withDzmmPublicOpening } = mediaModule as typeof import("./dzmm-character-media");
const { DZMM_CHARACTERS, exportCharacterJson } = charactersModule as typeof import("./dzmm-characters");

test("rendered opening matches independent DOM capture without changing verified introductions", () => {
  const role = DZMM_CHARACTERS.find((item) => item.id === "3691277")!;
  const captured = JSON.parse(readFileSync("output/dzmm/source-rendered-opening-3691277.json", "utf8"));
  const enhanced = withDzmmPublicOpening(role);
  assert.equal(enhanced.firstMessage, captured.text);
  assert.equal(role.firstMessage, "");
  assert.equal(enhanced.description, role.description);
  assert.equal(enhanced.publicIntroductionSha256, role.publicIntroductionSha256);
  assert.equal(getDzmmCharacterMedia(role)?.opening?.sha256, createHash("sha256").update(captured.text).digest("hex"));
  assert.match(JSON.parse(exportCharacterJson(enhanced)).creator_notes, /渲染结果/);
  assert.equal(getDzmmCharacterMedia({ ...role, sourceKind: "original" }), undefined);
});

test("the four source gallery images match deployed file checksums and the public manifest", () => {
  assert.deepEqual(readFileSync("src/lib/dzmm-character-media.json"), readFileSync("public/dzmm/public-character-media.json"));
  const role = DZMM_CHARACTERS.find((item) => item.id === "3691277")!;
  const gallery = getDzmmCharacterMedia(role)!.gallery;
  assert.equal(gallery.length, 4);
  for (const image of gallery) assert.equal(createHash("sha256").update(readFileSync(`public${image.path}`)).digest("hex"), image.sha256);
});
