import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import publicCatalogModule from "@/lib/public-catalog";

const { PUBLIC_CONTENT } = publicCatalogModule;

const REQUIRED_NEW_GAME = {
  slug: "billionaire-path",
  title: "首富人生模拟器",
  coverPath: "/covers/play/billionaire-path.svg",
};

test("every play entry maps to a registered mini-game and cover file", async () => {
  const playEntries = PUBLIC_CONTENT.filter((entry) => entry.type === "play");
  const registrySource = await readFile(
    new URL("./registry.ts", import.meta.url),
    "utf8",
  );

  assert.ok(
    playEntries.length > 0,
    "expected at least one play entry in the public catalog",
  );

  for (const entry of playEntries) {
    assert.match(
      registrySource,
      new RegExp(`slug:\\s*"${entry.slug}"`),
      `missing mini-game registry entry for ${entry.slug}`,
    );
    assert.equal(
      entry.coverImageUrl,
      `/covers/play/${entry.slug}.svg`,
      `play cover must follow the standard cover path for ${entry.slug}`,
    );

    await access(
      new URL(`../../../../public/covers/play/${entry.slug}.svg`, import.meta.url),
    );
  }
});

test("the billionaire biography simulator is published as a play entry with a cover", async () => {
  const registrySource = await readFile(
    new URL("./registry.ts", import.meta.url),
    "utf8",
  );
  const publicEntry = PUBLIC_CONTENT.find((entry) => entry.slug === REQUIRED_NEW_GAME.slug);

  assert.match(
    registrySource,
    new RegExp(`slug:\\s*"${REQUIRED_NEW_GAME.slug}"`),
    "expected the new biography mini-game to be registered in the mini-game registry",
  );
  assert.match(
    registrySource,
    new RegExp(`title:\\s*"${REQUIRED_NEW_GAME.title}"`),
    "expected the new biography mini-game title to be declared in the mini-game registry",
  );
  assert.ok(publicEntry, "expected the new biography mini-game to be in the public catalog");
  assert.equal(publicEntry?.type, "play");
  assert.equal(publicEntry?.title, REQUIRED_NEW_GAME.title);
  assert.equal(publicEntry?.coverImageUrl, REQUIRED_NEW_GAME.coverPath);

  await access(
    new URL(`../../../../public${REQUIRED_NEW_GAME.coverPath}`, import.meta.url),
  );
});
