import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalLocator,
  decodeHtml,
  normalizeSpace,
  sha256,
  splitLinesWithOffsets,
  untaggedHeadingShape,
} from "./text_lines.mjs";
import { buildCrossReferences } from "./cross_references.mjs";
import { lastAmendedBy, normalizeWithMap, parseSubdivisionSuffix, styckeStructure, styckeSummary } from "./subdivisions.mjs";

export { canonicalLocator, decodeHtml, sha256 };

const INDEX_VERSION = "0.11";

const TEMPORAL_MARKER_PATTERNS = [
  {
    pattern: /\/Träder i kraft I:([^/]+)\//i,
    kind: "enters_on",
    marker_code: "I",
    target: "provision",
  },
  {
    pattern: /\/Upphör att gälla U:([^/]+)\//i,
    kind: "ceases_on",
    marker_code: "U",
    target: "provision",
  },
  {
    pattern: /\/Rubriken träder i kraft I:([^/]+)\//i,
    kind: "heading_enters_on",
    marker_code: "I",
    target: "heading",
  },
  {
    pattern: /\/Rubriken upphör att gälla U:([^/]+)\//i,
    kind: "heading_ceases_on",
    marker_code: "U",
    target: "heading",
  },
];

export function parseTemporalMarker(value) {
  const raw = String(value ?? "").trim();
  for (const definition of TEMPORAL_MARKER_PATTERNS) {
    const match = raw.match(definition.pattern);
    if (!match) continue;
    const markerValue = match[1].trim();
    const isIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(markerValue);
    return {
      kind: definition.kind,
      marker_code: definition.marker_code,
      target: definition.target,
      raw: match[0],
      value: markerValue,
      date: isIsoDate ? markerValue : null,
      date_status: isIsoDate ? "dated" : "indeterminate",
    };
  }
  return null;
}

export function provisionTemporalState(capability, matches = []) {
  const capabilityStatus = capability?.temporal?.status ?? "flat";
  const markers = matches
    .map((match) => match.temporal_marker)
    .filter(Boolean);
  if (capabilityStatus === "flat") {
    return {
      capability_status: "flat",
      resolution: "not_applicable",
      markers: [],
    };
  }
  if (markers.length === 0) {
    return {
      capability_status: capabilityStatus,
      resolution: "unmarked_locator",
      markers: [],
      note: "The source contains transition markers elsewhere, but none is attached to this locator in the indexed snapshot.",
    };
  }
  return {
    capability_status: capabilityStatus,
    resolution: matches.length > 1 ? "multiple_versions_unresolved" : "marked_version_unresolved",
    markers,
    note: "The locator carries publisher transition markers. Date-aware version selection is not implemented, so no marked passage is returned as confirmed.",
  };
}

// "13 kap. 6 §", "7 §", and since D014 a stycke and/or point after the section: "13 kap. 6 § andra
// stycket 2", "6 § 2 st.", "6 § punkt 2". stycke and point are null when not requested.
export function parseLocator(locator) {
  const value = String(locator).trim();
  const match = value.match(/^(?:(\d+(?:\s+[a-z])?)\s*kap\.?\s*)?(\d+(?:\s+[a-z])?)\s*§(?!§)(.*)$/i);
  const subdivision = match ? parseSubdivisionSuffix(match[3]) : null;
  if (!match || !subdivision) throw new Error(`Unsupported Swedish SFS locator: ${locator}`);
  return {
    chapter: match[1] ? match[1].replace(/\s+/g, " ").toLowerCase() : null,
    section: match[2].replace(/\s+/g, " ").toLowerCase(),
    ...subdivision,
    requested: locator,
  };
}

function parseChapterLine(line, previousLine = "", headingBlock = "") {
  if (previousLine.trim() !== "") return null;
  if (headingBlock.includes("§")) return null;
  const match = `${line.trim()} ${headingBlock}`.trim().match(/^(\d+(?:\s+[a-z])?)\s+kap\.\s+(.+)$/i);
  if (!match || /^\d/.test(match[2]) || /^\d+(?:\s+[a-z])?\s*§/i.test(match[2])) return null;
  return {
    number: match[1].replace(/\s+/g, " ").toLowerCase(),
    title: match[2].trim(),
  };
}

