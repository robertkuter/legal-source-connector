#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildIndex,
  parseLocator,
  provisionTemporalState,
  sha256,
  writeIndex,
} from "../connector/sfs_index.mjs";
import { requireCachedSources } from "./cache_requirements.mjs";

const cacheDir = new URL("../cache/riksdagen/", import.meta.url).pathname;
const runDir = new URL("../runs/", import.meta.url).pathname;
const results = [];

if (!await requireCachedSources(cacheDir, [
  "sfs-2005-551",
  "sfs-1982-80",
  "sfs-1915-218",
  "sfs-2008-567",
])) process.exit(2);

function check(name, passed, details = {}) {
  results.push({ name, status: passed ? "pass" : "fail", ...details });
}

function matchesFor(index, locator) {
  const parsed = parseLocator(locator);
  return index.sections.filter(
    (section) => section.chapter === parsed.chapter && section.section === parsed.section,
  );
}

function normalizedSectionText(documentText, section) {
  return documentText
    .slice(section.start_offset, section.end_offset_exclusive)
    .replace(/\r\n|\r/g, "\n")
    .trim();
}

const abl = await writeIndex(cacheDir, "sfs-2005-551");
const ablAgain = await writeIndex(cacheDir, "sfs-2005-551");
const las = await writeIndex(cacheDir, "sfs-1982-80");
const avtalslagen = await writeIndex(cacheDir, "sfs-1915-218");
const diskrimineringslagen = await writeIndex(cacheDir, "sfs-2008-567");

check("ABL structural capability is supported", abl.index.capability.status === "supported", {
  capability: abl.index.capability,
});
check("ABL temporal capability exposes unresolved publisher markers",
  abl.index.capability.temporal.status === "layered_unresolved"
  && abl.index.capability.temporal.section_marker_count === 28
  && abl.index.capability.temporal.heading_marker_count === 7, {
  temporal: abl.index.capability.temporal,
});
check("Existing ABL index is reused when the snapshot and version match", ablAgain.reused === true);
check("ABL index matches every HTML paragraph anchor", abl.index.section_count === 1025
  && abl.index.capability.html_anchor_count === abl.index.section_count, {
  section_count: abl.index.section_count,
  html_anchor_count: abl.index.capability.html_anchor_count,
});
check("LAS structural capability is supported", las.index.capability.status === "supported", {
  capability: las.index.capability,
});
check("LAS index matches every HTML paragraph anchor", las.index.section_count === 70
  && las.index.capability.html_anchor_count === las.index.section_count, {
  section_count: las.index.section_count,
  html_anchor_count: las.index.capability.html_anchor_count,
});
check("Avtalslagen structural capability is supported", avtalslagen.index.capability.status === "supported", {
  capability: avtalslagen.index.capability,
});
check("Avtalslagen index matches every HTML paragraph anchor", avtalslagen.index.section_count === 41
  && avtalslagen.index.capability.html_anchor_count === avtalslagen.index.section_count, {
  section_count: avtalslagen.index.section_count,
  html_anchor_count: avtalslagen.index.capability.html_anchor_count,
});
check("Diskrimineringslagen structural capability is supported", diskrimineringslagen.index.capability.status === "supported", {
  capability: diskrimineringslagen.index.capability,
});
check("Diskrimineringslagen index matches every HTML paragraph anchor", diskrimineringslagen.index.section_count === 88
  && diskrimineringslagen.index.capability.html_anchor_count === diskrimineringslagen.index.section_count, {
  section_count: diskrimineringslagen.index.section_count,
  html_anchor_count: diskrimineringslagen.index.capability.html_anchor_count,
});

for (const locator of [
  "13 kap. 6 §",
  "13 kap. 7 §",
  "8 kap. 18 §",
  "8 kap. 24 §",
  "8 kap. 25 §",
  "8 kap. 7 §",
  "8 kap. 29 §",
  "8 kap. 4 §",
]) {
  const matches = matchesFor(abl.index, locator);
  check(`ABL exact locator is unique: ${locator}`, matches.length === 1, {
    match_count: matches.length,
  });
}

const lasSeven = matchesFor(las.index, "7 §");
check("LAS 7 § is unique", lasSeven.length === 1, { match_count: lasSeven.length });
if (lasSeven.length === 1) {
  const text = normalizedSectionText(las.document.text, lasSeven[0]);
  check("LAS 7 § contains the expected changed-wording phrase", text.includes("sakliga skäl"));
}

check("Avtalslagen 1 kap. 1 § is unique", matchesFor(avtalslagen.index, "1 kap. 1 §").length === 1);
check("Diskrimineringslagen 2 kap. 3 § is unique", matchesFor(diskrimineringslagen.index, "2 kap. 3 §").length === 1);

check("ABL chapter 7 continues past section 10", matchesFor(abl.index, "7 kap. 11 §").length === 1);
check("ABL chapter 7 reaches section 71", matchesFor(abl.index, "7 kap. 71 §").length === 1);

const ablThirteenSix = matchesFor(abl.index, "13 kap. 6 §");
if (ablThirteenSix.length === 1) {
  const text = normalizedSectionText(abl.document.text, ablThirteenSix[0]);
  check(
    "ABL 13 kap. 6 § excludes the following section heading",
    !text.includes("Uppgifter om apportegendom och kvittning"),
  );
}

