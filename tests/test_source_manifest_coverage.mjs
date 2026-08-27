#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { buildSourceManifest } from "../connector/source_manifest.mjs";
import { writeIndex } from "../connector/sfs_index.mjs";
import { requireAnyCachedSource } from "./cache_requirements.mjs";

const execFile = promisify(execFileCallback);
const projectRoot = new URL("../", import.meta.url).pathname;
const cacheDir = join(projectRoot, "cache", "riksdagen");
const runDir = join(projectRoot, "runs");
const cliOutputPath = join(projectRoot, "temp", "source-manifest-cli-test.json");
const results = [];
const coverage = [];
const skipped = [];

if (!await requireAnyCachedSource(cacheDir)) process.exit(2);

function check(name, condition, details = {}) {
  results.push({ name, status: condition ? "pass" : "fail", ...details });
}

function uniqueLocator(index) {
  return index.sections.find((candidate) => index.sections.filter(
    (section) => section.locator === candidate.locator,
  ).length === 1)?.locator ?? null;
}

function duplicateLocator(index) {
  return index.sections.find((candidate) => index.sections.filter(
    (section) => section.locator === candidate.locator,
  ).length > 1)?.locator ?? null;
}

const sourceEntries = await readdir(cacheDir, { withFileTypes: true });
const sourceIds = sourceEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
check("Cached source set is non-empty", sourceIds.length > 0, { source_count: sourceIds.length });

for (const sourceId of sourceIds) {
  const sourceFiles = await readdir(join(cacheDir, sourceId));
  const jsonFiles = sourceFiles
    .filter((file) => file.endsWith(".json") && file !== "index.json" && !file.endsWith("-index.json"))
    .sort();
  let hasUsableJson = false;
  for (const file of jsonFiles) {
    try {
      const payload = JSON.parse(await readFile(join(cacheDir, sourceId, file), "utf8"));
      const document = payload?.dokumentstatus?.dokument ?? payload?.dokument?.dokument ?? payload?.dokument;
      if (document?.text) {
        hasUsableJson = true;
        break;
      }
    } catch {
      // Keep looking. If none of the cached JSON files are usable, classify the directory below.
    }
  }
  if (!hasUsableJson) {
    skipped.push({ source_id: sourceId, reason: "orientation_only_or_invalid_json_cache" });
    continue;
  }
  try {
    const indexed = await writeIndex(cacheDir, sourceId);
    const foundLocator = uniqueLocator(indexed.index);
    const ambiguousLocator = duplicateLocator(indexed.index);
    const testedLocators = ["not a Swedish locator", "999 kap. 999 §"];
    if (foundLocator) testedLocators.push(foundLocator);
    if (ambiguousLocator) testedLocators.push(ambiguousLocator);
    const manifest = buildSourceManifest({
      indexed,
      sourceId,
      testedLocators,
      generatedAt: "2026-08-24T00:00:00.000Z",
    });
    const supported = indexed.index.capability.status === "supported";
    const serialized = JSON.stringify(manifest);

    check(`${sourceId} manifest identifies the cached authority`,
      manifest.authority_id === sourceId
      && manifest.title === indexed.document.titel
      && manifest.sfs_number === indexed.document.beteckning);
    check(`${sourceId} manifest identifies the official endpoints`,
      manifest.official_source.text_url === `https://data.riksdagen.se/dokument/${sourceId}.text`
      && manifest.official_source.html_url === `https://data.riksdagen.se/dokument/${sourceId}.html`);
    check(`${sourceId} manifest separates snapshot and generation time`,
      manifest.snapshot.source_snapshot_at
      && manifest.snapshot.manifest_generated_at === "2026-08-24T00:00:00.000Z");
    check(`${sourceId} manifest carries matching integrity metadata`,
      manifest.integrity.source_text_sha256 === indexed.index.source_text_sha256
      && manifest.integrity.source_html_sha256 === indexed.index.source_html_sha256
      && manifest.integrity.source_text_length === indexed.index.source_text_length);
    check(`${sourceId} manifest carries the capability result`,
      manifest.index.index_version === indexed.index.index_version
      && manifest.index.capability.status === indexed.index.capability.status
      && manifest.index.capability.issues.join("|") === indexed.index.capability.issues.join("|"));
    check(`${sourceId} manifest does not embed source or section arrays`,
      !Object.hasOwn(manifest, "text")
      && !Object.hasOwn(manifest, "sections")
      && !Object.hasOwn(manifest.index, "sections")
      && serialized.length < 10000);
    if (supported) {
      check(`${sourceId} supported manifest exposes a non-empty index`,
        manifest.index.section_count > 0
        && manifest.index.capability.html_anchor_count === manifest.index.section_count
        && manifest.index.capability.text_candidate_count === manifest.index.section_count);
      if (foundLocator) {
        const found = manifest.tested_locators.find((result) => result.requested_locator === foundLocator);
        check(`${sourceId} representative indexed locator is found`, found?.status === "found", {
          locator: foundLocator,
        });
      }
      const missing = manifest.tested_locators.find((result) => result.requested_locator === "999 kap. 999 §");
      check(`${sourceId} missing locator is reported as not_found`, missing?.status === "not_found");
      if (ambiguousLocator) {
        const ambiguous = manifest.tested_locators.find((result) => result.requested_locator === ambiguousLocator);
        check(`${sourceId} duplicate locator remains ambiguous`, ambiguous?.status === "ambiguous"
          && ambiguous.match_count > 1, { locator: ambiguousLocator });
      }
    } else {
      check(`${sourceId} non-supported manifest exposes no confirmed sections`,
        manifest.index.section_count === 0
        && manifest.tested_locators.every((result) => result.status === "unknown" || result.status === "invalid"));
    }
    const invalid = manifest.tested_locators.find((result) => result.requested_locator === "not a Swedish locator");
    check(`${sourceId} invalid locator is rejected`, invalid?.status === "invalid");
    coverage.push({ source_id: sourceId, capability: indexed.index.capability.status, sections: indexed.index.section_count });
  } catch (error) {
    check(`${sourceId} can produce a source manifest`, false, { error: error.message });
  }
}