function parseSectionLine(line, previousLine = "") {
  if (previousLine.trim() !== "") return null;
  const match = line.trim().match(/^(\d+(?:\s+[a-z])?)\s*§(?!§)(?:\s*(.*))$/i);
  if (!match) return null;
  if (match[2]?.trim() === ".") return null;
  return {
    number: match[1].replace(/\s+/g, " ").toLowerCase(),
    heading_text: match[2]?.trim() ?? "",
  };
}

function htmlAttribute(attributes, name) {
  return attributes.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] ?? null;
}

function parseParagraphAnchorName(name) {
  const chaptered = name.match(/^K(\d+)([a-z])?P(\d+)([a-z])?$/i);
  if (chaptered) {
    return {
      chapter: `${chaptered[1]}${chaptered[2] ? ` ${chaptered[2]}` : ""}`.toLowerCase(),
      section: `${chaptered[3]}${chaptered[4] ? ` ${chaptered[4]}` : ""}`.toLowerCase(),
    };
  }
  const chapterless = name.match(/^P(\d+)([a-z])?$/i);
  if (chapterless) {
    return {
      chapter: null,
      section: `${chapterless[1]}${chapterless[2] ? ` ${chapterless[2]}` : ""}`.toLowerCase(),
    };
  }
  return null;
}

export function parseHtmlParagraphAnchors(html) {
  const anchors = [];
  const pattern = /<a\b([^>]*)>\s*<b>([^<]+)<\/b>(?:\s*<\/a>)?/gi;
  for (const match of String(html ?? "").matchAll(pattern)) {
    const attributes = match[1];
    const className = htmlAttribute(attributes, "class");
    if (!className?.split(/\s+/).includes("paragraf")) continue;
    const name = htmlAttribute(attributes, "name");
    const identity = parseParagraphAnchorName(name ?? "");
    const htmlSpan = { html_start: match.index, html_end: match.index + match[0].length };
    if (!identity) {
      anchors.push({ name, heading_text: decodeHtml(match[2]), source_markup: match[0], identity: null, ...htmlSpan });
      continue;
    }
    anchors.push({
      name,
      heading_text: decodeHtml(match[2]),
      source_markup: match[0],
      ...identity,
      ...htmlSpan,
    });
  }
  return anchors;
}

export function findTextSectionCandidates(text) {
  const { lines, offsets: lineOffsets } = splitLinesWithOffsets(text);
  const candidates = [];
  let currentChapter = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const previousLine = lines[i - 1] ?? "";
    const chapterCandidate = previousLine.trim() === ""
      && /^\d+(?:\s+[a-z])?\s+kap\./i.test(line.trim());
    let headingEnd = i + 1;
    if (chapterCandidate) {
      while (headingEnd < lines.length && lines[headingEnd].trim() !== "") headingEnd += 1;
    }
    const headingBlock = chapterCandidate ? lines.slice(i + 1, headingEnd).join(" ") : "";
    const chapter = parseChapterLine(line, previousLine, headingBlock);
    if (chapter) currentChapter = chapter.number;
    const section = parseSectionLine(line, previousLine);
    if (section) {
      candidates.push({
        chapter: currentChapter,
        section: section.number,
        heading_text: section.heading_text,
        start_line: i,
        start_offset: lineOffsets[i],
      });
    }
  }
  return { lines, lineOffsets, candidates };
}

// The publisher's HTML lists headings and paragraph anchors in document order. runs[k] holds the
// heading run that introduces anchor k (runs[0]: before the first anchor; the last entry: after
// the last anchor). A run is read back from the anchor and contains only: tagged headings
// (h1-h6), the "/Rubriken ... I:/U:/" marker attached to a heading, and short untagged lines
// that follow a tagged heading (the publisher sometimes leaves a sub-heading untagged). The
// first ordinary paragraph stops the run, so statute text inside a gap, even text the publisher
// wrapped in a heading tag, is never part of a run unless it sits directly before the anchor.
// The heading-marker grammar is the "heading" entries of TEMPORAL_MARKER_PATTERNS.
const HEADING_MARKER_SPLIT = new RegExp(`(${TEMPORAL_MARKER_PATTERNS
  .filter((definition) => definition.target === "heading")
  .map((definition) => definition.pattern.source.replace(/\((?!\?)/g, "(?:"))
  .join("|")})`, "i");

