// D014: stycke and punkt addresses inside a section, located from the publisher's markers, and
// the amendment marker ("Lag (YYYY:NNN).") per section.

import { canonicalLocator, decodeHtml, sha256, toUnixLineEndings, untaggedHeadingShape } from "./text_lines.mjs";

export const ORDINALS = ["första", "andra", "tredje", "fjärde", "femte", "sjätte", "sjunde", "åttonde",
  "nionde", "tionde", "elfte", "tolfte"];
const POINT = String.raw`\d+(?:\s?[a-z](?![a-zåäö.]))?`;
// The publisher's marker closes with a full stop or, sometimes, just the end of the line (LAS 33 d §);
// "Lag (2018:672) om …" in running text is a citation, not a marker.
const AMENDMENT_MARKER = /\b(?:Lag|Förordning) \((\d{4}):(\d+)\)(?:\.|(?=[ \t]*(?:\r|\n|$)))/g;

export function normalizePoint(value) {
  return String(value).toLowerCase().replace(/^(\d+)\s*([a-z])$/, "$1 $2");
}

// The words after "N §" in a locator: "", "andra stycket", "2 st.", "andra stycket 2", "2 st. 2 p.",
// "2 p.", "punkt 2". Anything else throws, as an unsupported locator always has.
export function parseSubdivisionSuffix(suffix) {
  const value = String(suffix ?? "").trim().replace(/\s+/g, " ");
  if (!value) return { stycke: null, point: null };
  const ordinals = ORDINALS.join("|");
  const withStycke = value.match(new RegExp(
    `^(?:(${ordinals}) stycket|(\\d+) st(?:\\.|ycket)?)(?: (?:(${POINT})(?: ?p\\.?)?|(?:p\\.?|punkt(?:en)?) ?(${POINT})))?$`, "i"));
  if (withStycke) {
    const stycke = withStycke[1] ? ORDINALS.indexOf(withStycke[1].toLowerCase()) + 1 : Number(withStycke[2]);
    const point = withStycke[3] ?? withStycke[4];
    if (stycke >= 1) return { stycke, point: point ? normalizePoint(point) : null };
  }
  const pointOnly = value.match(new RegExp(`^(?:(${POINT}) ?p\\.?|punkt(?:en)? (${POINT}))$`, "i"));
  if (pointOnly) return { stycke: null, point: normalizePoint(pointOnly[1] ?? pointOnly[2]) };
  return null;
}

export function canonicalSubdivisionLocator({ chapter, section, stycke, point }) {
  const base = canonicalLocator({ chapter, section });
  const styckeName = ORDINALS[stycke - 1] ? `${ORDINALS[stycke - 1]} stycket` : `${stycke} st.`;
  return `${base} ${styckeName}${point ? ` ${point}` : ""}`;
}

// The raw span [start, end) with each whitespace run collapsed to one space and the ends trimmed;
// map[i] is the raw offset of normalized character i, so a normalized match maps back to raw offsets.
export function normalizeWithMap(text, start, end) {
  let normalized = "";
  const map = [];
  let pendingSpace = false;
  for (let i = start; i < end; i += 1) {
    if (/\s/.test(text[i])) {
      pendingSpace = normalized.length > 0;
      continue;
    }
    if (pendingSpace) {
      normalized += " ";
      map.push(i - 1);
      pendingSpace = false;
    }
    normalized += text[i];
    map.push(i);
  }
  return { normalized, map };
}

// The end of `line` matched in `normalized` from `cursor`, or -1. The plain text wraps lines after a
// hyphen ("26-" / "28 §§"), which normalises to "26- 28"; that space is skipped when the HTML has none.
function matchLine(normalized, cursor, line) {
  let position = cursor;
  for (let i = 0; i < line.length; i += 1, position += 1) {
    if (normalized[position] === " " && line[i] !== " " && /[-–]/.test(normalized[position - 1] ?? "")) position += 1;
    if (normalized[position] !== line[i]) return -1;
  }
  return position;
}

const rawSpan = (map, from, to) => ({ start_offset: map[from], end_offset_exclusive: map[to - 1] + 1 });

const HEADING_MARKER_AT_END = /\s*\/Rubriken (?:träder i kraft|upphör att gälla) [IU]:[^/]+\/$/i;

