import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIndex,
  findTextSectionCandidates,
  parseHtmlParagraphAnchors,
  parseLocator,
  parseTemporalMarker,
  sha256,
} from "./sfs_index.mjs";
import { ensureDirectory, safeFileSegment } from "./runtime.mjs";

export const REVIEW_PROVIDER_ID = "riksdagen_open_data";
export const REVIEW_CONNECTOR_VERSION = "0.2.0";
export const REVIEW_ARTIFACT_SCHEMA_VERSION = "1.1.0";
export const REVIEW_DECISION_SCHEMA_VERSION = "1.1.0";
export const REVIEW_STORE_SCHEMA_VERSION = "1.0.0";
export const REVIEW_SIGNAL_VOCABULARY_VERSION = "1.0.0";

export const REVIEW_SIGNAL_KINDS = Object.freeze([
  "coverage_difference",
  "identity_order_difference",
  "text_only_candidate",
  "missing_text_candidate",
  "temporal_layer",
  "duplicate_publisher_identity",
  "renumbering_editorial_notice",
  "broken_boundary",
  "unclassified_structure",
]);

const DECISION_SCHEMA_ID = "sv_sfs_locator_review_decision";
const ARTIFACT_SCHEMA_ID = "sv_sfs_locator_review_artifact";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hashRecord(record, excludedField) {
  const copy = structuredClone(record);
  delete copy[excludedField];
  return sha256(canonicalJson(copy));
}

export function artifactHash(artifact) {
  return hashRecord(artifact, "artifact_sha256");
}

export function decisionRecordHash(decision) {
  return hashRecord(decision, "decision_record_sha256");
}

export function finalizeReviewDecision(decision) {
  const completed = structuredClone(decision);
  completed.decision_record_sha256 = decisionRecordHash(completed);
  return completed;
}

function canonicalLocator(parsed) {
  return parsed.chapter
    ? `${parsed.chapter} kap. ${parsed.section} §`
    : `${parsed.section} §`;
}

function sameIdentity(item, parsed) {
  return item?.chapter === parsed.chapter && item?.section === parsed.section;
}

function lineBoundaryBeforeNextSection(lines, startLine, nextStartLine) {
  const candidate = nextStartLine - 2;
  if (candidate <= startLine) return nextStartLine;
  const line = lines[candidate]?.trim() ?? "";
  const previousLine = lines[candidate - 1]?.trim() ?? "";
  const nextLine = lines[candidate + 1]?.trim() ?? "";
  return line && previousLine === "" && nextLine === "" ? candidate : nextStartLine;
}

function sourceExcerpt(lines, firstLine, lastLineExclusive) {
  const first = Math.max(0, firstLine);
  const last = Math.min(lines.length, lastLineExclusive);
  return lines.slice(first, last).map((text, position) => ({
    line: first + position + 1,
    text,
  }));
}

function decisionReadingView({
  canonical,
  textResult,
  target,
  endLine,
  startOffset,
  endOffset,
  nextCandidate,
  nextAnchor,
  provisionText,
  sameLocatorCandidates,
  interveningCandidates,
  anchorName,
  offsetUnit,
}) {
  const nextStartLine = nextCandidate ? nextCandidate.candidate.start_line + 1 : null;
  const sourceEnd = nextCandidate
    ? nextCandidate.candidate.start_line + 3
    : Math.min(textResult.lines.length, endLine + 3);
  return {
    label: canonical,
    evidence_status: "proposed_locator_boundary",
    anchor_name: anchorName,
    start_line: target.candidate.start_line + 1,
    end_line_exclusive: endLine + 1,
    next_start_line: nextStartLine,
    next_locator: nextAnchor
      ? `${nextAnchor.chapter ? `${nextAnchor.chapter} kap. ` : ""}${nextAnchor.section} §`
      : null,
    next_anchor_name: nextAnchor?.name ?? null,
    source_offsets: {
      start: startOffset,
      end_exclusive: endOffset,
      unit: offsetUnit,
    },
    source_text: provisionText,
    source_text_sha256: sha256(provisionText),
    source_lines: sourceExcerpt(textResult.lines, target.candidate.start_line, sourceEnd),
    flagged_lines: interveningCandidates
      .map((candidate) => ({
        line: candidate.start_line,
        label: sameLocatorCandidates.some((same) => same.start_line === candidate.start_line)
          ? "Same-number text; no anchor"
          : "Heading-like text; no anchor",
      })),
    temporal_marker: null,
    same_locator_next: false,
  };
}

