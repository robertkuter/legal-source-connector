#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseLocator,
  provisionTemporalState,
  sha256,
  writeIndex,
} from "./sfs_index.mjs";
import { findValidLocatorReview, prepareLocatorReviewSurface } from "./locator_review.mjs";
import { createReviewCaseReport, recordReviewCase } from "./review_case_report.mjs";
import { fetchAndPinOfficialSource } from "./fresh_source.mjs";
import {
  defaultCacheDir,
  defaultReviewCaseDir,
  defaultReviewStoreDir,
  defaultRunDir,
  ensureDirectory,
  riksdagenAttribution,
  resolveUserPath,
  safeFileSegment,
} from "./runtime.mjs";

function snapshotTimestamp(rawFile) {
  const match = String(rawFile ?? "").match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return match ? `${match[1]}:${match[2]}:${match[3]}.${match[4]}Z` : null;
}

function parseArgs(items) {
  const result = {
    cacheDir: defaultCacheDir(),
    reviewStoreDir: defaultReviewStoreDir(),
    caseDir: defaultReviewCaseDir(),
    runDir: defaultRunDir(),
  };
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] === "--source") result.sourceId = items[++i];
    else if (items[i] === "--locator") result.locator = items[++i];
    else if (items[i] === "--fresh") result.fresh = true;
    else if (items[i] === "--cache-dir") result.cacheDir = resolveUserPath(items[++i], result.cacheDir);
    else if (items[i] === "--review-store") result.reviewStoreDir = resolveUserPath(items[++i], result.reviewStoreDir);
    else if (items[i] === "--case-dir") result.caseDir = resolveUserPath(items[++i], result.caseDir);
    else if (items[i] === "--run-dir") result.runDir = resolveUserPath(items[++i], result.runDir);
  }
  return result;
}

function sourceObservation(surface) {
  const views = surface.review_context?.reading_views
    ?? surface.explanation_context?.reading_views
    ?? [];
  const verificationIssue = {
    disposition: surface.review_disposition.status,
    reason_codes: surface.review_disposition.reason_codes,
    automatic_capability_status: surface.automatic_capability.status,
  };
  if (views.length) {
    return {
      status: views.length === 1 ? "unverified_text_candidate" : "unselected_text_candidates",
      source_format: "official_plain_text_snapshot",
      use: "reading_only",
      verification_issue: verificationIssue,
      candidates: views.map((view) => ({
        label: view.label,
        evidence_status: view.evidence_status,
        excerpt: view.source_text,
        excerpt_sha256: view.source_text_sha256,
        anchor_name: view.anchor_name,
        start_line: view.start_line,
        next_heading_line: view.next_start_line,
        next_heading_locator: view.next_locator,
        excerpt_boundary_basis: view.excerpt_boundary_basis ?? (view.next_locator ? "next_anchored_provision" : "end_of_source"),
        source_offsets: view.source_offsets,
        temporal_marker: view.temporal_marker,
      })),
      note: "These are source-text observations for reading. No candidate is confirmed or selected as the applicable provision by this packet.",
    };
  }
  const contextLines = surface.explanation_context?.source_context ?? [];
  if (contextLines.length) {
    return {
      status: "limited_context",
      source_format: "official_plain_text_snapshot",
      use: "reading_only",
      verification_issue: verificationIssue,
      context_lines: contextLines,
      note: "Only surrounding source lines could be identified. A complete provision boundary is unavailable; consult the linked official source.",
    };
  }
  return null;
}

