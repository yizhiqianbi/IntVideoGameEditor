import {mkdir, writeFile} from "node:fs/promises";
import {QINGYU_CHARACTERS, QINGYU_CARD_VERSION} from "../engine/src/lib/qingyu-catalog";
import {exportCharacterJson, parseCharacterImport} from "../engine/src/lib/dzmm-characters";

const local = new URL("../authoring/cards/", import.meta.url);
const publicDir = new URL("../public/character-cards/", import.meta.url);
await mkdir(local, {recursive:true});
await mkdir(publicDir, {recursive:true});
const manifest = [];
for (const card of QINGYU_CHARACTERS) {
  const flat = exportCharacterJson(card);
  const data = {
    name:card.name, creator:card.author, character_version:"2.0.0",
    cover:`https://qingyu.xumengchat.top${card.cover}`, tags:card.tags,
    description:card.description, personality:card.personality, scenario:card.scenario,
    first_mes:card.firstMessage, system_prompt:card.systemPrompt,
    post_history_instructions:card.postHistoryInstructions, mes_example:card.messageExamples,
    alternate_greetings:card.alternateGreetings, creator_notes:card.creatorNotes,
    introduction:card.introduction, suggestedReplies:card.suggestedReplies,
    character_book:card.characterBook && {
      name:card.characterBook.name, scan_depth:card.characterBook.scanDepth,
      entries:card.characterBook.entries.map((e,index)=>({
        id:index, keys:e.keys, secondary_keys:e.secondaryKeys??[], content:e.content,
        comment:e.name, enabled:e.enabled!==false, constant:e.constant??false,
        selective:e.selective??false, case_sensitive:e.caseSensitive??false,
        insertion_order:e.insertionOrder??index, position:e.position??"after_char",
      })),
    },
  };
  const v2 = JSON.stringify({spec:"chara_card_v2",spec_version:"2.0",data},null,2)+"\n";
  const imported = parseCharacterImport(v2,card.id);
  if (imported.firstMessage!==card.firstMessage || imported.characterBook?.entries.length!==card.characterBook?.entries.length
    || imported.messageExamples!==card.messageExamples || imported.alternateGreetings?.length!==2) throw new Error("Card round trip failed: "+card.id);
  await writeFile(new URL(`${card.id}.qingyu.json`,local),flat+"\n");
  await writeFile(new URL(`${card.id}.json`,publicDir),v2);
  const md = [
    "---", `name: ${JSON.stringify(card.name)}`, `scenario: ${JSON.stringify(card.scenario)}`,
    `system_prompt: ${JSON.stringify(card.systemPrompt)}`, `tags: ${JSON.stringify(card.tags)}`,
    `cover: ${JSON.stringify(card.cover)}`, "---",
    "<!-- Generated from engine/src/lib/qingyu-cards/. Edit the typed source, then run npm run cards:export. -->",
    "## Description",card.description,"## Personality",card.personality,"## Scenario",card.scenario,
    "## First Message",card.firstMessage,
    ...(card.alternateGreetings??[]).flatMap((text,index)=>[`## Alternate Greeting ${index+1}`,text]),
    "## Example Dialogue",card.messageExamples??"","## Lorebook",
    ...(card.characterBook?.entries??[]).flatMap(e=>[
      `### ${e.name} | ${e.constant?"constant":`keys: ${e.keys.join(", ")}`} | order: ${e.insertionOrder??0}`,e.content,
    ]),"## Creator Notes",card.creatorNotes??"",
  ].join("\n\n")+"\n";
  await writeFile(new URL(`${card.id}.md`,local),md);
  manifest.push({id:card.id,name:card.name,version:QINGYU_CARD_VERSION,openings:1+(card.alternateGreetings?.length??0),loreEntries:card.characterBook?.entries.length,download:`/character-cards/${card.id}.json`});
}
await writeFile(new URL("index.json",publicDir),JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify(manifest,null,2));
