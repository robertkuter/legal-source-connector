#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSourceManifest } from "../connector/source_manifest.mjs";
import { buildIndex, writeIndex } from "../connector/sfs_index.mjs";
import { requireCachedSources } from "./cache_requirements.mjs";

const cacheDir = new URL("../cache/riksdagen/", import.meta.url).pathname;
if (!await requireCachedSources(cacheDir, ["sfs-2005-551"])) process.exit(2);
const indexed = await writeIndex(cacheDir, "sfs-2005-551");
const generatedAt = "2026-08-24T00:00:00.000Z";
const manifest = buildSourceManifest({
  indexed,
  sourceId: "sfs-2005-551",
  testedLocators: ["13 kap. 6 §", "13 kap. 999 §", "ABL 13 §", "4 kap. 47 §", "7 kap. 68 a §"],
  generatedAt,
});
const results = [];

function check(name, condition, details = {}) {
  results.push({ name, status: condition ? "pass" : "fail", ...details });
}

check("Manifest identifies its format", manifest.manifest_kind === "source_manifest"
  && manifest.manifest_version === "0.1");
check("Manifest identifies the official authority", manifest.authority_id === "sfs-2005-551"
  && manifest.official_source.text_url.endsWith("sfs-2005-551.text"));
check("Manifest carries source attribution", manifest.attribution?.text === "Källa: Sveriges riksdag"
  && manifest.attribution?.non_endorsement.includes("independent"));
check("Manifest separates source snapshot time from manifest generation time",
  manifest.snapshot.source_snapshot_at !== null
  && manifest.snapshot.manifest_generated_at === generatedAt);
check("Manifest carries the publisher consolidation signal",
  manifest.snapshot.consolidation_signal === indexed.document.subtitel);
check("Manifest carries integrity hashes without source text",
  manifest.integrity.source_text_sha256 === indexed.index.source_text_sha256
  && manifest.integrity.source_html_sha256 === indexed.index.source_html_sha256
  && !Object.hasOwn(manifest, "text"));
check("Manifest carries index health without copying every section",
  manifest.index.index_version === indexed.index.index_version
  && manifest.index.section_count === indexed.index.section_count
  && manifest.index.capability.status === "supported"
  && manifest.index.capability.temporal.status === "layered_unresolved"
  && !Object.hasOwn(manifest.index, "sections"));

const [found, missing, invalid, ambiguous, futureOnly] = manifest.tested_locators;
check("Found sample locator records its canonical address and hash",
  found.status === "found"
  && found.canonical_locator === "13 kap. 6 §"
  && found.section_sha256);
check("Missing sample locator is not treated as found", missing.status === "not_found");
check("Invalid sample locator is rejected", invalid.status === "invalid");
check("Ambiguous sample locator remains visible", ambiguous.status === "ambiguous"
  && ambiguous.match_count > 1);
check("Future-only marked locator remains unknown", futureOnly.status === "unknown"
  && futureOnly.temporal.resolution === "marked_version_unresolved");
check("Manifest does not embed the complete cached Act", JSON.stringify(manifest).length < 10000);

const cachedIndex = JSON.parse(await readFile(join(cacheDir, "sfs-2005-551", "index.json"), "utf8"));
check("Manifest agrees with the cached index", manifest.index.section_count === cachedIndex.section_count
  && manifest.integrity.source_text_sha256 === cachedIndex.source_text_sha256);

const unsupportedIndex = buildIndex({
  sourceId: "synthetic-no-html-structure",
  document: { titel: "Synthetic source", beteckning: "TEST:1", text: "\n1 § Example.\n", html: "<p>Example.</p>" },
  rawFile: "2026-08-24T00-00-00-000Z.json",
});
const unsupportedManifest = buildSourceManifest({
  indexed: {
    document: { titel: "Synthetic source", beteckning: "TEST:1", subtitel: null },
    index: unsupportedIndex,
    rawFile: "2026-08-24T00-00-00-000Z.json",
  },
  sourceId: "synthetic-no-html-structure",
  testedLocators: ["1 §"],
  generatedAt,
});
check("Manifest preserves unsupported capability for an untested source",
  unsupportedManifest.index.capability.status === "unsupported"
  && unsupportedManifest.tested_locators[0].status === "unknown");

const summary = {
  test_suite: "source-manifest-v0.1",
  generated_at: new Date().toISOString(),
  total: results.length,
  passed: results.filter((result) => result.status === "pass").length,
  failed: results.filter((result) => result.status === "fail").length,
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (summary.failed > 0) process.exitCode = 1;