function indexedReadingViews(index, textResult, parsed) {
  const matchingSections = index.sections
    .map((section, position) => ({ section, position }))
    .filter(({ section }) => sameIdentity(section, parsed));
  return matchingSections.map(({ section, position }, matchPosition) => {
    const nextSection = index.sections[position + 1] ?? null;
    const startLineIndex = section.start_line - 1;
    const endLineIndex = section.end_line_exclusive - 1;
    const sourceEnd = nextSection
      ? Math.min(textResult.lines.length, nextSection.start_line + 2)
      : Math.min(textResult.lines.length, endLineIndex + 3);
    const sourceText = textResult.lines.slice(startLineIndex, endLineIndex).join("\n").trim();
    const editorialNotice = /\b(?:ny|tidigare) beteckning\b/i.test(section.heading_text);
    const sameLocatorNext = Boolean(nextSection && sameIdentity(nextSection, parsed));
    const startLabel = section.temporal_marker?.kind === "ceases_on"
      ? "Outgoing version (U)"
      : section.temporal_marker?.kind === "enters_on"
        ? "Incoming version (I)"
        : editorialNotice
          ? "Editorial renumbering notice"
          : matchingSections.length > 1
            ? "Substantive same-locator candidate"
            : null;
    return {
      label: matchingSections.length > 1
        ? `${section.locator} · candidate ${matchPosition + 1}`
        : section.locator,
      evidence_status: "unselected_source_candidate",
      anchor_name: section.anchor_name,
      start_line: section.start_line,
      end_line_exclusive: section.end_line_exclusive,
      next_start_line: nextSection?.start_line ?? null,
      next_locator: nextSection?.locator ?? null,
      next_anchor_name: nextSection?.anchor_name ?? null,
      source_offsets: {
        start: section.start_offset,
        end_exclusive: section.end_offset_exclusive,
        unit: index.offset_unit,
      },
      source_text: sourceText,
      source_text_sha256: section.section_sha256,
      source_lines: sourceExcerpt(textResult.lines, startLineIndex, sourceEnd),
      flagged_lines: startLabel ? [{ line: section.start_line, label: startLabel }] : [],
      temporal_marker: section.temporal_marker,
      same_locator_next: sameLocatorNext,
    };
  });
}

function provisionalTextReadingViews(index, textResult, candidateMatches, rawText, anchorMatches) {
  return candidateMatches.flatMap(({ candidate, position }) => {
    const nextCandidate = textResult.candidates[position + 1];
    if (nextCandidate && nextCandidate.start_line <= candidate.start_line) return [];
    const endOffset = nextCandidate
      ? textResult.lineOffsets[nextCandidate.start_line]
      : rawText.length;
    const sourceText = rawText.slice(candidate.start_offset, endOffset);
    const nextLocator = nextCandidate
      ? nextCandidate.chapter
        ? `${nextCandidate.chapter} kap. ${nextCandidate.section} §`
        : `${nextCandidate.section} §`
      : null;
    const unanchored = anchorMatches.length === 0;
    return [{
      label: candidate.chapter
        ? `${candidate.chapter} kap. ${candidate.section} §`
        : `${candidate.section} §`,
      evidence_status: unanchored ? "unanchored_text_candidate" : "provisional_text_candidate",
      anchor_name: null,
      start_line: candidate.start_line + 1,
      end_line_exclusive: nextCandidate ? nextCandidate.start_line + 1 : textResult.lines.length + 1,
      next_start_line: nextCandidate ? nextCandidate.start_line + 1 : null,
      next_locator: nextLocator,
      next_anchor_name: null,
      excerpt_boundary_basis: nextCandidate ? "next_text_heading" : "end_of_source",
      source_offsets: {
        start: candidate.start_offset,
        end_exclusive: endOffset,
        unit: index.offset_unit,
      },
      source_text: sourceText,
      source_text_sha256: sha256(sourceText),
      source_lines: sourceExcerpt(textResult.lines, candidate.start_line,
        nextCandidate ? nextCandidate.start_line + 3 : textResult.lines.length),
      flagged_lines: [{ line: candidate.start_line + 1, label: unanchored ? "Text heading; no matching anchor" : "Text candidate; pairing unverified" }],
      temporal_marker: parseTemporalMarker(candidate.heading_text),
      same_locator_next: Boolean(nextCandidate && sameIdentity(nextCandidate, candidate)),
    }];
  });
}

function publicCandidate(candidate, position) {
  return {
    position: position + 1,
    chapter: candidate.chapter,
    section: candidate.section,
    heading_text: candidate.heading_text,
    start_line: candidate.start_line + 1,
    start_offset: candidate.start_offset,
    temporal_marker: parseTemporalMarker(candidate.heading_text),
  };
}

function publicAnchor(anchor, position) {
  if (!anchor) return null;
  return {
    position: position + 1,
    name: anchor.name,
    chapter: anchor.chapter,
    section: anchor.section,
    heading_text: anchor.heading_text,
    source_markup: anchor.source_markup,
  };
}

function reviewSignal({ kind, scope, severity, evidence, meaning, connectorResponse, blocksDecision }) {
  if (!REVIEW_SIGNAL_KINDS.includes(kind)) throw new Error(`Unsupported review signal kind: ${kind}`);
  return {
    kind,
    scope,
    severity,
    evidence,
    meaning,
    connector_response: connectorResponse,
    blocks_decision: blocksDecision,
  };
}

function sourceSignals(index) {
  const signals = [];
  const countDifference = index.capability.text_candidate_count - index.capability.html_anchor_count;
  if (countDifference !== 0) {
    signals.push(reviewSignal({
      kind: "coverage_difference",
      scope: "source",
      severity: "warning",
      evidence: {
        summary: `${index.capability.html_anchor_count} publisher anchors and ${index.capability.text_candidate_count} text candidates`,
        values: {
          publisher_anchor_count: index.capability.html_anchor_count,
          text_candidate_count: index.capability.text_candidate_count,
          difference: countDifference,
        },
      },
      meaning: countDifference > 0
        ? `The text parser found ${countDifference} more heading-like items than the publisher supplied as anchors.`
        : `The publisher supplied ${Math.abs(countDifference)} more anchors than the text parser found as heading-like items.`,
      connectorResponse: "Automatic source support remains withheld. A locator decision is available only if both local boundaries can still be reproduced.",
      blocksDecision: false,
    }));
  }
  const sequenceIssue = index.capability.issues.find((issue) => issue.includes("Locator order differs"));
  if (sequenceIssue) {
    signals.push(reviewSignal({
      kind: "identity_order_difference",
      scope: "source",
      severity: "warning",
      evidence: { summary: sequenceIssue, values: {} },
      meaning: "The publisher and plain-text representations stop naming provisions in the same sequence.",
      connectorResponse: "The discrepancy stays visible. Equal counts or a local review never erase this source-wide warning.",
      blocksDecision: false,
    }));
  }
  return signals;
}