check("Missing locator returns no match", matchesFor(abl.index, "13 kap. 999 §").length === 0);
check("Transition locator remains visible as ambiguous", matchesFor(abl.index, "4 kap. 47 §").length > 1, {
  match_count: matchesFor(abl.index, "4 kap. 47 §").length,
});
const futureOnlyLocator = matchesFor(abl.index, "7 kap. 68 a §");
check("Future-only ABL locator is marked unresolved",
  futureOnlyLocator.length === 1
  && provisionTemporalState(abl.index.capability, futureOnlyLocator).resolution === "marked_version_unresolved"
  && futureOnlyLocator[0].temporal_marker?.date === "2030-01-10");
const futureOnlyPacket = JSON.parse(execFileSync(process.execPath, [
  new URL("../connector/get_provision.mjs", import.meta.url).pathname,
  "--source", "sfs-2005-551",
  "--locator", "7 kap. 68 a §",
  "--run-dir", runDir,
], { encoding: "utf8" }));
check("Provision command refuses a future-only marked locator",
  futureOnlyPacket.packet_version === "0.2"
  && futureOnlyPacket.status === "unknown"
  && futureOnlyPacket.temporal?.resolution === "marked_version_unresolved"
  && futureOnlyPacket.attribution?.text === "Källa: Sveriges riksdag"
  && !Object.hasOwn(futureOnlyPacket, "text"), {
  packet_status: futureOnlyPacket.status,
  temporal: futureOnlyPacket.temporal,
});

for (const invalid of ["ABL 13 §", "chapter 13 section 6", "13 kap. 6 § extra", "", "§"]) {
  let rejected = false;
  try {
    parseLocator(invalid);
  } catch {
    rejected = true;
  }
  check(`Invalid locator is rejected: ${JSON.stringify(invalid)}`, rejected);
}

let integrityFailures = 0;
let offsetsAreMonotonic = true;
let sectionHeadingsArePlausible = true;
for (const section of abl.index.sections) {
  const text = normalizedSectionText(abl.document.text, section);
  if (sha256(text) !== section.section_sha256) integrityFailures += 1;
  if (section.end_offset_exclusive <= section.start_offset) offsetsAreMonotonic = false;
  if (!text.startsWith(`${section.section} §`)) sectionHeadingsArePlausible = false;
}
check("Every ABL indexed section hash matches its offsets", integrityFailures === 0, {
  checked: abl.index.sections.length,
  failures: integrityFailures,
});
check("Every ABL indexed section has increasing offsets", offsetsAreMonotonic);
check("Every ABL indexed section begins with its section heading", sectionHeadingsArePlausible);

const duplicateLocators = new Set();
const seenLocators = new Set();
for (const section of abl.index.sections) {
  if (seenLocators.has(section.locator)) duplicateLocators.add(section.locator);
  seenLocators.add(section.locator);
}
check("Duplicate locator count is reported for review", true, {
  duplicate_locator_count: duplicateLocators.size,
  examples: [...duplicateLocators].slice(0, 8),
});

const noHtmlStructure = buildIndex({
  sourceId: "synthetic-no-html-structure",
  document: { text: "\n1 § Example text.\n", html: "<p>Example text.</p>" },
  rawFile: "synthetic.json",
});
check("Untested source without paragraph anchors is unsupported", noHtmlStructure.capability.status === "unsupported"
  && noHtmlStructure.section_count === 0, {
  capability: noHtmlStructure.capability,
});

const mismatchedStructure = buildIndex({
  sourceId: "synthetic-mismatched-structure",
  document: {
    text: "\n1 § First.\n\n2 § Second.\n",
    html: '<a class="paragraf" name="P1"><b>1 §</b></a> First.',
  },
  rawFile: "synthetic.json",
});
check("Mismatched structure requires review and yields no sections", mismatchedStructure.capability.status === "review_required"
  && mismatchedStructure.section_count === 0, {
  capability: mismatchedStructure.capability,
});

const mismatchedChapter = buildIndex({
  sourceId: "synthetic-mismatched-chapter",
  document: {
    text: "\n1 kap. First chapter\n\n1 § First.\n\n3 kap. Third chapter\n\n1 § Second.\n",
    html: '<a class="paragraf" name="K1P1"><b>1 §</b></a><a class="paragraf" name="K2P1"><b>1 §</b></a>',
  },
  rawFile: "synthetic.json",
});
check("Chapter mismatch requires review", mismatchedChapter.capability.status === "review_required"
  && mismatchedChapter.capability.issues.some((issue) => issue.includes("Locator order differs")), {
  capability: mismatchedChapter.capability,
});

const summary = {
  test_suite: "connector-automated-stress-v0.2",
  generated_at: new Date().toISOString(),
  total: results.length,
  passed: results.filter((result) => result.status === "pass").length,
  failed: results.filter((result) => result.status === "fail").length,
  results,
};
const receiptPath = join(runDir, `connector-tests-${summary.generated_at.replaceAll(/[:.]/g, "-")}.json`);
await writeFile(receiptPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receipt: receiptPath, ...summary }, null, 2));
if (summary.failed > 0) process.exitCode = 1;
