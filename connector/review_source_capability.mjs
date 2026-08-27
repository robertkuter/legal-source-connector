#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildIndex,
  findTextSectionCandidates,
  loadCachedDocument,
  parseHtmlParagraphAnchors,
  parseTemporalMarker,
} from "./sfs_index.mjs";
import {
  defaultCacheDir,
  defaultRunDir,
  ensureDirectory,
  riksdagenAttribution,
  resolveUserPath,
} from "./runtime.mjs";

function snapshotTimestamp(rawFile) {
  const match = String(rawFile ?? "").match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return match ? `${match[1]}:${match[2]}:${match[3]}.${match[4]}Z` : null;
}

function parseArgs(items) {
  const result = { cacheDir: defaultCacheDir(), runDir: defaultRunDir() };
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] === "--source") result.sourceId = items[++i];
    else if (items[i] === "--cache-dir") result.cacheDir = resolveUserPath(items[++i], result.cacheDir);
    else if (items[i] === "--run-dir") result.runDir = resolveUserPath(items[++i], result.runDir);
  }
  return result;
}

function explainMismatch(anchor, candidate) {
  const temporalMarker = parseTemporalMarker(candidate?.heading_text);
  if (temporalMarker) {
    return {
      kind: "temporal_candidate_not_aligned",
      temporal_marker: temporalMarker,
      explanation: "The text representation contains a provision carrying a publisher transition marker at this position, while the HTML paragraph-anchor sequence does not expose the same version. This explains the first mismatch only; the complete source still requires alignment review before promotion.",
    };
  }
  if (anchor?.section === candidate?.section && anchor?.chapter !== candidate?.chapter) {
    return {
      kind: "chapter_identity_mismatch",
      temporal_marker: null,
      explanation: "The HTML and text representations identify the same section number under different chapters. The chapter parser or publisher structure requires review before the source can be promoted.",
    };
  }
  return {
    kind: "candidate_sequence_mismatch",
    temporal_marker: null,
    explanation: "The text candidate sequence does not align with the publisher's HTML paragraph anchors. The surrounding lines may contain a cross-reference list, formatting anomaly or another source structure that requires review before promotion.",
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.sourceId) {
  console.error("Usage: node connector/review_source_capability.mjs --source sfs-1995-1554");
  process.exit(2);
}

const packetGeneratedAt = new Date().toISOString();
let packet;
try {
  const cached = await loadCachedDocument(args.cacheDir, args.sourceId);
  const index = buildIndex({ sourceId: args.sourceId, document: cached.document, rawFile: cached.rawFile });
  const anchors = parseHtmlParagraphAnchors(cached.document.html);
  const textResult = findTextSectionCandidates(String(cached.document.text ?? ""));
  const firstMismatch = Math.min(anchors.length, textResult.candidates.length);
  let mismatchPosition = null;
  for (let i = 0; i < firstMismatch; i += 1) {
    if (anchors[i].section !== textResult.candidates[i].section) {
      mismatchPosition = i;
      break;
    }
  }

  let mismatchEvidence = null;
  if (mismatchPosition !== null) {
    const anchor = anchors[mismatchPosition];
    const candidate = textResult.candidates[mismatchPosition];
    const recoveryIndex = textResult.candidates.findIndex((item, position) =>
      position > mismatchPosition && item.section === anchor.section);
    const falseCandidates = recoveryIndex > mismatchPosition
      ? textResult.candidates.slice(mismatchPosition, recoveryIndex)
      : [candidate];
    const firstLine = Math.max(0, falseCandidates[0].start_line - 3);
    const lastLine = Math.min(textResult.lines.length, (falseCandidates.at(-1).start_line ?? candidate.start_line) + 4);
    const mismatchClassification = explainMismatch(anchor, candidate);
    mismatchEvidence = {
      position: mismatchPosition + 1,
      html_anchor_expected: {
        name: anchor.name,
        chapter: anchor.chapter,
        section: anchor.section,
        heading_text: anchor.heading_text,
      },
      text_candidate_at_position: {
        section: candidate.section,
        heading_text: candidate.heading_text,
        start_line: candidate.start_line + 1,
        start_offset: candidate.start_offset,
      },
      false_positive_candidates_before_alignment: falseCandidates.map((item) => ({
        section: item.section,
        heading_text: item.heading_text,
        start_line: item.start_line + 1,
        start_offset: item.start_offset,
      })),
      source_context: textResult.lines.slice(firstLine, lastLine).map((line, offset) => ({
        line: firstLine + offset + 1,
        text: line,
      })),
      mismatch_kind: mismatchClassification.kind,
      temporal_marker: mismatchClassification.temporal_marker,
      explanation: mismatchClassification.explanation,
    };
  }

  const sourceSnapshotAt = snapshotTimestamp(cached.rawFile);
  packet = {
    status: index.capability.status,
    packet_kind: "source_capability_review",
    authority_id: args.sourceId,
    source_id: cached.document.beteckning,
    title: cached.document.titel,
    source_url: `https://data.riksdagen.se/dokument/${args.sourceId}.text`,
    source_html_url: `https://data.riksdagen.se/dokument/${args.sourceId}.html`,
    attribution: riksdagenAttribution(),
    retrieved_at: sourceSnapshotAt ?? packetGeneratedAt,
    source_snapshot_at: sourceSnapshotAt,
    packet_generated_at: packetGeneratedAt,
    retrieval_mode: "cached_snapshot",
    consolidation_signal: cached.document.subtitel ?? null,
    source_text_sha256: index.source_text_sha256,
    source_html_sha256: index.source_html_sha256,
    source_snapshot: cached.rawFile,
    offset_unit: index.offset_unit,
    capability: index.capability,
    mismatch_evidence: mismatchEvidence,
    safe_use: index.capability.status === "supported"
      ? "The source passed the current structural gate."
      : "Do not return a provision as confirmed from this index until the mismatch is resolved or an approved source-specific index is used.",
    next_step: "Classify every sequence mismatch, compare a context-aware candidate parser against the publisher anchors, and rerun the complete source audit before promotion.",
    note: "This packet explains source structure and parser capability. It is not legal advice or an applicability determination.",
  };
} catch (error) {
  packet = {
    status: "unknown",
    packet_kind: "source_capability_review",
    authority_id: args.sourceId,
    requested_at: packetGeneratedAt,
    warning: error.message,
  };
}

await ensureDirectory(args.runDir);
const runPath = join(args.runDir, `capability-review-${args.sourceId}-${packetGeneratedAt.replaceAll(/[:.]/g, "-")}.json`);
await writeFile(runPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ run_receipt: runPath, ...packet }, null, 2));