function baseArtifact({ sourceId, requestedLocator, document, rawFile, preparedAt, index }) {
  const parsed = parseLocator(requestedLocator);
  return {
    artifact_schema: ARTIFACT_SCHEMA_ID,
    artifact_schema_version: REVIEW_ARTIFACT_SCHEMA_VERSION,
    review_signal_vocabulary_version: REVIEW_SIGNAL_VOCABULARY_VERSION,
    prepared_at: preparedAt,
    review_scope: "locator",
    source: {
      provider_id: REVIEW_PROVIDER_ID,
      authority_id: sourceId,
      sfs_number: document.beteckning,
      title: document.titel ?? null,
      source_snapshot: rawFile,
      source_text_sha256: index.source_text_sha256,
      source_html_sha256: index.source_html_sha256,
    },
    implementation: {
      connector_review_version: REVIEW_CONNECTOR_VERSION,
      index_version: index.index_version,
      artifact_schema_version: REVIEW_ARTIFACT_SCHEMA_VERSION,
      decision_schema_version: REVIEW_DECISION_SCHEMA_VERSION,
    },
    automatic_capability: index.capability,
    locator: {
      requested: requestedLocator,
      canonical: canonicalLocator(parsed),
      chapter: parsed.chapter,
      section: parsed.section,
    },
  };
}

function chooseTargetCandidate({ anchors, candidates, anchorPosition, parsed }) {
  const matches = candidates
    .map((candidate, position) => ({ candidate, position }))
    .filter(({ candidate }) => sameIdentity(candidate, parsed));
  if (!matches.length) {
    throw new Error("The requested publisher anchor has no matching text candidate. Leave the review unresolved.");
  }
  if (matches.some(({ candidate }) => parseTemporalMarker(candidate.heading_text))) {
    throw new Error("The requested locator has an I:/U: marked text candidate. Structural review cannot select a temporal version.");
  }
  if (matches.length === 1) {
    return { ...matches[0], selectionEvidence: "unique_locator_candidate" };
  }
  const aligned = matches.filter(({ position }) => position === anchorPosition);
  const prefixAligned = aligned.length === 1 && anchors
    .slice(0, anchorPosition + 1)
    .every((anchor, position) => sameIdentity(candidates[position], anchor));
  if (prefixAligned) {
    return { ...aligned[0], selectionEvidence: "publisher_and_text_prefix_aligned_through_target" };
  }
  throw new Error("The requested locator has multiple unresolved text candidates. A locator review cannot choose between them automatically.");
}

function findNeighbourCandidate(candidates, anchor, directionStart, direction) {
  if (!anchor) return null;
  if (direction > 0) {
    for (let position = directionStart; position < candidates.length; position += 1) {
      if (sameIdentity(candidates[position], anchor)) return { candidate: candidates[position], position };
    }
  } else {
    for (let position = directionStart; position >= 0; position -= 1) {
      if (sameIdentity(candidates[position], anchor)) return { candidate: candidates[position], position };
    }
  }
  return null;
}

