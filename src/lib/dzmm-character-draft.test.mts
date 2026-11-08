import test from "node:test";
import assert from "node:assert/strict";
import draftModule from "./dzmm-character-draft";
import characterModule from "./dzmm-characters";
import type { DzmmCharacterBookEntry } from "./dzmm-character-context";

const { omitBlankDzmmBookDraftEntries } = draftModule as typeof import("./dzmm-character-draft");
const { exportCharacterJson, parseCharacterImport } = characterModule as typeof import("./dzmm-characters");

function placeholder(change: Partial<DzmmCharacterBookEntry> = {}, keysText = "", secondaryText = "") {
  return { key: "editor-row", entry: { id: "lore-row", name: "", keys: [], content: "", enabled: true, constant: false, ...change }, keysText, secondaryText };
}

test("untouched worldbook placeholders no longer prevent a private card from saving and reopening", () => {
  const complete = placeholder({ name: "旧码头", keys: ["旧码头"], content: "邮差上午十点收信。" }, "旧码头");
  const blank = placeholder({ name: "  ", content: "\n" }, " ", "\t");
  const rows = [complete, blank];
  const retained = omitBlankDzmmBookDraftEntries(rows);
  assert.deepEqual(retained, [complete]);
  assert.equal(rows.length, 2, "editor input is unchanged until the save succeeds");
  const card = parseCharacterImport({ name: "雾港邮局", characterBook: { scanDepth: 4, entries: retained.map(row => row.entry) } });
  const reopened = parseCharacterImport(exportCharacterJson(card), card.id);
  assert.equal(reopened.characterBook?.scanDepth, 4);
  assert.deepEqual(reopened.characterBook?.entries, card.characterBook?.entries);
});

test("partial writing is retained and remains subject to strict playable-card validation", () => {
  for (const row of [
    placeholder({ name: "稍后完善的地点" }),
    placeholder({}, "旧码头"),
    placeholder({}, "", "收信"),
    placeholder({ content: "还没写触发条件的地点设定。" }),
    placeholder({ content: "停用也保留文字。", enabled: false }),
  ]) {
    const retained = omitBlankDzmmBookDraftEntries([row]);
    assert.equal(retained[0], row, "partial text must never be discarded");
    assert.throws(() => parseCharacterImport({ name: "雾港邮局", characterBook: { entries: retained.map(item => ({ ...item.entry, keys: item.keysText ? [item.keysText] : [] })) } }), /世界书/);
  }
});

test("configuration-only changes are preserved instead of mistaken for an untouched row", () => {
  for (const change of [{ enabled: false }, { constant: true }, { selective: true }, { caseSensitive: true }, { insertionOrder: 0 }]) {
    const row = placeholder(change);
    assert.equal(omitBlankDzmmBookDraftEntries([row])[0], row);
  }
});

test("runtime and publication card imports still reject blank entries", () => {
  assert.throws(() => parseCharacterImport({ name: "雾港邮局", characterBook: { entries: [placeholder().entry] } }), /世界书/);
});
