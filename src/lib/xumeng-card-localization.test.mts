import assert from "node:assert/strict";
import test from "node:test";
import type { Character } from "./dzmm-characters";
import * as shelfModule from "./dzmm-public-shelf";
import * as locModule from "./xumeng-card-localization";

const { toDzmmCatalogCard } = ("default" in shelfModule ? shelfModule.default : shelfModule) as typeof import("./dzmm-public-shelf");
const { hasXumengCardTranslation, localizeCharacter, localizedCharacterTags, sourceCharacterTag } =
  ("default" in locModule ? locModule.default : locModule) as typeof import("./xumeng-card-localization");

const sampleCard: Character = {
  id: "published-e16f0000-0000-4000-8000-00000000000e",
  name: "海港档案馆员",
  author: "创作者",
  heat: "120",
  likes: "35",
  cover: "/dzmm/covers/1323657.webp",
  tags: ["原创", "悬疑"],
  description: "帮助成年旅人整理海港档案。",
  personality: "耐心细致",
  scenario: "宁静的海港图书馆",
  firstMessage: "今天想研究哪张海图？",
  sourceUrl: "",
  sourceKind: "original",
  promptOrigin: "original",
  createdAt: "2026-11-27T00:00:00.000Z",
  translations: {
    en: {
      name: "Harbor Archivist",
      tags: ["Original", "Mystery"],
      description: "Helps adult travelers organize coastal archives.",
      personality: "Patient and meticulous",
      scenario: "Quiet coastal library",
      firstMessage: "Which sea chart would you like to inspect today?",
    },
    ja: {
      name: "港の図書館司書",
      tags: ["オリジナル", "ミステリー"],
      description: "旅人のために港の記録を整理する司書。",
      firstMessage: "今日はどの海図を調べますか？",
    },
  },
};

test("localizeCharacter and hasXumengCardTranslation consume backend dynamic translations", () => {
  assert.equal(hasXumengCardTranslation(sampleCard, "en"), true);
  assert.equal(hasXumengCardTranslation(sampleCard, "ja"), true);
  assert.equal(hasXumengCardTranslation(sampleCard, "ko"), false);

  const en = localizeCharacter(sampleCard, "en");
  assert.equal(en.name, "Harbor Archivist");
  assert.equal(en.description, "Helps adult travelers organize coastal archives.");
  assert.equal(en.firstMessage, "Which sea chart would you like to inspect today?");
  assert.deepEqual(en.tags, ["Original", "Mystery"]);
  assert.equal(sourceCharacterTag(sampleCard, "en", "Mystery"), "悬疑");

  const jaTags = localizedCharacterTags(sampleCard, "ja");
  assert.deepEqual(jaTags, ["オリジナル", "ミステリー"]);
});

test("toDzmmCatalogCard preserves slim translations for shelf rendering", () => {
  const slim = toDzmmCatalogCard(sampleCard);
  assert.equal(slim.translations?.en?.name, "Harbor Archivist");
  assert.deepEqual(slim.translations?.en?.tags, ["Original", "Mystery"]);
  assert.equal(slim.translations?.en?.description, "Helps adult travelers organize coastal archives.");
  assert.equal(slim.translations?.en?.firstMessage, undefined);
  assert.equal(slim.translations?.en?.personality, undefined);
});