export function prepareLocatorReview({ sourceId, requestedLocator, document, rawFile, preparedAt = new Date().toISOString() }) {
  const index = buildIndex({ sourceId, document, rawFile });
  if (index.capability.status !== "review_required") {
    throw new Error(`Locator review requires automatic capability review_required; received ${index.capability.status}.`);
  }
  if (!index.source_html_sha256) throw new Error("Locator review requires a hashed HTML snapshot.");

  const parsed = parseLocator(requestedLocator);
  const canonical = canonicalLocator(parsed);
  const anchors = parseHtmlParagraphAnchors(document.html);
  const textResult = findTextSectionCandidates(String(document.text ?? ""));
  const anchorMatches = anchors
    .map((anchor, position) => ({ anchor, position }))
    .filter(({ anchor }) => sameIdentity(anchor, parsed));
  if (anchorMatches.length !== 1) {
    throw new Error(`The requested locator must identify exactly one publisher anchor; found ${anchorMatches.length}.`);
  }

  const targetAnchor = anchorMatches[0];
  const target = chooseTargetCandidate({
    anchors,
    candidates: textResult.candidates,
    anchorPosition: targetAnchor.position,
    parsed,
  });
  const previousAnchor = anchors[targetAnchor.position - 1] ?? null;
  const nextAnchor = anchors[targetAnchor.position + 1] ?? null;
  const previousCandidate = findNeighbourCandidate(
    textResult.candidates,
    previousAnchor,
    target.position - 1,
    -1,
  );
  const nextCandidate = findNeighbourCandidate(
    textResult.candidates,
    nextAnchor,
    target.position + 1,
    1,
  );
  if (previousAnchor && !previousCandidate) {
    throw new Error("The previous publisher anchor has no preceding text candidate; the target boundary is unresolved.");
  }
  if (nextAnchor && !nextCandidate) {
    throw new Error("The next publisher anchor has no following text candidate; the target boundary is unresolved.");
  }

  const endLine = nextCandidate
    ? lineBoundaryBeforeNextSection(textResult.lines, target.candidate.start_line, nextCandidate.candidate.start_line)
    : textResult.lines.length;
  const startOffset = target.candidate.start_offset;
  const endOffset = endLine < textResult.lines.length
    ? textResult.lineOffsets[endLine] ?? String(document.text ?? "").length
    : String(document.text ?? "").length;
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset >= endOffset) {
    throw new Error("The proposed source offsets are not an increasing provision boundary.");
  }
  const provisionText = String(document.text ?? "")
    .slice(startOffset, endOffset)
    .replace(/\r\n|\r/g, "\n")
    .trim();
  const temporalMarkers = textResult.lines
    .slice(target.candidate.start_line, endLine)
    .map((line) => parseTemporalMarker(line))
    .filter(Boolean);
  if (temporalMarkers.length) {
    throw new Error("The proposed provision boundary contains I:/U: timing markers. Structural review cannot resolve or select it.");
  }

  const sameLocatorCandidates = textResult.candidates
    .map((candidate, position) => ({ candidate, position }))
    .filter(({ candidate }) => sameIdentity(candidate, parsed))
    .map(({ candidate, position }) => publicCandidate(candidate, position));
  const interveningTextCandidates = nextCandidate
    ? textResult.candidates
      .slice(target.position + 1, nextCandidate.position)
      .map((candidate, position) => publicCandidate(candidate, target.position + 1 + position))
    : [];
  const reviewSignals = sourceSignals(index);
  if (sameLocatorCandidates.length > 1) {
    reviewSignals.push(reviewSignal({
      kind: "text_only_candidate",
      scope: "locator",
      severity: "warning",
      evidence: {
        summary: `${sameLocatorCandidates.length} plain-text candidates look like ${canonical}`,
        values: { candidates: sameLocatorCandidates },
      },
      meaning: "The text contains more than one heading-like occurrence for this locator, but only one is paired with the publisher anchor at the proposed start.",
      connectorResponse: "The candidates are shown together. The decision can confirm only the publisher-matched start and its reproduced boundary.",
      blocksDecision: false,
    }));
  }
  if (index.capability.temporal?.status === "layered_unresolved") {
    const markerCount = (index.capability.temporal.section_marker_count ?? 0)
      + (index.capability.temporal.heading_marker_count ?? 0);
    reviewSignals.push(reviewSignal({
      kind: "temporal_layer",
      scope: "source",
      severity: "information",
      evidence: {
        summary: `${markerCount} I:/U: markers elsewhere in the source; none on ${canonical}`,
        values: { source_marker_count: markerCount, target_marker_count: 0 },
      },
      meaning: "The source contains version transitions elsewhere, while this exact locator is unmarked in the reviewed boundary.",
      connectorResponse: "This structural review records no date-aware selection. A marked target would receive explanation only.",
      blocksDecision: false,
    }));
  }

  const artifact = {
    ...baseArtifact({ sourceId, requestedLocator, document, rawFile, preparedAt, index }),
    review_disposition: {
      status: "decision_available",
      decision_allowed: true,
      reason_codes: ["structural_locator_boundary_reproducible"],
      summary: `The connector can reproduce one exact publisher anchor and both boundaries for ${canonical}.`,
    },
    review_signals: reviewSignals,
    publisher_anchor: publicAnchor(targetAnchor.anchor, targetAnchor.position),
    boundary: {
      selection_evidence: target.selectionEvidence,
      start_line: target.candidate.start_line + 1,
      end_line_exclusive: endLine + 1,
      source_offsets: {
        start: startOffset,
        end_exclusive: endOffset,
        unit: index.offset_unit,
      },
      previous_publisher_anchor: publicAnchor(previousAnchor, targetAnchor.position - 1),
      next_publisher_anchor: publicAnchor(nextAnchor, targetAnchor.position + 1),
    },
    provision_text: provisionText,
    provision_text_sha256: sha256(provisionText),
    temporal: {
      capability_status: index.capability.temporal?.status ?? "flat",
      resolution: index.capability.temporal?.status === "layered_unresolved"
        ? "unmarked_locator"
        : "not_applicable",
      markers: [],
      note: "This structural review records no date-aware version selection and does not decide legal effect.",
    },
    review_context: {
      target_candidate: publicCandidate(target.candidate, target.position),
      next_publisher_candidate: nextCandidate
        ? publicCandidate(nextCandidate.candidate, nextCandidate.position)
        : null,
      intervening_text_candidates: interveningTextCandidates,
      same_locator_candidates: sameLocatorCandidates,
      preceding_context: sourceExcerpt(textResult.lines, target.candidate.start_line - 4, target.candidate.start_line + 2),
      following_boundary_context: sourceExcerpt(textResult.lines, endLine - 2, endLine + 4),
      reading_views: [decisionReadingView({
        canonical,
        textResult,
        target,
        endLine,
        startOffset,
        endOffset,
        nextCandidate,
        nextAnchor,
        provisionText,
        sameLocatorCandidates,
        interveningCandidates: interveningTextCandidates,
        anchorName: targetAnchor.anchor.name,
        offsetUnit: index.offset_unit,
      })],
    },
    artifact_sha256: null,
  };
  artifact.artifact_sha256 = artifactHash(artifact);
  return artifact;
}

function explanationContext(textResult, candidateMatches) {
  const lines = [];
  const seen = new Set();
  for (const { candidate } of candidateMatches) {
    for (const item of sourceExcerpt(textResult.lines, candidate.start_line - 2, candidate.start_line + 4)) {
      if (seen.has(item.line)) continue;
      seen.add(item.line);
      lines.push(item);
    }
  }
  return lines.sort((left, right) => left.line - right.line);
}

