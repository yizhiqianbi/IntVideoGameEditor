"use client";

import { useEffect, useRef } from "react";
import s from "./character-rich-text.module.css";

/** A frontend card draws its own panel. The markup stays inside this message:
 * no scripts, no remote assets, and no styles that can leave the bubble. */
const START_MARKUP = /^\s*<(?:div|style|details|p|section|article|h[1-6])(?:\s|>)/i;
const SURFACE_MARKUP = /<(?:div|style|details|section|article|table)\b/i;

export function hasCharacterMarkup(text: string): boolean {
  return START_MARKUP.test(text) || SURFACE_MARKUP.test(text);
}

const allowed = new Set(["div", "span", "p", "br", "hr", "b", "strong", "i", "em", "small", "blockquote", "ul", "ol", "li", "details", "summary", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "td", "th", "pre", "code", "font", "center", "section", "article"]);
const dropped = new Set(["script", "iframe", "object", "embed", "svg", "math", "template", "link", "meta", "base", "img", "audio", "video", "source", "form", "input", "button", "textarea", "select", "canvas", "frame", "frameset", "applet", "title"]);
const styleProps = new Set(["color", "background", "background-color", "background-image", "font", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-shadow", "text-decoration", "white-space", "word-break", "overflow-wrap", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "border", "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-width", "border-style", "border-radius", "box-shadow", "box-sizing", "display", "flex", "flex-direction", "flex-wrap", "flex-shrink", "flex-grow", "flex-basis", "gap", "align-items", "justify-content", "align-self", "width", "height", "max-width", "max-height", "min-width", "min-height", "opacity", "overflow", "overflow-x", "overflow-y", "float", "clear", "vertical-align", "list-style", "list-style-type", "position", "top", "right", "bottom", "left", "z-index", "cursor"]);

const HOST_STYLE = `:host{display:block;position:relative;max-width:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.75;}
:host>div{max-width:100%!important;box-sizing:border-box;}
p{margin:.45em 0;} details{margin:.8em 0;} summary{cursor:pointer;}`;

function unsafeCss(value: string): boolean {
  return /url\s*\(|expression\s*\(|javascript\s*:|@import|-moz-binding|behavior\s*:|<\/|\/\*/iu.test(value);
}

function sanitizeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@import[\s\S]*?;/gi, "")
    .replace(/@font-face[\s\S]*?\}/gi, "")
    .replace(/@namespace[\s\S]*?;/gi, "")
    .replace(/expression\s*\(/gi, "(")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/javascript\s*:/gi, "")
    .replace(/-moz-binding\s*:[^;}]*/gi, "")
    .replace(/behavior\s*:[^;}]*/gi, "")
    .replace(/position\s*:\s*fixed/gi, "position:absolute")
    .replace(/<\/?/g, "")
    .slice(0, 50_000);
}

function sanitizeStyle(value: string): string {
  if (value.length > 2_000) return "";
  const kept: string[] = [];
  for (const declaration of value.split(";")) {
    const splitAt = declaration.indexOf(":");
    if (splitAt <= 0) continue;
    const property = declaration.slice(0, splitAt).trim().toLowerCase();
    let propertyValue = declaration.slice(splitAt + 1).trim();
    if (!styleProps.has(property) || !propertyValue || propertyValue.length > 300 || unsafeCss(propertyValue)) continue;
    if (property === "position" && /fixed/i.test(propertyValue)) propertyValue = "absolute";
    kept.push(`${property}: ${propertyValue}`);
  }
  return kept.join("; ");
}

function mountFrontendCard(root: ShadowRoot, html: string) {
  const document = root.ownerDocument;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const styles = [...parsed.querySelectorAll("style")].map(style => sanitizeCss(style.textContent || ""));
  parsed.querySelectorAll("style").forEach(style => style.remove());
  sanitizeTree(parsed.body);
  const base = document.createElement("style");
  base.textContent = `${HOST_STYLE}\n${styles.join("\n")}`;
  root.replaceChildren(base, ...parsed.body.childNodes);
}

function sanitizeTree(parent: ParentNode) {
  for (const child of [...parent.childNodes]) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) { child.remove(); continue; }
    const element = child as Element;
    const tag = element.localName.toLowerCase();
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || dropped.has(tag)) { element.remove(); continue; }
    if (tag === "style") { element.remove(); continue; }
    sanitizeTree(element);
    if (!allowed.has(tag)) { element.replaceWith(...element.childNodes); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name === "class" && /^[A-Za-z0-9_\- ]{1,240}$/u.test(attribute.value)) continue;
      if (name === "id" && /^[A-Za-z][\w:.-]{0,80}$/u.test(attribute.value)) continue;
      if (name === "open" && tag === "details") continue;
      if ((name === "colspan" || name === "rowspan") && /^\d{1,2}$/u.test(attribute.value)) continue;
      if (name === "style") {
        const style = sanitizeStyle(attribute.value);
        if (style) element.setAttribute("style", style);
        else element.removeAttribute(attribute.name);
        continue;
      }
      element.removeAttribute(attribute.name);
    }
  }
}

export default function CharacterRichText({ text }: { text: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    mountFrontendCard(root, text);
  }, [text]);
  return <div ref={host} className={s.content} data-character-markup data-frontend-card />;
}