function gapItems(gapHtml) {
  const items = [];
  const pushText = (html) => {
    for (const piece of html.split(/<p>\s*<a name="[^"]*"><\/a>\s*<\/p>|<br\s*\/?>/i)) {
      const text = decodeHtml(piece.replace(/<[^>]+>/g, " "));
      // A heading marker is its own item even when no paragraph tag separates it from text.
      text.split(HEADING_MARKER_SPLIT).forEach((part, position) => {
        const value = part?.trim();
        // split() puts the captured marker at odd positions.
        if (value) items.push({ kind: position % 2 ? "marker" : "text", text: value });
      });
    }
  };
  let cursor = 0;
  for (const match of gapHtml.matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    pushText(gapHtml.slice(cursor, match.index));
    const text = decodeHtml(match[2].replace(/<[^>]+>/g, " "));
    if (text) items.push({ kind: "heading", text, html_tag: match[1].toLowerCase() });
    cursor = match.index + match[0].length;
  }
  pushText(gapHtml.slice(cursor));
  return items;
}

function trailingHeadingRun(items) {
  const run = [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.kind !== "text" || untaggedHeadingShape(item.text)) run.unshift(item);
    else break;
  }
  // An untagged line counts only when a tagged heading comes before it in the run.
  const firstTagged = run.findIndex((item) => item.kind === "heading");
  if (firstTagged < 0) return [];
  const kept = run.slice(run[firstTagged - 1]?.kind === "marker" ? firstTagged - 1 : firstTagged);
  return kept.flatMap((item, position) => (item.kind === "marker" ? [] : [{
    text: item.text,
    html_tag: item.html_tag ?? null,
    ...(kept[position - 1]?.kind === "marker" ? { marker: kept[position - 1].text } : {}),
  }]));
}