function explanationArtifact({
  sourceId,
  requestedLocator,
  document,
  rawFile,
  preparedAt,
  index,
  status,
  reasonCodes,
  summary,
  signals,
}) {
  const parsed = parseLocator(requestedLocator);
  const anchors = parseHtmlParagraphAnchors(document.html);
  const textResult = findTextSectionCandidates(String(document.text ?? ""));
  const anchorMatches = anchors
    .map((anchor, position) => ({ anchor, position }))
    .filter(({ anchor }) => sameIdentity(anchor, parsed));
  const candidateMatches = textResult.candidates
    .map((candidate, position) => ({ candidate, position }))
    .filter(({ candidate }) => sameIdentity(candidate, parsed));
  const anchoredReadingViews = indexedReadingViews(index, textResult, parsed);
  const artifact = {
    ...baseArtifact({ sourceId, requestedLocator, document, rawFile, preparedAt, index }),
    review_disposition: {
      status,
      decision_allowed: false,
      reason_codes: reasonCodes,
      summary,
    },
    review_signals: [...sourceSignals(index), ...signals],
    explanation_context: {
      matching_publisher_anchors: anchorMatches.map(({ anchor, position }) => publicAnchor(anchor, position)),
      matching_text_candidates: candidateMatches.map(({ candidate, position }) => publicCandidate(candidate, position)),
      source_context: explanationContext(textResult, candidateMatches),
      reading_views: anchoredReadingViews.length
        ? anchoredReadingViews
        : provisionalTextReadingViews(index, textResult, candidateMatches, String(document.text ?? ""), anchorMatches),
    },
    artifact_sha256: null,
  };
  artifact.artifact_sha256 = artifactHash(artifact);
  return artifact;
}

export function prepareLocatorReviewSurface({
  sourceId,
  requestedLocator,
  document,
  rawFile,
  preparedAt = new Date().toISOString(),
}) {
  const index = buildIndex({ sourceId, document, rawFile });
  if (!index.source_html_sha256) {
    return explanationArtifact({
      sourceId,
      requestedLocator,
      document,
      rawFile,
      preparedAt,
      index,
      status: "unsupported_pattern",
      reasonCodes: ["html_snapshot_unavailable"],
      summary: "The publisher HTML snapshot is unavailable, so the connector cannot establish independent structural evidence.",
      signals: [reviewSignal({
        kind: "unclassified_structure",
        scope: "source",
        severity: "blocking",
        evidence: { summary: "No hashed publisher HTML representation is available", values: {} },
        meaning: "The plain text cannot be independently checked against publisher paragraph anchors.",
        connectorResponse: "No decision controls are shown. Retrieval remains blocked until a complete source snapshot is available.",
        blocksDecision: true,
      })],
    });
  }

  if (index.capability.status === "review_required") {
    try {
      return prepareLocatorReview({ sourceId, requestedLocator, document, rawFile, preparedAt });
    } catch (error) {
      const parsed = parseLocator(requestedLocator);
      const anchors = parseHtmlParagraphAnchors(document.html);
      const textResult = findTextSectionCandidates(String(document.text ?? ""));
      const anchorMatches = anchors.filter((anchor) => sameIdentity(anchor, parsed));
      const candidateMatches = textResult.candidates.filter((candidate) => sameIdentity(candidate, parsed));
      const temporalMarkers = candidateMatches.map((candidate) => parseTemporalMarker(candidate.heading_text)).filter(Boolean);
      if (temporalMarkers.length) {
        return prepareTemporalExplanation({
          sourceId, requestedLocator, document, rawFile, preparedAt, index,
          anchorMatches, candidateMatches, temporalMarkers,
        });
      }
      const kind = error.message.includes("publisher anchor has no")
        || error.message.includes("boundary is unresolved")
        ? "broken_boundary"
        : candidateMatches.length === 0
          ? "missing_text_candidate"
          : "unclassified_structure";
      return explanationArtifact({
        sourceId,
        requestedLocator,
        document,
        rawFile,
        preparedAt,
        index,
        status: "unsupported_pattern",
        reasonCodes: [kind],
        summary: "The connector cannot reproduce a safe locator boundary for this structural pattern.",
        signals: [reviewSignal({
          kind,
          scope: "boundary",
          severity: "blocking",
          evidence: { summary: error.message, values: { publisher_anchor_matches: anchorMatches.length, text_candidate_matches: candidateMatches.length } },
          meaning: "The evidence needed to identify one exact start and end boundary is incomplete or unfamiliar.",
          connectorResponse: "No decision controls are shown. The pattern needs connector support before a human decision can be accepted.",
          blocksDecision: true,
        })],
      });
    }
  }

  const parsed = parseLocator(requestedLocator);
  const anchors = parseHtmlParagraphAnchors(document.html);
  const textResult = findTextSectionCandidates(String(document.text ?? ""));
  const anchorMatches = anchors.filter((anchor) => sameIdentity(anchor, parsed));
  const candidateMatches = textResult.candidates.filter((candidate) => sameIdentity(candidate, parsed));
  const temporalMarkers = candidateMatches.map((candidate) => parseTemporalMarker(candidate.heading_text)).filter(Boolean);
  if (temporalMarkers.length) {
    return prepareTemporalExplanation({
      sourceId, requestedLocator, document, rawFile, preparedAt, index,
      anchorMatches, candidateMatches, temporalMarkers,
    });
  }

  const renumberingCandidates = candidateMatches.filter((candidate) => /\b(?:ny|tidigare) beteckning\b/i.test(candidate.heading_text));
  if (anchorMatches.length > 1 || candidateMatches.length > 1) {
    const signals = [reviewSignal({
      kind: "duplicate_publisher_identity",
      scope: "locator",
      severity: "blocking",
      evidence: {
        summary: `${anchorMatches.length} publisher anchors and ${candidateMatches.length} text candidates use the same locator`,
        values: { publisher_anchor_count: anchorMatches.length, text_candidate_count: candidateMatches.length },
      },
      meaning: "The publisher itself presents more than one passage under this legal address, so structural alignment does not identify a single operative provision.",
      connectorResponse: "No structural decision is available. The connector keeps the lookup ambiguous rather than choosing a passage.",
      blocksDecision: true,
    })];
    if (renumberingCandidates.length) {
      signals.push(reviewSignal({
        kind: "renumbering_editorial_notice",
        scope: "locator",
        severity: "blocking",
        evidence: {
          summary: renumberingCandidates.map((candidate) => candidate.heading_text).join(" | "),
          values: { notices: renumberingCandidates.map((candidate) => candidate.heading_text) },
        },
        meaning: "One same-numbered passage is an editorial renumbering notice rather than ordinary provision text.",
        connectorResponse: "The connector does not infer current legal effect from the notice. Explicit renumbering support is required.",
        blocksDecision: true,
      }));
    }
    return explanationArtifact({
      sourceId,
      requestedLocator,
      document,
      rawFile,
      preparedAt,
      index,
      status: renumberingCandidates.length ? "explanation_only" : "unsupported_pattern",
      reasonCodes: [renumberingCandidates.length ? "editorial_renumbering_requires_support" : "duplicate_publisher_identity"],
      summary: renumberingCandidates.length
        ? "The publisher shows both a renumbering notice and another passage under this locator. Structural review cannot decide legal currency."
        : "More than one publisher-backed passage uses this locator, and the connector has no safe selection rule.",
      signals,
    });
  }

  if (index.capability.status === "supported" && anchorMatches.length === 1 && candidateMatches.length === 1) {
    throw new Error(`No review surface is needed for ${canonicalLocator(parsed)}; automatic structural capability supports this unique unmarked locator.`);
  }

  return explanationArtifact({
    sourceId,
    requestedLocator,
    document,
    rawFile,
    preparedAt,
    index,
    status: "unsupported_pattern",
    reasonCodes: ["unclassified_structure"],
    summary: "The lookup is blocked by a source shape that the current review vocabulary cannot safely classify.",
    signals: [reviewSignal({
      kind: "unclassified_structure",
      scope: "locator",
      severity: "blocking",
      evidence: { summary: `${anchorMatches.length} matching anchors; ${candidateMatches.length} matching text candidates`, values: {} },
      meaning: "The connector has insufficient tested evidence to describe or resolve this pattern.",
      connectorResponse: "No decision controls are shown. Preserve the evidence and add a specific parser or review rule before retrying.",
      blocksDecision: true,
    })],
  });
}