function styckeBlocks(sectionHtml, anchorName) {
  const escaped = anchorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markers = [...sectionHtml.matchAll(new RegExp(`<a\\s+name=["']${escaped}S(\\d+)["']\\s*>\\s*</a>`, "g"))];
  const pieces = [{ number: 1, html: sectionHtml.slice(0, markers[0]?.index ?? sectionHtml.length) }];
  markers.forEach((marker, position) => {
    pieces.push({
      number: Number(marker[1]),
      html: sectionHtml.slice(marker.index + marker[0].length, markers[position + 1]?.index ?? sectionHtml.length),
    });
  });
  return pieces.map((piece) => {
    const headingAt = piece.html.search(/<h[1-6]\b/i);
    const textHtml = headingAt < 0 ? piece.html : piece.html.slice(0, headingAt);
    const afterHeadings = headingAt < 0 ? "" : piece.html.slice(headingAt).replace(/<(h[1-6])\b[\s\S]*?<\/\1>/gi, "");
    // A "/Rubriken … I:/U:/" marker belongs to a heading (D011), never to a stycke.
    const toLines = (html) => html.split(/<br\s*\/?>/i)
      .map((line) => decodeHtml(line.replace(/<[^>]+>/g, "")).replace(HEADING_MARKER_AT_END, ""))
      .filter(Boolean);
    return {
      number: piece.number,
      lines: toLines(textHtml),
      heading: headingAt < 0 ? null : decodeHtml(piece.html.slice(headingAt).match(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2]?.replace(/<[^>]+>/g, "") ?? ""),
      textAfterHeading: toLines(afterHeadings).length > 0,
    };
  });
}

// The stycken of one section. The publisher prints an empty anchor <name>S2, S3 … before each
// block after the first; trailing heading-only or empty blocks belong to the next section's
// heading run. Each remaining block must be ordinary text and equal, after whitespace
// normalisation, the next stretch of the plain-text section; anything else leaves the structure
// unconfirmed. `anchor` and `nextAnchor` come from parseHtmlParagraphAnchors.
export function styckeStructure({ text, html, anchor, nextAnchor, section, normalizedSection = null }) {
  const unconfirmed = (reason, details = {}) => ({ status: "unconfirmed", reason, ...details });
  if (section.boundary_check) return unconfirmed("section_boundary_unconfirmed");
  const sectionHtml = String(html ?? "").slice(anchor.html_end, nextAnchor?.html_start ?? String(html ?? "").length);
  let blocks = styckeBlocks(sectionHtml, anchor.name);
  // In an Act's last section the publisher prints the transitional provisions (and any annexes)
  // after a heading inside the same span: the stycken end at that heading (D014).
  let appendedAfter = null;
  if (!nextAnchor) {
    const at = blocks.findIndex((block, position) => /^(?:Övergångsbestämmelser|Bilaga|Bilagor)\b/i.test(block.heading ?? "")
      && (block.textAfterHeading || blocks.slice(position + 1).some((later) => later.lines.length)));
    if (at >= 0) {
      appendedAfter = blocks[at].heading;
      blocks = [...blocks.slice(0, at), { ...blocks[at], heading: null, textAfterHeading: false }];
    }
  }
  // Trailing heading-only or empty blocks hold the next section's headings; at a chapter end the
  // publisher restarts their S numbers after the chapter heading, so they are dropped before the
  // numbering check.
  while (blocks.length && !blocks.at(-1).lines.length) blocks.pop();
  if (!blocks.length) return unconfirmed("no_text_block");
  if (blocks.some((block, position) => block.number !== position + 1)) return unconfirmed("stycke_anchor_numbers_out_of_order");
  const inner = blocks.findIndex((block, position) => !block.lines.length || block.textAfterHeading
    || (block.heading !== null && position < blocks.length - 1));
  if (inner >= 0) return unconfirmed("heading_or_empty_block_inside_section", { stycke: blocks[inner].number });
  let lines = blocks.flatMap((block) => block.lines);
  const afterMarker = lines.findIndex((line, position) => position > 0
    && /\b(?:Lag|Förordning) \(\d{4}:\d+\)\.?$/.test(lines[position - 1]) && untaggedHeadingShape(line));
  if (afterMarker >= 0) {
    // C11 (2026-10-21): outside an Act's last section, heading-shaped lines after the marker are the
    // next section's untagged heading; the index already ends the section at the marker.
    if (!nextAnchor || !lines.slice(afterMarker).every((line) => untaggedHeadingShape(line))) {
      return unconfirmed("unmarked_heading_after_amendment_marker", { line_text: lines[afterMarker] });
    }
    let drop = lines.length - afterMarker;
    while (drop > 0) {
      const last = blocks.at(-1);
      const keep = Math.max(0, last.lines.length - drop);
      drop -= last.lines.length - keep;
      blocks = keep ? [...blocks.slice(0, -1), { ...last, lines: last.lines.slice(0, keep) }] : blocks.slice(0, -1);
    }
    lines = blocks.flatMap((block) => block.lines);
  }

  const { normalized, map } = normalizedSection ?? normalizeWithMap(text, section.start_offset, section.end_offset_exclusive);
  const header = normalized.match(/^\d+(?: [a-z])? §(?!§) ?/);
  let cursor = header ? header[0].length : 0;
  const stycken = [];
  for (const block of blocks) {
    const lineSpans = [];
    const blockStart = cursor;
    for (const line of block.lines) {
      const lineEnd = matchLine(normalized, cursor, line);
      if (lineEnd < 0) return unconfirmed("text_differs_from_html_stycke", { stycke: block.number });
      lineSpans.push({ text: line, ...rawSpan(map, cursor, lineEnd) });
      cursor = lineEnd;
      if (normalized[cursor] === " ") cursor += 1;
    }
    stycken.push({
      number: block.number,
      anchor_name: block.number === 1 ? anchor.name : `${anchor.name}S${block.number}`,
      ...rawSpan(map, blockStart, cursor - (normalized[cursor - 1] === " " ? 1 : 0)),
      lines: lineSpans,
    });
  }
  if (cursor < normalized.length && !appendedAfter) return unconfirmed("text_after_last_stycke");
  return { status: "confirmed", count: stycken.length, stycken, ...(appendedAfter ? { appended_after_heading: appendedAfter } : {}) };
}

