import type { ReactNode } from "react";
import { applyDzmmReaderNames, splitDzmmCharacterPresentation } from "@/lib/dzmm-character-presentation";
import { splitXumengMessagePresentation } from "@/lib/xumeng-message-presentation";
import s from "./character-introduction.module.css";
import CharacterRichText, { hasCharacterMarkup } from "./character-rich-text";

/** The source stays intact; annotations have their own accessible, collapsible section. */
export default function CharacterIntroduction({ text, creatorNotes, additionalNotes = [], fallback, renderBody, bodyClassName, characterName, userName }: {
  text: string; creatorNotes?: string; additionalNotes?: string[]; fallback?: string;
  renderBody?: (body: string) => ReactNode; bodyClassName?: string;
  characterName?: string; userName?: string;
}) {
  const presentation = splitDzmmCharacterPresentation(text, creatorNotes);
  const body = splitXumengMessagePresentation(presentation.body).body;
  const markup = hasCharacterMarkup(body);
  const escapeName = (value?: string) => value && markup
    ? value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!))
    : value;
  const displayBody = applyDzmmReaderNames(body, { characterName: escapeName(characterName), userName: escapeName(userName) });
  const notes = [...new Set([...presentation.notes, ...additionalNotes])];
  return <div className={s.presentation}>
    {(body || fallback) && <div className={bodyClassName || s.body} data-story-body>
      {markup ? <CharacterRichText text={displayBody} /> : renderBody ? renderBody(displayBody || fallback || "") : displayBody || fallback}
    </div>}
    {notes.length > 0 && <details className={s.notes} data-author-notes>
      <summary>作者备注<span>致谢 · 玩法 · 更新说明</span></summary>
      <div className={s.noteBody}>{notes.map((note, index) => hasCharacterMarkup(note) ? <CharacterRichText key={index} text={note} /> : <p key={index}>{note}</p>)}</div>
    </details>}
  </div>;
}