function prepareTemporalExplanation({
  sourceId,
  requestedLocator,
  document,
  rawFile,
  preparedAt,
  index,
  anchorMatches,
  candidateMatches,
  temporalMarkers,
}) {
  const parsed = parseLocator(requestedLocator);
  return explanationArtifact({
    sourceId,
    requestedLocator,
    document,
    rawFile,
    preparedAt,
    index,
    status: "explanation_only",
    reasonCodes: ["temporal_selection_required"],
    summary: `${canonicalLocator(parsed)} has publisher transition markers. Choosing a version requires date-aware selection, not structural review.`,
    signals: [reviewSignal({
      kind: "temporal_layer",
      scope: "locator",
      severity: "blocking",
      evidence: {
        summary: `${candidateMatches.length} matching text candidates with ${temporalMarkers.length} I:/U: markers`,
        values: {
          publisher_anchor_count: anchorMatches.length,
          text_candidate_count: candidateMatches.length,
          markers: temporalMarkers,
        },
      },
      meaning: "The source presents an entering or ceasing version for this exact locator. Matching structure cannot answer which version governs a requested date.",
      connectorResponse: "No confirmation controls are shown. The lookup remains unresolved until a separately tested date-aware selection capability is used.",
      blocksDecision: true,
    })],
  });
}

export function createDecisionTemplate(artifact) {
  if (artifact?.review_disposition?.status !== "decision_available"
    || artifact?.review_disposition?.decision_allowed !== true) {
    throw new Error("A decision template can be created only for a decision_available locator artifact.");
  }
  return {
    schema_id: DECISION_SCHEMA_ID,
    schema_version: REVIEW_DECISION_SCHEMA_VERSION,
    decision_status: "unresolved",
    review_scope: "locator",
    artifact_sha256: artifact.artifact_sha256,
    source: {
      provider_id: artifact.source.provider_id,
      authority_id: artifact.source.authority_id,
      sfs_number: artifact.source.sfs_number,
      source_snapshot: artifact.source.source_snapshot,
      source_text_sha256: artifact.source.source_text_sha256,
      source_html_sha256: artifact.source.source_html_sha256,
    },
    implementation: structuredClone(artifact.implementation),
    locator: {
      requested: artifact.locator.requested,
      canonical: artifact.locator.canonical,
    },
    publisher_anchor: { name: artifact.publisher_anchor.name },
    source_offsets: structuredClone(artifact.boundary.source_offsets),
    provision_text_sha256: artifact.provision_text_sha256,
    temporal: {
      capability_status: artifact.temporal.capability_status,
      resolution: artifact.temporal.resolution,
      markers: [],
    },
    reviewer: {
      label: "",
      reviewed_at: "",
      rationale: "",
    },
    decision_record_sha256: null,
  };
}