check("Non-JSON cache directories are explicitly classified", skipped.every(
  (source) => source.reason === "orientation_only_or_invalid_json_cache",
), { skipped });

const example = JSON.parse(await readFile(
  join(projectRoot, "examples", "source-manifests", "abl-source-manifest.v0.1.json"),
  "utf8",
));
check("Tracked ABL example has the manifest shape", example.manifest_kind === "source_manifest"
  && example.manifest_version === "0.1"
  && example.authority_id === "sfs-2005-551"
  && !Object.hasOwn(example, "text")
  && !Object.hasOwn(example.index, "sections"));

const cli = await execFile(process.execPath, [
  "connector/build_source_manifest.mjs",
  "--source", "sfs-2005-551",
  "--locator", "13 kap. 6 §",
  "--output", cliOutputPath,
], { cwd: projectRoot });
const cliReceipt = JSON.parse(cli.stdout);
const cliManifest = JSON.parse(await readFile(cliOutputPath, "utf8"));
check("CLI writes the requested manifest output", cliReceipt.manifest === cliOutputPath
  && cliManifest.authority_id === "sfs-2005-551"
  && cliManifest.tested_locators[0].status === "found");

const summary = {
  test_suite: "source-manifest-coverage-v0.1",
  generated_at: new Date().toISOString(),
  source_count: sourceIds.length,
  generic_pipeline_source_count: coverage.length,
  skipped_source_count: skipped.length,
  supported_sources: coverage.filter((source) => source.capability === "supported").length,
  review_or_unsupported_sources: coverage.filter((source) => source.capability !== "supported").length,
  total: results.length,
  passed: results.filter((result) => result.status === "pass").length,
  failed: results.filter((result) => result.status === "fail").length,
  coverage,
  results,
};
const receiptPath = join(runDir, `source-manifest-coverage-${summary.generated_at.replaceAll(/[:.]/g, "-")}.json`);
await writeFile(receiptPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receipt: receiptPath, ...summary }, null, 2));
if (summary.failed > 0) process.exitCode = 1;
