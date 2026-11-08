import assert from "node:assert/strict";
import { test } from "node:test";
import i18n from "./xumeng-i18n";

const {
  XUMENG_DEFAULT_LOCALE,
  XUMENG_LOCALES,
  XUMENG_MESSAGES,
  isXumengLocale,
  normalizeXumengLocale,
  resolveXumengLocale,
  xumengHtmlLang,
  xumengLocaleInstruction,
  xumengLocaleLabel,
  xumengTranslate,
} = i18n as typeof import("./xumeng-i18n");

test("locale parsing accepts common browser tags and keeps an unsupported fallback", () => {
  assert.equal(normalizeXumengLocale("en-US"), "en");
  assert.equal(normalizeXumengLocale("zh_TW"), "zh-Hant");
  assert.equal(normalizeXumengLocale("zh-CN"), "zh-Hans");
  assert.equal(normalizeXumengLocale("ja-JP"), "ja");
  assert.equal(normalizeXumengLocale("ko-KR"), "ko");
  assert.equal(normalizeXumengLocale("fr-FR"), null);
  assert.equal(resolveXumengLocale(null, ["fr-FR", "ja-JP"]), "ja");
  assert.equal(resolveXumengLocale(null, ["fr-FR"]), XUMENG_DEFAULT_LOCALE);
  assert.equal(isXumengLocale("zh-Hans"), true);
  assert.equal(isXumengLocale("zh-CN"), false);
});

test("every supported locale has complete shell copy and document metadata", () => {
  const keys = Object.keys(XUMENG_MESSAGES.en).sort();
  for (const locale of XUMENG_LOCALES) {
    assert.deepEqual(Object.keys(XUMENG_MESSAGES[locale]).sort(), keys);
    assert.ok(xumengLocaleLabel(locale));
    assert.ok(xumengHtmlLang(locale).includes("-"));
    assert.ok(xumengLocaleInstruction(locale));
    assert.ok(xumengTranslate(locale, "navPlay"));
  }
});
