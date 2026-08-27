import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { splitLinesWithOffsets } from "./text_lines.mjs";

const INDEX_VERSION = "0.6";

const TEMPORAL_MARKER_PATTERNS = [
  {
    pattern: /^\/Träder i kraft I:(.+)\/$/i,
    kind: "enters_on",
    marker_code: "I",
    target: "provision",
  },
  {
    pattern: /^\/Upphör att gälla U:(.+)\/$/i,
    kind: "ceases_on",
    marker_code: "U",
    target: "provision",
  },
  {
    pattern: /^\/Rubriken träder i kraft I:(.+)\/$/i,
    kind: "heading_enters_on",
    marker_code: "I",
    target: "heading",
  },
  {
    pattern: /^\/Rubriken upphör att gälla U:(.+)\/$/i,
    kind: "heading_ceases_on",
    marker_code: "U",
    target: "heading",
  },
];

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

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
      raw,
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

export function parseLocator(locator) {
  const value = String(locator).trim();
  const match = value.match(
    /^(\d+(?:\s+[a-z])?)\s*kap\.?\s*(\d+(?:\s+[a-z])?)\s*§\s*$/i,
  );
  if (match) {
    return {
      chapter: match[1].replace(/\s+/g, " ").toLowerCase(),
      section: match[2].replace(/\s+/g, " ").toLowerCase(),
      requested: locator,
    };
  }
  const sectionOnly = value.match(/^(\d+(?:\s+[a-z])?)\s*§\s*$/i);
  if (sectionOnly) {
    return {
      chapter: null,
      section: sectionOnly[1].replace(/\s+/g, " ").toLowerCase(),
      requested: locator,
    };
  }
  throw new Error(`Unsupported Swedish SFS locator: ${locator}`);
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

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
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
  const pattern = /<a\b([^>]*)>\s*<b>([^<]+)<\/b>/gi;
  for (const match of String(html ?? "").matchAll(pattern)) {
    const attributes = match[1];
    const className = htmlAttribute(attributes, "class");
    if (!className?.split(/\s+/).includes("paragraf")) continue;
    const name = htmlAttribute(attributes, "name");
    const identity = parseParagraphAnchorName(name ?? "");
    if (!identity) {
      anchors.push({ name, heading_text: decodeHtml(match[2]), identity: null });
      continue;
    }
    anchors.push({
      name,
      heading_text: decodeHtml(match[2]),
      ...identity,
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

function findStandaloneHeadingBeforeSection(lines, startLine, nextStartLine) {
  const i = nextStartLine - 2;
  if (i <= startLine) return null;
  const line = lines[i]?.trim() ?? "";
  const previousLine = lines[i - 1]?.trim() ?? "";
  const nextLine = lines[i + 1]?.trim() ?? "";
  if (line && previousLine === "" && nextLine === "") return i;
  return null;
}

function capabilityAssessment(document) {
  const anchors = parseHtmlParagraphAnchors(document.html);
  const textResult = findTextSectionCandidates(String(document.text ?? ""));
  const issues = [];
  if (!anchors.length) issues.push("No paragraph anchors were found in the HTML representation.");
  if (anchors.some((anchor) => !anchor.chapter && !anchor.section)) {
    issues.push("At least one paragraph anchor has an unrecognized name.");
  }
  if (anchors.length !== textResult.candidates.length) {
    issues.push(`HTML paragraph anchors (${anchors.length}) and text section candidates (${textResult.candidates.length}) differ.`);
  }
  const comparableCount = Math.min(anchors.length, textResult.candidates.length);
  for (let i = 0; i < comparableCount; i += 1) {
    const anchor = anchors[i];
    const candidate = textResult.candidates[i];
    if (anchor.chapter !== candidate.chapter || anchor.section !== candidate.section) {
      const anchorLocator = anchor.chapter ? `${anchor.chapter} kap. ${anchor.section} §` : `${anchor.section} §`;
      const candidateLocator = candidate.chapter ? `${candidate.chapter} kap. ${candidate.section} §` : `${candidate.section} §`;
      issues.push(`Locator order differs at position ${i + 1}: HTML ${anchorLocator}, text ${candidateLocator}.`);
      break;
    }
  }
  const sectionMarkers = textResult.candidates
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
    method: "html_paragraph_anchors_plus_text_section_candidates",
    html_anchor_count: anchors.length,
    text_candidate_count: textResult.candidates.length,
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
  };
}

export function buildIndex({ sourceId, document, rawFile }) {
  const text = String(document.text ?? "");
  const capability = capabilityAssessment(document);
  const lines = capability.textResult.lines;
  const lineOffsets = capability.textResult.lineOffsets;
  const candidates = capability.textResult.candidates;
  const sections = [];
  if (capability.status === "supported") {
    for (let i = 0; i < capability.anchors.length; i += 1) {
      const anchor = capability.anchors[i];
      const candidate = candidates[i];
      const nextCandidate = candidates[i + 1];
      const nextStartLine = nextCandidate?.start_line ?? lines.length;
      const headingLine = findStandaloneHeadingBeforeSection(
        lines,
        candidate.start_line,
        nextStartLine,
      );
      const endLine = headingLine ?? nextStartLine;
      const sectionText = lines.slice(candidate.start_line, endLine).join("\n").trim();
      sections.push({
        locator: anchor.chapter
          ? `${anchor.chapter} kap. ${candidate.section} §`
          : `${candidate.section} §`,
        anchor_name: anchor.name,
        chapter: anchor.chapter,
        chapter_title: null,
        section: candidate.section,
        heading_text: candidate.heading_text,
        temporal_marker: parseTemporalMarker(candidate.heading_text),
        start_line: candidate.start_line + 1,
        end_line_exclusive: endLine + 1,
        start_offset: candidate.start_offset,
        end_offset_exclusive: endLine < lines.length
          ? lineOffsets[endLine] ?? text.length
          : text.length,
        section_sha256: sha256(sectionText),
      });
    }
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
      issues: capability.issues,
      temporal: capability.temporal,
    },
    section_count: sections.length,
    sections,
  };
}

export async function latestRawJson(sourceDir, sourceId = null) {
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
  return files.at(-1);
}

export async function loadCachedDocument(cacheDir, sourceId) {
  const sourceDir = join(cacheDir, sourceId);
  const rawFile = await latestRawJson(sourceDir, sourceId);
  const rawPath = join(sourceDir, rawFile);
  const payload = JSON.parse(await readFile(rawPath, "utf8"));
  const document = payload?.dokumentstatus?.dokument ?? payload?.dokument?.dokument ?? payload?.dokument;
  if (!document?.text) throw new Error(`Cached response has no consolidated text: ${rawPath}`);
  return { sourceDir, rawFile, rawPath, document };
}

export async function writeIndex(cacheDir, sourceId) {
  const cached = await loadCachedDocument(cacheDir, sourceId);
  const indexPath = join(cached.sourceDir, "index.json");
  try {
    const existing = JSON.parse(await readFile(indexPath, "utf8"));
    if (existing.index_version === INDEX_VERSION
      && existing.source_id === sourceId
      && existing.raw_file === cached.rawFile
      && existing.source_text_sha256 === sha256(String(cached.document.text ?? ""))) {
      return { ...cached, index: existing, indexPath, reused: true };
    }
  } catch {
    // No reusable index; build it below.
  }
  const index = buildIndex({ sourceId, document: cached.document, rawFile: cached.rawFile });
  await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  return { ...cached, index, indexPath, reused: false };
}
