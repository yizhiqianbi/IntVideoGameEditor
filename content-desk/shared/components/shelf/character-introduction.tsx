import type { ReactNode } from "react";
import { applyShelfReaderNames, splitShelfCharacterPresentation } from "@/lib/shelf-character-presentation";
import { applyFolioFrontendScripts, type FolioFrontendScript } from "@/lib/folio-frontend-card";
import { splitFolioMessagePresentation } from "@/lib/folio-message-presentation";
import s from "./character-introduction.module.css";
import CharacterRichText, { hasCharacterMarkup } from "./character-rich-text";

function escapeMarkupName(value?: string) {
  return value?.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

/** The source stays intact; annotations have their own accessible, collapsible section. */
export default function CharacterIntroduction({ text, creatorNotes, additionalNotes = [], fallback, renderBody, bodyClassName, characterName, userName, frontendScripts, messageDepth = 0 }: {
  text: string; creatorNotes?: string; additionalNotes?: string[]; fallback?: string;
  renderBody?: (body: string) => ReactNode; bodyClassName?: string;
  characterName?: string; userName?: string;
  frontendScripts?: readonly FolioFrontendScript[]; messageDepth?: number;
}) {
  const scripted = applyFolioFrontendScripts(text, frontendScripts, { role: "assistant", depth: messageDepth, pass: "display" });
  if (hasCharacterMarkup(scripted)) {
    const named = applyShelfReaderNames(scripted, { characterName: escapeMarkupName(characterName), userName: escapeMarkupName(userName) });
    const notes = [...new Set([...additionalNotes, ...splitShelfCharacterPresentation("", creatorNotes).notes])];
    return <div className={s.presentation}>
      <div className={bodyClassName || s.body} data-story-body data-frontend-card>
        <CharacterRichText text={named} />
      </div>
      {notes.length > 0 && <details className={s.notes} data-author-notes>
        <summary>作者备注<span>致谢 · 玩法 · 更新说明</span></summary>
        <div className={s.noteBody}>{notes.map((note, index) => hasCharacterMarkup(note) ? <CharacterRichText key={index} text={note} /> : <p key={index}>{note}</p>)}</div>
      </details>}
    </div>;
  }
  const presentation = splitShelfCharacterPresentation(scripted, creatorNotes);
  const body = splitFolioMessagePresentation(presentation.body).body;
  const markup = hasCharacterMarkup(body);
  const escapeName = (value?: string) => value && markup
    ? value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!))
    : value;
  const displayBody = applyShelfReaderNames(body, { characterName: escapeName(characterName), userName: escapeName(userName) });
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