// The compact form kept in the index; spans are recomputed at lookup with styckeStructure.
export function styckeSummary(structure) {
  return structure.status === "confirmed"
    ? { status: "confirmed", count: structure.count, ...(structure.appended_after_heading ? { appended_after_heading: structure.appended_after_heading } : {}) }
    : { status: "unconfirmed", reason: structure.reason };
}

// The normalised point number a stycke line starts with ("2 a. …" → "2 a"), or null.
const pointOf = (line) => {
  const label = line.text.match(/^(\d+(?: ?[a-z])?)\. /)?.[1];
  return label ? normalizePoint(label) : null;
};

function locatePoint(stycke, point) {
  const positions = stycke.lines.flatMap((line, position) => (pointOf(line) === point ? [position] : []));
  if (!positions.length) return { status: "not_found" };
  if (positions.length > 1) return { status: "unknown", reason: "point_number_repeated" };
  const [position] = positions;
  const next = stycke.lines[position + 1];
  if (next && !pointOf(next)) return { status: "unknown", reason: "point_end_unconfirmed", line: stycke.lines[position] };
  return { status: "found", span: stycke.lines[position] };
}

// Locate the requested stycke and/or point in a confirmed section span.
export function locateSubdivision({ structure, chapter, section, stycke, point }) {
  if (structure.status !== "confirmed") return { status: "unknown", reason: structure.reason };
  const name = (number, label) => canonicalSubdivisionLocator({ chapter, section, stycke: number, point: label });
  if (stycke) {
    const target = structure.stycken[stycke - 1];
    if (!target) return { status: "not_found", reason: "no_such_stycke", stycke_count: structure.count };
    if (!point) return { status: "found", kind: "stycke", canonical: name(stycke), stycke: target, span: target };
    const located = locatePoint(target, point);
    return { reason: located.status === "not_found" ? "no_such_point" : undefined, ...located, kind: "point",
      canonical: name(stycke, point), stycke: target, stycke_count: structure.count };
  }
  const holders = structure.stycken.filter((item) => item.lines.some((line) => pointOf(line) === point));
  if (!holders.length) return { status: "not_found", reason: "no_such_point", stycke_count: structure.count };
  if (holders.length > 1) return { status: "ambiguous", reason: "point_in_several_stycken", candidates: holders.map((item) => name(item.number, point)) };
  const located = locatePoint(holders[0], point);
  return { ...located, kind: "point", canonical: name(holders[0].number, point), stycke: holders[0], stycke_count: structure.count };
}

// Offset of raw position rawAbs inside the packet `text` built from [start, end) (line endings
// normalised to "\n", outer whitespace trimmed).
export function offsetInPacketText(text, start, end, rawAbs) {
  const leading = text.slice(start, end).match(/^\s*/)[0];
  return toUnixLineEndings(text.slice(start, rawAbs)).length - toUnixLineEndings(leading).length;
}

export function subdivisionFields(text, section, located) {
  const part = toUnixLineEndings(text.slice(located.span.start_offset, located.span.end_offset_exclusive));
  return {
    canonical_locator: located.canonical,
    kind: located.kind,
    stycke: located.stycke.number,
    point: located.kind === "point" ? pointOf(located.span) : null,
    anchor_name: located.stycke.anchor_name,
    text: part,
    text_sha256: sha256(part),
    source_offsets: { start: located.span.start_offset, end_exclusive: located.span.end_offset_exclusive },
    offsets_in_text: {
      start: offsetInPacketText(text, section.start_offset, section.end_offset_exclusive, located.span.start_offset),
      end_exclusive: offsetInPacketText(text, section.start_offset, section.end_offset_exclusive, located.span.end_offset_exclusive),
    },
    basis: "publisher_stycke_anchors_and_point_lines",
  };
}

// D014: the latest (by SFS number) amendment marker printed in the section, or null.
export function lastAmendedBy(sectionText) {
  const markers = [...String(sectionText ?? "").matchAll(AMENDMENT_MARKER)];
  if (!markers.length) return null;
  const latest = markers.reduce((best, marker) => (Number(marker[1]) * 1e6 + Number(marker[2])
    > Number(best[1]) * 1e6 + Number(best[2]) ? marker : best));
  return {
    sfs: `${latest[1]}:${latest[2]}`,
    marker: latest[0],
    marker_count: markers.length,
    ...(sectionText.slice(latest.index + latest[0].length).trim() ? { text_follows: true } : {}),
  };
}
