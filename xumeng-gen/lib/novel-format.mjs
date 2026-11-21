// 小说输出：标题单独解析 + 正文结构化（章节 / 段落）。
// 生成时把格式要求注入 details 字段；返回后由 parseNovelOutput 拆出标题和段落。

export const NOVEL_FORMAT_INSTRUCTION =
  "输出格式：第一行只写小说标题，格式为「标题：标题文字」；从第二行开始写正文；正文按自然段分段，段与段之间空一行；对白单独成段；有章节时用「## 第X章 章节名」作为分节标题；不要输出提纲、解释、字数统计或任何前后缀。";

export function withNovelFormatInstruction(details) {
  const base = String(details ?? "").trim();
  if (!base) return NOVEL_FORMAT_INSTRUCTION;
  if (base.includes("标题：") || base.includes("标题:")) return base.slice(0, 4000);
  return `${base}\n${NOVEL_FORMAT_INSTRUCTION}`.slice(0, 4000);
}

const TITLE_LINE = /^(?:标题|书名|小说名|题目)\s*[:：]\s*(.+)$/i;
const MARKDOWN_HEADING = /^#{1,4}\s+(.+)$/;
const CHAPTER_HEADING = /^第[一二三四五六七八九十百千0-9]+[章节回卷](?:\s*[:：]?\s*.{0,40})?$/;

function cleanTitle(value) {
  return String(value || "").replace(/^[《「『]|[》」』]$/g, "").trim().slice(0, 80);
}

function squashParagraph(block) {
  return block.split("\n").map(line => line.trim()).filter(Boolean).join("").trim();
}

function deriveTitle(paragraph) {
  const text = String(paragraph || "").trim();
  if (!text) return "";
  const first = text.split(/[。！？!?；;]/)[0].trim();
  const source = first.length >= 4 ? first : text;
  return cleanTitle(source.length > 24 ? `${source.slice(0, 24)}…` : source);
}

export function parseNovelOutput(raw, options = {}) {
  const deriveFallbackTitle = options.deriveTitle !== false;
  const text = String(raw ?? "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").trim();
  if (!text) return { title: "", sections: [], plain: "", wordCount: 0 };

  const lines = text.split("\n");
  let title = "";
  let start = 0;
  for (let index = 0; index < Math.min(lines.length, 6); index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const explicit = line.match(TITLE_LINE);
    if (explicit) {
      title = cleanTitle(explicit[1]);
      start = index + 1;
      break;
    }
    if (/^《[^》]{1,80}》$/.test(line)) {
      title = cleanTitle(line);
      start = index + 1;
      break;
    }
    const heading = line.match(MARKDOWN_HEADING);
    if (heading) {
      title = cleanTitle(heading[1]);
      start = index + 1;
      break;
    }
    break;
  }

  const bodyText = lines.slice(start).join("\n").trim();
  const body = bodyText || (start > 0 ? "" : text);

  const hasBlankSeparator = /\n\s*\n/.test(body);
  const perLineParagraphs = Boolean(body) && !hasBlankSeparator;
  const sections = [];
  let current = { heading: "", paragraphs: [] };
  let buffer = [];
  const flushParagraph = () => {
    const paragraph = buffer.map(line => line.trim()).filter(Boolean).join("");
    buffer = [];
    if (paragraph) current.paragraphs.push(paragraph);
  };
  const flushSection = () => {
    flushParagraph();
    if (current.heading || current.paragraphs.length) sections.push(current);
    current = { heading: "", paragraphs: [] };
  };
  for (const line of body.split("\n")) {
    const value = line.trim();
    if (!value) {
      flushParagraph();
      continue;
    }
    const markdown = value.match(MARKDOWN_HEADING);
    const chapter = !markdown && (CHAPTER_HEADING.test(value) || /^[一二三四五六七八九十]+[、.．]/.test(value));
    if (markdown || chapter) {
      flushSection();
      current.heading = cleanTitle(markdown ? markdown[1] : value);
      continue;
    }
    buffer.push(value);
    if (perLineParagraphs) flushParagraph();
  }
  flushSection();

  if (!sections.length && body) {
    const paragraphs = hasBlankSeparator
      ? body.split(/\n\s*\n/).map(part => squashParagraph(part)).filter(Boolean)
      : [squashParagraph(body)];
    sections.push({ heading: "", paragraphs });
  }

  const plainBody = sections.map(section => [section.heading, ...section.paragraphs].filter(Boolean).join("\n")).filter(Boolean).join("\n\n").trim();
  if (!title && deriveFallbackTitle) title = deriveTitle(sections[0]?.paragraphs?.[0] || body);
  const plain = title ? `${title}\n\n${plainBody}`.trim() : plainBody;
  const wordCount = plain.replace(/\s+/g, "").length;
  return { title, sections: sections.map(section => ({ heading: section.heading, paragraphs: section.paragraphs.filter(Boolean) })).filter(section => section.heading || section.paragraphs.length), plain, wordCount };
}

export function plainNovelText(parsed) {
  const title = parsed?.title || "";
  const body = (parsed?.sections || []).map(section => [section.heading, ...(section.paragraphs || [])].filter(Boolean).join("\n")).join("\n\n");
  return title ? `${title}\n\n${body}`.trim() : String(body).trim();
}
