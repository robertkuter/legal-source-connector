#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseLocator,
  provisionTemporalState,
  sha256,
  writeIndex,
} from "./sfs_index.mjs";
import {
  defaultCacheDir,
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
  const result = { cacheDir: defaultCacheDir(), runDir: defaultRunDir() };
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] === "--source") result.sourceId = items[++i];
    else if (items[i] === "--locator") result.locator = items[++i];
    else if (items[i] === "--cache-dir") result.cacheDir = resolveUserPath(items[++i], result.cacheDir);
    else if (items[i] === "--run-dir") result.runDir = resolveUserPath(items[++i], result.runDir);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.sourceId || !args.locator) {
  console.error("Usage: node connector/get_provision.mjs --source sfs-2005-551 --locator '13 kap. 6 §'");
  process.exit(2);
}

const packetGeneratedAt = new Date().toISOString();
let packet;
try {
  const parsed = parseLocator(args.locator);
  const indexed = await writeIndex(args.cacheDir, args.sourceId);
  const sourceSnapshotAt = snapshotTimestamp(indexed.rawFile);
  const packetTiming = {
    retrieved_at: sourceSnapshotAt ?? packetGeneratedAt,
    source_snapshot_at: sourceSnapshotAt,
    packet_generated_at: packetGeneratedAt,
    retrieval_mode: "cached_snapshot",
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
    capability: indexed.index.capability,
    attribution: riksdagenAttribution(),
    source_snapshot: indexed.rawFile,
    offset_unit: indexed.index.offset_unit,
    index_version: indexed.index.index_version,
  };
  if (indexed.index.capability.status !== "supported") {
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
      warning: "The official source was retrieved, but its structural capability check has not passed. No provision was returned as confirmed.",
    };
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
    warning: error.message,
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
