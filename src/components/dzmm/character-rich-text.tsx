"use client";

import { createElement, useEffect, useState, type ReactNode } from "react";
import s from "./character-rich-text.module.css";

/** Card markup is presentation data, never executable UI. Only inert text and
 * a small set of structural tags become React nodes; no source attributes,
 * CSS, links, images, scripts or event handlers are copied into the page. */
export function hasCharacterMarkup(text: string): boolean {
  return /^\s*<(?:div|style|details|p|section|article|h[1-6])(?:\s|>)/i.test(text);
}

const allowed = new Set(["div", "span", "p", "br", "hr", "b", "strong", "i", "em", "small", "blockquote", "ul", "ol", "li", "details", "summary", "h1", "h2", "h3", "h4", "h5", "h6"]);
const omitted = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template", "link", "meta", "base", "img", "audio", "video", "source", "form", "input", "button"]);

export function renderInertCharacterMarkup(text: string, document: Document): ReactNode[] {
  const template = document.createElement("template");
  template.innerHTML = text;
  function children(parent: ParentNode, path: string): ReactNode[] {
    return Array.from(parent.childNodes).map((node, index) => {
      const key = `${path}.${index}`;
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return null;
      const element = node as Element;
      const tag = element.localName.toLowerCase();
      if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || omitted.has(tag)) return null;
      const content = children(element, key);
      if (!allowed.has(tag)) return content;
      return tag === "br" || tag === "hr" ? createElement(tag, { key }) : createElement(tag, { key }, content);
    });
  }
  return children(template.content, "card");
}

export default function CharacterRichText({ text }: { text: string }) {
  const [rendered, setRendered] = useState<{ text: string; nodes: ReactNode[] } | null>(null);
  useEffect(() => { setRendered({ text, nodes: renderInertCharacterMarkup(text, document) }); }, [text]);
  return <div className={s.content} data-character-markup>
    {rendered?.text === text ? rendered.nodes : null}
  </div>;
}