async function reviewAction({ sourceId, locator, document, rawFile, caseDir, preparedAt }) {
  try {
    const surface = prepareLocatorReviewSurface({
      sourceId,
      requestedLocator: locator,
      document,
      rawFile,
      preparedAt,
    });
    const action = {
      operation: "prepare_locator_review",
      scope: "locator",
      disposition: surface.review_disposition.status,
      decision_allowed: surface.review_disposition.decision_allowed,
      reason_codes: surface.review_disposition.reason_codes,
      signal_kinds: surface.review_signals.map((signal) => signal.kind),
      input: {
        authority_id: sourceId,
        requested_locator: locator,
      },
    };
    const observation = sourceObservation(surface);
    if (observation) action.source_observation = observation;
    if (surface.review_disposition.status !== "decision_available") {
      const report = createReviewCaseReport(surface);
      try {
        const recorded = await recordReviewCase({ caseDir, report });
        action.case_report = {
          case_id: report.case_id,
          occurrence_id: report.occurrence_id,
          report_kind: report.report_kind,
          local_record_status: recorded.status,
          local_record_path: recorded.recordPath,
          github_new_issue_url: report.github.new_issue_url,
        };
      } catch (error) {
        action.case_report = {
          case_id: report.case_id,
          occurrence_id: report.occurrence_id,
          report_kind: report.report_kind,
          local_record_status: "not_recorded",
          warning: error.message,
        };
      }
    }
    return action;
  } catch (error) {
    return {
      operation: "none",
      scope: "locator",
      disposition: "not_applicable",
      decision_allowed: false,
      reason_codes: ["review_surface_not_available"],
      warning: error.message,
    };
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.sourceId || !args.locator) {
  console.error("Usage: node connector/get_provision.mjs --source sfs-2005-551 --locator '13 kap. 6 §' [--fresh]");
  process.exit(2);
}

let packetGeneratedAt = new Date().toISOString();
let packet;
try {
  const parsed = parseLocator(args.locator);
  const sourceCheck = args.fresh
    ? await fetchAndPinOfficialSource({ sourceId: args.sourceId, cacheDir: args.cacheDir })
    : null;
  packetGeneratedAt = new Date().toISOString();
  const indexed = await writeIndex(args.cacheDir, args.sourceId, {
    rawFile: sourceCheck?.source_snapshot ?? null,
  });
  if (sourceCheck && indexed.rawFile !== sourceCheck.source_snapshot) {
    throw new Error("The indexed source snapshot differs from the completed fresh check.");
  }
  const sourceSnapshotAt = snapshotTimestamp(indexed.rawFile);
  const packetTiming = {
    retrieved_at: sourceSnapshotAt ?? packetGeneratedAt,
    source_snapshot_at: sourceSnapshotAt,
    packet_generated_at: packetGeneratedAt,
    retrieval_mode: sourceCheck ? "fresh_official_check" : "cached_snapshot",
  };
  const sourceEvidence = {
    packet_version: "0.2",
    authority_id: args.sourceId,
    source_id: indexed.document.beteckning,
    title: indexed.document.titel,
    source_url: `https://data.riksdagen.se/dokument/${args.sourceId}.text`,
    source_html_url: `https://data.riksdagen.se/dokument/${args.sourceId}.html`,
    ...packetTiming,
    consolidation_signal: indexed.document.subtitel ?? null,
    source_text_sha256: indexed.index.source_text_sha256,
    source_html_sha256: indexed.index.source_html_sha256,
    ...(sourceCheck ? { source_check: sourceCheck } : {}),
    capability: indexed.index.capability,
    attribution: riksdagenAttribution(),
    source_snapshot: indexed.rawFile,
    offset_unit: indexed.index.offset_unit,
    index_version: indexed.index.index_version,
  };
  if (indexed.index.capability.status !== "supported") {
    const reviewed = indexed.index.capability.status === "review_required"
      ? await findValidLocatorReview({
        storeDir: args.reviewStoreDir,
        sourceId: args.sourceId,
        requestedLocator: args.locator,
        document: indexed.document,
        rawFile: indexed.rawFile,
      })
      : { status: "not_found", rejected: [] };
    if (reviewed.status === "found") {
      const decision = reviewed.record.decision;
      const artifact = reviewed.currentArtifact;
      packet = {
        status: "found",
        basis: "human_reviewed_snapshot",
        ...sourceEvidence,
        requested_locator: args.locator,
        canonical_locator: artifact.locator.canonical,
        text: artifact.provision_text,
        section_sha256: artifact.provision_text_sha256,
        temporal: {
          capability_status: artifact.temporal.capability_status,
          resolution: artifact.temporal.resolution,
          markers: [],
          note: artifact.temporal.note,
        },
        anchor_name: artifact.publisher_anchor.name,
        source_offsets: {
          start: artifact.boundary.source_offsets.start,
          end_exclusive: artifact.boundary.source_offsets.end_exclusive,
        },
        index_path: indexed.indexPath,
        review: {
          status: "valid",
          scope: "locator",
          automatic_capability_status: indexed.index.capability.status,
          decision_schema_version: decision.schema_version,
          connector_review_version: decision.implementation.connector_review_version,
          reviewed_at: decision.reviewer.reviewed_at,
          reviewer_label: decision.reviewer.label,
          rationale: decision.reviewer.rationale,
          artifact_sha256: decision.artifact_sha256,
          decision_record_sha256: decision.decision_record_sha256,
        },
        note: "Retrieved from an exact cached source snapshot under a locator-scoped human review; automatic structural capability remains review_required. This is not legal advice or an applicability determination.",
      };
    } else {
      const action = await reviewAction({
        sourceId: args.sourceId,
        locator: args.locator,
        document: indexed.document,
        rawFile: indexed.rawFile,
        caseDir: args.caseDir,
        preparedAt: packetGeneratedAt,
      });
      packet = {
        status: "unknown",
        ...sourceEvidence,
        requested_locator: args.locator,
        index_path: indexed.indexPath,
        temporal: {
          capability_status: indexed.index.capability.temporal?.status ?? "flat",
          resolution: "source_structure_unresolved",
          markers: [],
        },
        review: {
          status: "not_found",
          scope: "locator",
          valid_decision_found: false,
          rejected_decision_count: reviewed.rejected.length,
          rejection_reasons: reviewed.rejected.flatMap((item) => item.errors),
        },
        review_action: action,
        warning: action.source_observation
          ? "No provision was returned as confirmed. Source text for reading, with the verification issue attached, is available under review_action.source_observation."
          : "The official source was retrieved, but its structural capability check has not passed and no valid locator-scoped review matches this exact snapshot. No provision was returned as confirmed.",
      };
    }
  } else {
    const matches = indexed.index.sections.filter(
      (section) => section.chapter === parsed.chapter && section.section === parsed.section,
    );
    const temporal = provisionTemporalState(indexed.index.capability, matches);
    if (matches.length === 0) {
      packet = {
        status: "not_found",
        ...sourceEvidence,
        requested_locator: args.locator,
        index_path: indexed.indexPath,
        temporal: {
          capability_status: indexed.index.capability.temporal?.status ?? "flat",
          resolution: "locator_not_found",
          markers: [],
        },
        warning: "The source was indexed, but the exact chapter/section was not found.",
      };
    } else if (matches.length > 1) {
      packet = {
        status: "ambiguous",
        ...sourceEvidence,
        requested_locator: args.locator,
        index_path: indexed.indexPath,
        temporal,
        matches: matches.map((match) => ({
          canonical_locator: match.locator,
          heading_text: match.heading_text,
          temporal_marker: match.temporal_marker,
          start_line: match.start_line,
          end_line_exclusive: match.end_line_exclusive,
          source_offsets: {
            start: match.start_offset,
            end_exclusive: match.end_offset_exclusive,
          },
        })),
        review_action: await reviewAction({
          sourceId: args.sourceId,
          locator: args.locator,
          document: indexed.document,
          rawFile: indexed.rawFile,
          caseDir: args.caseDir,
          preparedAt: packetGeneratedAt,
        }),
        warning: "The locator matched more than one structurally plausible passage in the consolidated source. No passage was selected automatically.",
      };
    } else {
      const match = matches[0];
      if (match.temporal_marker) {
        packet = {
          status: "unknown",
          ...sourceEvidence,
          requested_locator: args.locator,
          canonical_locator: match.locator,
          index_path: indexed.indexPath,
          temporal,
          anchor_name: match.anchor_name,
          source_offsets: {
            start: match.start_offset,
            end_exclusive: match.end_offset_exclusive,
          },
          review_action: await reviewAction({
            sourceId: args.sourceId,
            locator: args.locator,
            document: indexed.document,
            rawFile: indexed.rawFile,
            caseDir: args.caseDir,
            preparedAt: packetGeneratedAt,
          }),
          warning: "The locator matched a provision carrying a publisher transition marker. Date-aware version selection is not implemented, so the marked passage was not returned as confirmed.",
        };
      } else {
        const text = indexed.document.text;
        const sectionText = text
          .slice(match.start_offset, match.end_offset_exclusive)
          .replace(/\r\n|\r/g, "\n")
          .trim();
        packet = {
          status: "found",
          ...sourceEvidence,
          requested_locator: args.locator,
          canonical_locator: match.locator,
          text: sectionText,
          section_sha256: sha256(sectionText),
          temporal,
          anchor_name: match.anchor_name,
          source_offsets: {
            start: match.start_offset,
            end_exclusive: match.end_offset_exclusive,
          },
          note: "Retrieved consolidated source text; not legal advice or an applicability determination.",
        };
      }
    }
  }
} catch (error) {
  packet = {
    packet_version: "0.2",
    status: "unknown",
    authority_id: args.sourceId,
    requested_locator: args.locator,
    retrieved_at: packetGeneratedAt,
    packet_generated_at: packetGeneratedAt,
    retrieval_mode: "unknown",
    ...(args.fresh ? { source_check: { status: "unknown", checked_at: new Date().toISOString() } } : {}),
    warning: args.fresh
      ? `Fresh official lookup could not be completed: ${error.message}. No cached provision is presented as current.`
      : error.message,
  };
}

await ensureDirectory(args.runDir);
const receiptSlug = safeFileSegment(args.locator, "locator");
const runPath = join(
  args.runDir,
  `provision-${args.sourceId}-${receiptSlug}-${packetGeneratedAt.replaceAll(/[:.]/g, "-")}.json`,
);
await writeFile(runPath, JSON.stringify(packet, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ run_receipt: runPath, ...packet }, null, 2));
