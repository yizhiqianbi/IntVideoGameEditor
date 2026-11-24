// Independently written, offline illustration of observed presentation rules.
// No downloaded application code is executed. Sentence recognition is simplified:
// English abbreviations/URLs/quoted punctuation differ from the full site lexer.
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const cjkGlobal = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

export function wordUnits(text) {
  return text.split(/\s+/u).filter(part => /[\p{L}\p{N}]/u.test(part))
    .reduce((sum, part) => sum + Math.max(1, (part.match(cjkGlobal) || []).length), 0);
}

export function detectSimpleSentences(text) {
  // Illustration input supports Chinese/Japanese and ordinary English sentences.
  return String(text).split(/(?<=[。！？!?])\s*|(?<=\.)\s+|\n+/u).map(part => part.trim()).filter(Boolean);
}

export function joinSentences(parts) {
  return parts.reduce((result, part) => {
    if (!result) return part;
    const end = result.at(-1);
    const adjacent = /[。！？」』）〉》]/u.test(end) || cjk.test(end)
      || cjk.test(part[0] || '') && /[!?]$/u.test(result);
    return result + (adjacent ? '' : ' ') + part;
  }, '');
}

export function groupReplySentences(sentences) {
  if (sentences.length <= 1) return [...sentences];
  let boundary = 1;
  while (boundary < sentences.length && wordUnits(joinSentences(sentences.slice(0, boundary))) < 4) boundary += 1;
  const chunks = [joinSentences(sentences.slice(0, boundary))];
  for (let index = boundary; index < sentences.length; index += 2) chunks.push(joinSentences(sentences.slice(index, index + 2)));
  return chunks;
}

export function replayPlan(text, character = 'Yume') {
  const chunks = groupReplySentences(detectSimpleSentences(text));
  const cps = character === 'Nari' ? 19.1 : 21;
  let elapsed = 0;
  return { character, cps, simplifiedSentenceLexer: true, chunks: chunks.map((chunk, pieceIndex) => {
    const startMs = elapsed;
    // Timing demonstration only: real TTS start/end may replace text-only timing.
    elapsed += chunk.length / cps * 1000;
    return { pieceIndex, text: chunk, startMs: Math.round(startMs), endMs: Math.round(elapsed) };
  }), durationMs: Math.round(elapsed) };
}