// Every tagged heading text in the publisher's HTML, in document order.
export function htmlHeadingTexts(html) {
  return [...String(html ?? "").matchAll(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => decodeHtml(match[2].replace(/<[^>]+>/g, " ")))
    .filter(Boolean);
}

// `anchors` is the result of parseHtmlParagraphAnchors for the same html (it carries the HTML
// offsets), so the gaps between anchors are cut from exactly the anchors the index uses.
export function htmlHeadingRuns(html, anchors) {
  const source = String(html ?? "");
  const runs = [];
  let cursor = 0;
  for (const anchor of anchors) {
    runs.push(trailingHeadingRun(gapItems(source.slice(cursor, anchor.html_start))));
    cursor = anchor.html_end;
  }
  runs.push(trailingHeadingRun(gapItems(source.slice(cursor))));
  return runs;
}

// Working back from endLine, remove trailing text paragraphs that are, in order, the headings of
// `run`. The paragraph containing protectLine (the section's own start) is never removed, and a
// paragraph that is not one of the expected headings stops the walk, so statute text that merely
// looks like a heading stays. Returns the new end line, the matched headings with their line
// spans, and the expected headings that were not found in the text.
// C11 (2026-10-21): the publisher sometimes prints the next section's heading as plain text, with
// no heading tag, directly after a section's amendment marker ("Lag (2020:985)."). Working back
// from endLine, trailing paragraphs shaped like a heading (untaggedHeadingShape) are cut when the
// paragraph before them ends with such a marker. The section's first paragraph is never cut.
// Callers apply this only to sections that are not the Act's last (transitional provisions follow
// the last marker there).
const ENDS_WITH_AMENDMENT_MARKER = /\b(?:Lag|Förordning) \(\d{4}:\d+\)\.?$/;

export function trimUntaggedHeadingsAfterMarker(lines, protectLine, endLine) {
  const paragraphs = [];
  let end = endLine;
  for (;;) {
    let last = end - 1;
    while (last > protectLine && lines[last].trim() === "") last -= 1;
    if (last < protectLine || lines[last].trim() === "") break;
    let first = last;
    while (first - 1 >= protectLine && lines[first - 1].trim() !== "") first -= 1;
    const touchesStart = first <= protectLine;
    paragraphs.push({ first, last, text: normalizeSpace(lines.slice(first, last + 1).join(" ")), touchesStart });
    if (touchesStart) break;
    end = first;
  }
  let cut = 0;
  while (cut < paragraphs.length && !paragraphs[cut].touchesStart && untaggedHeadingShape(paragraphs[cut].text)) cut += 1;
  const before = paragraphs[cut];
  if (!before) return { endLine, matched: [] };
  if (!ENDS_WITH_AMENDMENT_MARKER.test(before.text)) {
    // The heading may follow the marker's line inside the same paragraph (no blank line between).
    const start = Math.max(before.first, protectLine);
    let markerLine = -1;
    for (let line = before.last - 1; line >= start; line -= 1) {
      if (ENDS_WITH_AMENDMENT_MARKER.test(lines[line].trim())) { markerLine = line; break; }
    }
    const tail = markerLine < 0 ? "" : normalizeSpace(lines.slice(markerLine + 1, before.last + 1).join(" "));
    if (!tail || !untaggedHeadingShape(tail)) return { endLine, matched: [] };
    paragraphs.splice(cut, 1, { first: markerLine + 1, last: before.last, text: tail, touchesStart: false });
    cut += 1;
  }
  if (cut === 0) return { endLine, matched: [] };
  const matched = paragraphs.slice(0, cut).reverse().map((paragraph) => ({
    text: paragraph.text,
    html_tag: null,
    untagged_after_marker: true,
    start_line: paragraph.first,
    end_line_exclusive: paragraph.last + 1,
  }));
  return { endLine: matched[0].start_line, matched };
}

export function trimTrailingHeadings(lines, protectLine, endLine, run) {
  let end = endLine;
  let remaining = [...run];
  const matched = [];
  const unmatched = [];
  for (;;) {
    const pendingMarker = matched[0]?.marker && !matched[0].marker_line;
    if (!remaining.length && !pendingMarker) break;
    let last = end - 1;
    while (last > protectLine && lines[last].trim() === "") last -= 1;
    if (last <= protectLine) break;
    let first = last;
    while (first - 1 > protectLine && lines[first - 1].trim() !== "") first -= 1;
    if (protectLine >= 0 && first - 1 === protectLine && lines[protectLine].trim() !== "") break;
    const block = normalizeSpace(lines.slice(first, last + 1).join(" "));
    const position = remaining.findLastIndex((heading) => normalizeSpace(heading.text) === block
      || (heading.marker && normalizeSpace(`${heading.marker} ${heading.text}`) === block));
    if (position < 0) {
      // A marker standing alone in the paragraph above its (already matched) heading.
      if (matched[0]?.marker && normalizeSpace(matched[0].marker) === block && !matched[0].marker_line) {
        matched[0] = { ...matched[0], start_line: first, marker_line: first + 1 };
        end = first;
        continue;
      }
      break;
    }
    unmatched.unshift(...remaining.slice(position + 1));
    const heading = remaining[position];
    const withMarker = heading.marker && normalizeSpace(heading.text) !== block;
    matched.unshift({ ...heading, start_line: first, end_line_exclusive: last + 1, ...(withMarker ? { marker_line: first + 1 } : {}) });
    remaining = remaining.slice(0, position);
    end = first;
  }
  unmatched.unshift(...remaining);
  return { endLine: end, matched, unmatched };
}

// D012: the words after "N §" of an in-text reference list item ("3 a § om väsentlighet,",
// "7 § om undertecknande och datering."): lower-case continuation, list punctuation or a list
// conjunction at the end, and not a repeal line ("har upphävts genom lag (2000:1).").
function readsAsInTextReference(headingText) {
  return /^\p{Ll}/u.test(headingText)
    && /(?:[,;.]|\b(?:och|eller|samt))$/.test(headingText)
    && !/upphävts|upphört|\bLag \(\d{4}:\d+\)/i.test(headingText);
}

// D012: a text line starts a section only where the publisher's HTML has a paragraph anchor.
// Candidates and anchors are walked in order; a candidate equal to the next anchor's identity is a
// section start. An unanchored candidate inside an anchored section that reads as an in-text
// reference stays statute text; every other unanchored candidate is kept as a start, so the count
// and order checks below still report it and the source is held.
export function alignSectionStarts(anchors, candidates) {
  const starts = [];
  const inTextReferences = [];
  let next = 0;
  let insideAnchored = false;
  for (const candidate of candidates) {
    const anchor = anchors[next];
    if (anchor && anchor.chapter === candidate.chapter && anchor.section === candidate.section) {
      starts.push(candidate);
      next += 1;
      insideAnchored = true;
    } else if (insideAnchored && readsAsInTextReference(candidate.heading_text)) {
      inTextReferences.push(candidate);
    } else {
      starts.push(candidate);
      insideAnchored = false;
    }
  }
  return { starts, inTextReferences };
}

function capabilityAssessment(document) {
  const anchors = parseHtmlParagraphAnchors(document.html);
  const textResult = findTextSectionCandidates(String(document.text ?? ""));
  const { starts, inTextReferences } = alignSectionStarts(anchors, textResult.candidates);
  const issues = [];
  if (!anchors.length) issues.push("No paragraph anchors were found in the HTML representation.");
  if (anchors.some((anchor) => !anchor.chapter && !anchor.section)) {
    issues.push("At least one paragraph anchor has an unrecognized name.");
  }
  if (anchors.length !== starts.length) {
    issues.push(`HTML paragraph anchors (${anchors.length}) and text section candidates (${starts.length}) differ.`);
  }
  const comparableCount = Math.min(anchors.length, starts.length);
  for (let i = 0; i < comparableCount; i += 1) {
    const anchor = anchors[i];
    const candidate = starts[i];
    if (anchor.chapter !== candidate.chapter || anchor.section !== candidate.section) {
      issues.push(`Locator order differs at position ${i + 1}: HTML ${canonicalLocator(anchor)}, text ${canonicalLocator(candidate)}.`);
      break;
    }
  }
  const sectionMarkers = starts
    .map((candidate) => parseTemporalMarker(candidate.heading_text))
    .filter((marker) => marker?.target === "provision");
  const headingMarkers = textResult.lines
    .map((line) => parseTemporalMarker(line))
    .filter((marker) => marker?.target === "heading");
  const markerCounts = {};
  for (const marker of [...sectionMarkers, ...headingMarkers]) {
    markerCounts[marker.kind] = (markerCounts[marker.kind] ?? 0) + 1;
  }
  const temporalStatus = sectionMarkers.length || headingMarkers.length
    ? "layered_unresolved"
    : "flat";
  return {
    status: issues.length === 0 ? "supported" : anchors.length === 0 ? "unsupported" : "review_required",
    method: "html_paragraph_anchors_guide_text_section_starts",
    html_anchor_count: anchors.length,
    // Section-start candidates: text lines read as "N §" minus D012 in-text references.
    text_candidate_count: starts.length,
    in_text_reference_count: inTextReferences.length,
    issues,
    temporal: {
      status: temporalStatus,
      section_marker_count: sectionMarkers.length,
      heading_marker_count: headingMarkers.length,
      marker_counts: markerCounts,
      issues: temporalStatus === "layered_unresolved"
        ? ["Publisher transition markers are present; date-aware version selection is not implemented."]
        : [],
    },
    anchors,
    textResult,
    starts,
    inTextReferences,
  };
}

export function buildIndex({ sourceId, document, rawFile }) {
  const text = String(document.text ?? "");
  const capability = capabilityAssessment(document);
  const lines = capability.textResult.lines;
  const lineOffsets = capability.textResult.lineOffsets;
  const candidates = capability.starts;
  const sections = [];
  const hiddenSections = [];
  const headings = [];
  const unmatchedHeadings = [];
  let structures = [];
  let normalizedSections = [];
  if (capability.status === "supported") {
    const runs = htmlHeadingRuns(document.html, capability.anchors);
    const locatorOf = (position) => canonicalLocator({
      chapter: capability.anchors[position].chapter,
      section: candidates[position].section,
    });
    const recordHeadings = (result, beforeLocator, position) => {
      for (const heading of result.matched) {
        headings.push({
          text: heading.text,
          html_tag: heading.html_tag,
          before_locator: beforeLocator,
          start_line: heading.start_line + 1,
          end_line_exclusive: heading.end_line_exclusive + 1,
          start_offset: lineOffsets[heading.start_line],
          end_offset_exclusive: heading.end_line_exclusive < lines.length
            ? lineOffsets[heading.end_line_exclusive]
            : text.length,
        });
      }
      for (const heading of result.unmatched) {
        unmatchedHeadings.push({ text: heading.text, before_locator: beforeLocator, position });
      }
    };
    // Headings found in the text directly before the next section (HTML run, matched in text).
    const firstLocator = candidates.length ? locatorOf(0) : null;
    const leading = trimTrailingHeadings(lines, -1, candidates[0]?.start_line ?? lines.length, runs[0]);
    recordHeadings(leading, firstLocator, "before_first_section");
    // Headings found in the text directly before the next section (HTML run, matched in text).
    let headingsBefore = leading.matched.map((heading) => heading.text);
    let chapterTitle = null;
    for (let i = 0; i < capability.anchors.length; i += 1) {
      const anchor = capability.anchors[i];
      const candidate = candidates[i];
      const locator = locatorOf(i);
      const nextCandidate = candidates[i + 1];
      const nextLocator = nextCandidate ? locatorOf(i + 1) : null;
      const title = headingsBefore.map((text) => parseChapterLine(text))
        .filter((chapter) => chapter?.number === anchor.chapter).at(-1)?.title;
      if (title) chapterTitle = title;
      else if (i > 0 && anchor.chapter !== capability.anchors[i - 1].chapter) chapterTitle = null;
      const boundary = trimTrailingHeadings(lines, candidate.start_line, nextCandidate?.start_line ?? lines.length, runs[i + 1]);
      if (nextCandidate) {
        const untagged = trimUntaggedHeadingsAfterMarker(lines, candidate.start_line, boundary.endLine);
        if (untagged.matched.length) {
          boundary.endLine = untagged.endLine;
          boundary.matched = [...untagged.matched, ...boundary.matched];
        }
      }
      recordHeadings(boundary, nextLocator, nextCandidate ? "between_sections" : "after_last_section");
      const endLine = boundary.endLine;
      // D013: a line inside this section that reads "N §" + capital letter is a section the
      // publisher printed without its own mark (ABL 15 kap. 41 §). Lower-case continuations are
      // D012 in-text references and stay statute text.
      const hiddenStarts = [];
      for (let line = candidate.start_line + 1; line < endLine; line += 1) {
        const hiddenMatch = lines[line].trim().match(/^(\d+(?:\s+[a-z])?)\s*§\s*\p{Lu}/u);
        if (hiddenMatch) hiddenStarts.push({ line, section: hiddenMatch[1].replace(/\s+/g, " ").toLowerCase() });
      }
      hiddenStarts.forEach((hidden, position) => {
        const hiddenEnd = hiddenStarts[position + 1]?.line ?? endLine;
        hiddenSections.push({
          locator: canonicalLocator({ chapter: anchor.chapter, section: hidden.section }),
          chapter: anchor.chapter,
          section: hidden.section,
          within_locator: locator,
          start_line: hidden.line + 1,
          end_line_exclusive: hiddenEnd + 1,
          start_offset: lineOffsets[hidden.line],
          end_offset_exclusive: hiddenEnd < lines.length ? lineOffsets[hiddenEnd] : text.length,
        });
      });
      // D012 heading stop / D013: this section's end is not confirmed; get_provision holds it and
      // shows the published text with an explanation.
      const unconfirmedEnd = hiddenStarts.length
        ? { status: "unmarked_section_inside", hidden_sections: hiddenStarts.map((hidden) => canonicalLocator({ chapter: anchor.chapter, section: hidden.section })) }
        : nextCandidate && boundary.unmatched.length
          ? { status: "heading_unmatched", unmatched_headings: boundary.unmatched.map((heading) => heading.text) }
          : null;
      const sectionText = lines.slice(candidate.start_line, endLine).join("\n").trim();
      sections.push({
        locator,
        anchor_name: anchor.name,
        chapter: anchor.chapter,
        chapter_title: anchor.chapter ? chapterTitle : null,
        section: candidate.section,
        heading_text: candidate.heading_text,
        headings_before: headingsBefore,
        temporal_marker: parseTemporalMarker(candidate.heading_text),
        start_line: candidate.start_line + 1,
        end_line_exclusive: endLine + 1,
        start_offset: candidate.start_offset,
        end_offset_exclusive: endLine < lines.length
          ? lineOffsets[endLine] ?? text.length
          : text.length,
        section_sha256: sha256(sectionText),
        ...(unconfirmedEnd ? { boundary_check: unconfirmedEnd } : {}),
      });
      headingsBefore = boundary.matched.map((heading) => heading.text);
    }
    // D014: stycke structure and amendment marker per section, then the cross-reference layer.
    normalizedSections = sections.map((section) => normalizeWithMap(text, section.start_offset, section.end_offset_exclusive));
    structures = sections.map((section, position) => styckeStructure({
      text, html: document.html, anchor: capability.anchors[position], nextAnchor: capability.anchors[position + 1], section,
      normalizedSection: normalizedSections[position],
    }));
    sections.forEach((section, position) => {
      section.stycken = styckeSummary(structures[position]);
      // In the last section, markers in the appended transitional provisions or annexes are not the section's.
      const ownEnd = structures[position].appended_after_heading ? structures[position].stycken.at(-1).end_offset_exclusive : section.end_offset_exclusive;
      section.last_amended_by = lastAmendedBy(text.slice(section.start_offset, ownEnd));
    });
  }

  return {
    index_version: INDEX_VERSION,
    source_id: sourceId,
    title: document.titel ?? null,
    sfs_number: document.beteckning ?? null,
    consolidation_signal: document.subtitel ?? null,
    raw_file: rawFile,
    source_text_sha256: sha256(text),
    source_html_sha256: document.html ? sha256(document.html) : null,
    source_text_length: text.length,
    offset_unit: "UTF-16 code units in document.text",
    capability: {
      status: capability.status,
      method: capability.method,
      html_anchor_count: capability.html_anchor_count,
      text_candidate_count: capability.text_candidate_count,
      in_text_reference_count: capability.in_text_reference_count,
      ...(capability.in_text_reference_count ? {
        method_note: `Section starts follow the publisher's paragraph anchors. ${capability.in_text_reference_count} text ${capability.in_text_reference_count === 1 ? "line" : "lines"} shaped "N § om …" without an anchor ${capability.in_text_reference_count === 1 ? "is an in-text reference" : "are in-text references"} and stay statute text of the section they sit in (see in_text_references).`,
      } : {}),
      issues: capability.issues,
      temporal: capability.temporal,
    },
    section_count: sections.length,
    sections,
    hidden_sections: hiddenSections,
    // D012: unanchored "N § om …" lines kept as statute text of the section they sit in.
    in_text_references: sections.length === 0 ? [] : capability.inTextReferences.map((reference) => ({
      line: reference.start_line + 1,
      text: lines[reference.start_line].trim(),
      within_locator: sections.findLast((section) => section.start_line <= reference.start_line + 1)?.locator ?? null,
    })),
    cross_references: buildCrossReferences({
      text,
      sections,
      structures,
      normalizedSections,
      hiddenSections,
      ownSfs: document.beteckning ?? null,
      lineOf: (offset) => {
        let low = 0;
        let high = lineOffsets.length - 1;
        while (low < high) {
          const middle = (low + high + 1) >> 1;
          if (lineOffsets[middle] <= offset) low = middle;
          else high = middle - 1;
        }
        return low + 1;
      },
    }),
    heading_count: headings.length,
    headings,
    heading_alignment: {
      method: "html_heading_runs_between_paragraph_anchors",
      html_heading_count: [...String(document.html ?? "").matchAll(/<h[1-6]\b/gi)].length,
      unmatched_count: unmatchedHeadings.length,
      unmatched_between_sections_count: unmatchedHeadings.filter((heading) => heading.position === "between_sections").length,
      unmatched: unmatchedHeadings.slice(0, 50),
    },
  };
}

export async function cachedRawJsonFiles(sourceDir, sourceId = null) {
  let directoryEntries;
  try {
    directoryEntries = await readdir(sourceDir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const identity = sourceId ?? sourceDir;
    throw new Error(`No cached source snapshot for ${identity}. Run node connector/orient_riksdagen.mjs --source ${identity}, then retry.`);
  }
  const files = directoryEntries
    .filter((file) => file.endsWith(".json") && file !== "index.json" && !file.endsWith("-index.json"))
    .sort();
  if (!files.length) {
    const identity = sourceId ?? sourceDir;
    throw new Error(`No cached source snapshot for ${identity}. Run node connector/orient_riksdagen.mjs --source ${identity}, then retry.`);
  }
  return files;
}

export async function latestRawJson(sourceDir, sourceId = null) {
  return (await cachedRawJsonFiles(sourceDir, sourceId)).at(-1);
}

export async function loadCachedDocument(cacheDir, sourceId, { rawFile: selectedRawFile = null } = {}) {
  if (selectedRawFile === null) {
    const { snapshot, ignoredSnapshots } = await newestValidCachedSnapshot(cacheDir, sourceId);
    if (!snapshot) {
      if (!ignoredSnapshots.length) {
        throw new Error(`No cached source snapshot for ${sourceId}. Run node connector/orient_riksdagen.mjs --source ${sourceId}, then retry.`);
      }
      throw new Error(`No valid cached source snapshot for ${sourceId}; skipped: ${ignoredSnapshots.join(", ")}.`);
    }
    return { ...snapshot, ignoredSnapshots };
  }
  const sourceDir = join(cacheDir, sourceId);
  const rawFile = selectedRawFile;
  if (rawFile.includes("/") || rawFile.includes("\\")
    || !rawFile.endsWith(".json") || rawFile === "index.json" || rawFile.endsWith("-index.json")) {
    throw new Error("Cached snapshot filename must be a JSON file in the source directory.");
  }
  const rawPath = join(sourceDir, rawFile);
  const payload = JSON.parse(await readFile(rawPath, "utf8"));
  const document = payload?.dokumentstatus?.dokument ?? payload?.dokument?.dokument ?? payload?.dokument;
  if (!document?.text) throw new Error(`Cached response has no consolidated text: ${rawPath}`);
  const sourceMatch = String(sourceId).match(/^sfs-(\d{4})-(\d+)$/);
  if (sourceMatch && document.beteckning !== `${sourceMatch[1]}:${sourceMatch[2]}`) {
    throw new Error(`Cached source identity does not match ${sourceId}: ${rawPath}`);
  }
  return { sourceDir, rawFile, rawPath, document };
}

export async function newestValidCachedSnapshot(cacheDir, sourceId) {
  let files;
  try {
    files = (await cachedRawJsonFiles(join(cacheDir, sourceId), sourceId)).reverse();
  } catch (error) {
    if (error.message.startsWith("No cached source snapshot for ")) {
      return { snapshot: null, ignoredSnapshots: [] };
    }
    throw error;
  }
  const ignoredSnapshots = [];
  for (const rawFile of files) {
    try {
      return {
        snapshot: await loadCachedDocument(cacheDir, sourceId, { rawFile }),
        ignoredSnapshots,
      };
    } catch (error) {
      if (error instanceof SyntaxError
        || error.message.startsWith("Cached response has no consolidated text:")
        || error.message.startsWith("Cached source identity does not match ")) {
        ignoredSnapshots.push(rawFile);
        continue;
      }
      throw error;
    }
  }
  return { snapshot: null, ignoredSnapshots };
}

export async function writeIndex(cacheDir, sourceId, { rawFile = null } = {}) {
  const cached = await loadCachedDocument(cacheDir, sourceId, { rawFile });
  const indexPath = join(cached.sourceDir, "index.json");
  try {
    const existing = JSON.parse(await readFile(indexPath, "utf8"));
    if (existing.index_version === INDEX_VERSION
      && existing.source_id === sourceId
      && existing.raw_file === cached.rawFile
      && existing.source_text_sha256 === sha256(String(cached.document.text ?? ""))
      && existing.source_html_sha256 === (cached.document.html ? sha256(cached.document.html) : null)) {
      return { ...cached, index: existing, indexPath, reused: true };
    }
  } catch {
    // No reusable index; build it below.
  }
  const index = buildIndex({ sourceId, document: cached.document, rawFile: cached.rawFile });
  await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  return { ...cached, index, indexPath, reused: false };
}