function requireExactKeys(value, keys, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  const expected = new Set(keys);
  for (const key of keys) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required.`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${path}.${key} is not allowed.`);
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function validateReviewDecision({ artifact, decision, sourceId, document, rawFile }) {
  const errors = [];
  requireExactKeys(decision, [
    "schema_id", "schema_version", "decision_status", "review_scope", "artifact_sha256",
    "source", "implementation", "locator", "publisher_anchor", "source_offsets",
    "provision_text_sha256", "temporal", "reviewer", "decision_record_sha256",
  ], "decision", errors);
  requireExactKeys(decision?.source, [
    "provider_id", "authority_id", "sfs_number", "source_snapshot", "source_text_sha256", "source_html_sha256",
  ], "decision.source", errors);
  requireExactKeys(decision?.implementation, [
    "connector_review_version", "index_version", "artifact_schema_version", "decision_schema_version",
  ], "decision.implementation", errors);
  requireExactKeys(decision?.locator, ["requested", "canonical"], "decision.locator", errors);
  requireExactKeys(decision?.publisher_anchor, ["name"], "decision.publisher_anchor", errors);
  requireExactKeys(decision?.source_offsets, ["start", "end_exclusive", "unit"], "decision.source_offsets", errors);
  requireExactKeys(decision?.temporal, ["capability_status", "resolution", "markers"], "decision.temporal", errors);
  requireExactKeys(decision?.reviewer, ["label", "reviewed_at", "rationale"], "decision.reviewer", errors);

  if (artifact?.artifact_schema !== ARTIFACT_SCHEMA_ID
    || artifact?.artifact_schema_version !== REVIEW_ARTIFACT_SCHEMA_VERSION) {
    errors.push("The review artifact schema or version is unsupported.");
  }
  if (artifact?.review_signal_vocabulary_version !== REVIEW_SIGNAL_VOCABULARY_VERSION
    || !Array.isArray(artifact?.review_signals)
    || artifact.review_signals.some((signal) => !REVIEW_SIGNAL_KINDS.includes(signal?.kind))) {
    errors.push("The review signal vocabulary or one of its signal kinds is unsupported.");
  }
  if (artifact?.review_disposition?.status !== "decision_available"
    || artifact?.review_disposition?.decision_allowed !== true
    || artifact?.review_signals?.some((signal) => signal?.blocks_decision === true)) {
    errors.push("This artifact does not permit a locator decision.");
  }
  if (artifact?.artifact_sha256 !== artifactHash(artifact)) errors.push("The review artifact hash does not match its content.");
  if (decision?.schema_id !== DECISION_SCHEMA_ID || decision?.schema_version !== REVIEW_DECISION_SCHEMA_VERSION) {
    errors.push("The decision schema or version is unsupported.");
  }
  if (decision?.decision_status !== "confirmed") errors.push("Only a completed confirmed decision can be imported.");
  if (decision?.review_scope !== "locator") errors.push("Only locator-scoped review is implemented; source-wide scope is rejected.");
  if (decision?.artifact_sha256 !== artifact?.artifact_sha256) errors.push("The decision is not bound to this review artifact.");
  if (!sameJson(decision?.source, artifact?.source && {
    provider_id: artifact.source.provider_id,
    authority_id: artifact.source.authority_id,
    sfs_number: artifact.source.sfs_number,
    source_snapshot: artifact.source.source_snapshot,
    source_text_sha256: artifact.source.source_text_sha256,
    source_html_sha256: artifact.source.source_html_sha256,
  })) errors.push("The decision source identity or snapshot hashes differ from the artifact.");
  if (!sameJson(decision?.implementation, artifact?.implementation)) errors.push("The decision implementation or schema versions differ from the artifact.");
  if (!sameJson(decision?.locator, artifact?.locator && {
    requested: artifact.locator.requested,
    canonical: artifact.locator.canonical,
  })) errors.push("The decision requested or canonical locator differs from the artifact.");
  if (decision?.publisher_anchor?.name !== artifact?.publisher_anchor?.name) errors.push("The decision publisher anchor differs from the artifact.");
  if (!sameJson(decision?.source_offsets, artifact?.boundary?.source_offsets)) errors.push("The decision source offsets differ from the reviewed boundary.");
  if (decision?.provision_text_sha256 !== artifact?.provision_text_sha256) errors.push("The decision provision-text hash differs from the artifact.");
  const artifactTemporal = artifact?.temporal && {
    capability_status: artifact.temporal.capability_status,
    resolution: artifact.temporal.resolution,
    markers: artifact.temporal.markers,
  };
  if (!sameJson(decision?.temporal, artifactTemporal) || decision?.temporal?.markers?.length) {
    errors.push("The decision temporal state is inconsistent or attempts to resolve a marked version.");
  }
  if (typeof decision?.reviewer?.label !== "string" || !decision.reviewer.label.trim()) errors.push("A reviewer label is required.");
  if (typeof decision?.reviewer?.rationale !== "string" || !decision.reviewer.rationale.trim()) errors.push("A review rationale is required.");
  if (typeof decision?.reviewer?.reviewed_at !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(decision.reviewer.reviewed_at)
    || Number.isNaN(Date.parse(decision.reviewer.reviewed_at))) {
    errors.push("reviewer.reviewed_at must be an ISO 8601 UTC date-time.");
  }
  if (!/^[0-9a-f]{64}$/.test(String(decision?.decision_record_sha256 ?? ""))
    || decision?.decision_record_sha256 !== decisionRecordHash(decision)) {
    errors.push("The decision-record hash does not match the completed decision.");
  }

  let currentArtifact = null;
  try {
    currentArtifact = prepareLocatorReview({
      sourceId,
      requestedLocator: artifact?.locator?.requested,
      document,
      rawFile,
      preparedAt: artifact?.prepared_at,
    });
  } catch (error) {
    errors.push(`The current source cannot reproduce the locator review: ${error.message}`);
  }
  if (currentArtifact) {
    if (sourceId !== artifact.source.authority_id) errors.push("The current authority ID differs from the reviewed source.");
    if (currentArtifact.source.sfs_number !== artifact.source.sfs_number) errors.push("The current SFS identity differs from the reviewed source.");
    if (currentArtifact.source.source_snapshot !== artifact.source.source_snapshot) errors.push("The current source snapshot filename differs from the reviewed source.");
    if (currentArtifact.source.source_text_sha256 !== artifact.source.source_text_sha256) errors.push("The current text snapshot hash differs from the reviewed source.");
    if (currentArtifact.source.source_html_sha256 !== artifact.source.source_html_sha256) errors.push("The current HTML snapshot hash differs from the reviewed source.");
    if (currentArtifact.implementation.index_version !== artifact.implementation.index_version
      || currentArtifact.implementation.connector_review_version !== artifact.implementation.connector_review_version) {
      errors.push("The current connector or index version differs from the reviewed version.");
    }
    if (!sameJson(currentArtifact.automatic_capability, artifact.automatic_capability)) errors.push("The automatic capability result has changed since review preparation.");
    if (!sameJson(currentArtifact.review_disposition, artifact.review_disposition)
      || !sameJson(currentArtifact.review_signals, artifact.review_signals)) {
      errors.push("The current review disposition or classified signals differ from the reviewed artifact.");
    }
    if (currentArtifact.locator.canonical !== artifact.locator.canonical
      || currentArtifact.publisher_anchor.name !== artifact.publisher_anchor.name) {
      errors.push("The current locator or publisher anchor differs from the reviewed target.");
    }
    if (!sameJson(currentArtifact.boundary.source_offsets, artifact.boundary.source_offsets)) errors.push("The current provision boundary differs from the reviewed offsets.");
    if (currentArtifact.provision_text_sha256 !== artifact.provision_text_sha256) errors.push("The current provision text differs from the reviewed hash.");
    if (!sameJson(currentArtifact.temporal.markers, []) || currentArtifact.temporal.resolution !== artifact.temporal.resolution) {
      errors.push("The current locator has unresolved timing markers or a changed temporal state.");
    }
  }
  return { valid: errors.length === 0, errors, current_artifact: currentArtifact };
}

