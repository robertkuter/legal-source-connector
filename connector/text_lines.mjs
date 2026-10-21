import { createHash } from "node:crypto";

export function splitLinesWithOffsets(input) {
  const text = String(input ?? "");
  const lines = [];
  const offsets = [];
  let lineStart = 0;
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    if (character !== "\n" && character !== "\r") {
      index += 1;
      continue;
    }

    lines.push(text.slice(lineStart, index));
    offsets.push(lineStart);
    if (character === "\r" && text[index + 1] === "\n") index += 2;
    else index += 1;
    lineStart = index;
  }

  lines.push(text.slice(lineStart));
  offsets.push(lineStart);
  return { lines, offsets };
}

// The packet's text rule: line endings normalised to "\n", outer whitespace trimmed.
export function packetText(text, start, end) {
  return toUnixLineEndings(String(text).slice(start, end)).trim();
}

export function toUnixLineEndings(value) {
  return value.replace(/\r\n|\r/g, "\n");
}

// Collapse runs of whitespace (including line breaks) to one space and trim.
export function normalizeSpace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function canonicalLocator({ chapter, section }) {
  return chapter ? `${chapter} kap. ${section} §` : `${section} §`;
}

const NAMED_ENTITIES = { auml: "ä", ouml: "ö", aring: "å", Auml: "Ä", Ouml: "Ö", Aring: "Å", eacute: "é", uuml: "ü" };

export function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(\w+);/g, (entity, name) => NAMED_ENTITIES[name] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

// D011: a short untagged line that may be a heading the publisher left untagged.
export function untaggedHeadingShape(text) {
  return text.length <= 120 && !/§/.test(text) && !/^[\d(–-]/.test(text) && !/\bLag \(\d{4}:\d+\)/.test(text)
    && !/[,;:]$/.test(text) && (!/\.$/.test(text) || /\bm\.\s?(?:m|fl)\.$/i.test(text))
    // A heading names a topic; a line with a finite verb is a statute sentence.
    && !/\b(?:ska|skall|får|finns|gäller|är|har|avses|anges|tillämpas|krävs)\b/i.test(text);
}
