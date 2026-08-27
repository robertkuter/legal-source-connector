import { parseLocator, provisionTemporalState } from "./sfs_index.mjs";
import { riksdagenAttribution } from "./runtime.mjs";

export function snapshotTimestamp(rawFile) {
  const match = String(rawFile ?? "").match(/^((?:\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z)/);
  return match ? `${match[1].slice(0, 13)}:${match[2]}:${match[3]}.${match[4]}Z` : null;
}

function matchesFor(index, locator) {
  const parsed = parseLocator(locator);
  return index.sections.filter(
    (section) => section.chapter === parsed.chapter && section.section === parsed.section,
  );
}

function locatorCheck(index, requestedLocator) {
  try {
    const matches = matchesFor(index, requestedLocator);
    if (index.capability.status !== "supported") {
      return {
        requested_locator: requestedLocator,
        status: "unknown",
        reason: "The source capability gate did not support deterministic provision lookup.",
      };
    }
    if (matches.length === 0) {
      return { requested_locator: requestedLocator, status: "not_found" };
    }
    const temporal = provisionTemporalState(index.capability, matches);
    if (matches.length > 1) {
      return {
        requested_locator: requestedLocator,
        status: "ambiguous",
        match_count: matches.length,
        temporal,
        candidates: matches.map((match) => ({
          canonical_locator: match.locator,
          heading_text: match.heading_text,
          temporal_marker: match.temporal_marker,
        })),
      };
    }
    const match = matches[0];
    if (match.temporal_marker) {
      return {
        requested_locator: requestedLocator,
        status: "unknown",
        canonical_locator: match.locator,
        temporal,
        reason: "The locator carries a publisher transition marker and date-aware version selection is not implemented.",
      };
    }
    return {
      requested_locator: requestedLocator,
      status: "found",
      canonical_locator: match.locator,
      anchor_name: match.anchor_name,
      section_sha256: match.section_sha256,
      temporal,
    };
  } catch (error) {
    return {
      requested_locator: requestedLocator,
      status: "invalid",
      reason: error.message,
    };
  }
}

export function buildSourceManifest({ indexed, sourceId, testedLocators = [], generatedAt = new Date().toISOString() }) {
  const { document, index, rawFile } = indexed;
  const sourceSnapshotAt = snapshotTimestamp(rawFile);
  return {
    manifest_version: "0.1",
    manifest_kind: "source_manifest",
    authority_id: sourceId,
    publisher: "Sveriges riksdag / data.riksdagen.se",
    attribution: riksdagenAttribution(),
    title: document.titel ?? null,
    sfs_number: document.beteckning ?? null,
    official_source: {
      text_url: `https://data.riksdagen.se/dokument/${sourceId}.text`,
      html_url: `https://data.riksdagen.se/dokument/${sourceId}.html`,
    },
    snapshot: {
      raw_file: rawFile,
      source_snapshot_at: sourceSnapshotAt,
      consolidation_signal: document.subtitel ?? null,
      retrieval_mode: "cached_snapshot",
      manifest_generated_at: generatedAt,
    },
    integrity: {
      source_text_sha256: index.source_text_sha256,
      source_html_sha256: index.source_html_sha256,
      source_text_length: index.source_text_length,
      offset_unit: index.offset_unit,
    },
    index: {
      index_version: index.index_version,
      section_count: index.section_count,
      capability: index.capability,
    },
    tested_locators: testedLocators.map((locator) => locatorCheck(index, locator)),
    note: "Derived from a cached official source snapshot. This manifest is a compact build-health record; it does not replace the complete source snapshot or a provision evidence packet.",
  };
}