export async function importReviewDecision({ artifact, decision, sourceId, document, rawFile, storeDir }) {
  const validation = validateReviewDecision({ artifact, decision, sourceId, document, rawFile });
  if (!validation.valid) return { status: "rejected", errors: validation.errors };
  await ensureDirectory(storeDir);
  const fileName = [
    safeFileSegment(sourceId, "source"),
    safeFileSegment(decision.locator.canonical, "locator"),
    decision.decision_record_sha256.slice(0, 16),
  ].join("--") + ".json";
  const storePath = join(storeDir, fileName);
  const record = {
    store_schema: "sv_sfs_locator_review_store_record",
    store_schema_version: REVIEW_STORE_SCHEMA_VERSION,
    imported_at: new Date().toISOString(),
    artifact,
    decision,
  };
  await writeFile(storePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { status: "imported", store_path: storePath, decision_record_sha256: decision.decision_record_sha256 };
}

export async function findValidLocatorReview({ storeDir, sourceId, requestedLocator, document, rawFile }) {
  const canonical = canonicalLocator(parseLocator(requestedLocator));
  let files;
  try {
    files = (await readdir(storeDir)).filter((file) => file.endsWith(".json")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "not_found", rejected: [] };
    throw error;
  }
  const valid = [];
  const rejected = [];
  for (const file of files) {
    let record;
    try {
      record = JSON.parse(await readFile(join(storeDir, file), "utf8"));
    } catch (error) {
      rejected.push({ file, errors: [`Unreadable review-store record: ${error.message}`] });
      continue;
    }
    if (record?.decision?.source?.authority_id !== sourceId
      || record?.decision?.locator?.canonical !== canonical) continue;
    if (record?.store_schema !== "sv_sfs_locator_review_store_record"
      || record?.store_schema_version !== REVIEW_STORE_SCHEMA_VERSION) {
      rejected.push({ file, errors: ["Unsupported review-store record schema."] });
      continue;
    }
    const validation = validateReviewDecision({
      artifact: record.artifact,
      decision: record.decision,
      sourceId,
      document,
      rawFile,
    });
    if (validation.valid) valid.push({ file, record, currentArtifact: validation.current_artifact });
    else rejected.push({ file, errors: validation.errors });
  }
  if (!valid.length) return { status: "not_found", rejected };
  valid.sort((left, right) => left.record.decision.reviewer.reviewed_at
    .localeCompare(right.record.decision.reviewer.reviewed_at));
  return { status: "found", ...valid.at(-1), rejected };
}
