#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assessComparison } from "../connector/staleness_logic.mjs";
import { fetchAndPinOfficialSource } from "../connector/fresh_source.mjs";
import { inspectSource } from "../connector/orient_riksdagen.mjs";
import { safeFileSegment } from "../connector/runtime.mjs";
import {
  buildIndex,
  loadCachedDocument,
  parseLocator,
  parseTemporalMarker,
  provisionTemporalState,
  sha256,
  writeIndex,
} from "../connector/sfs_index.mjs";
import { splitLinesWithOffsets } from "../connector/text_lines.mjs";

const results = [];

function check(name, passed, details = {}) {
  results.push({ name, status: passed ? "pass" : "fail", ...details });
}

const syntheticDocument = {
  titel: "Synthetic Act",
  beteckning: "synthetic:1",
  subtitel: "t.o.m. SFS 2026:1",
  text: [
    "1 kap. General rules",
    "",
    "1 § First rule.",
    "",
    "2 § Second rule.",
    "",
    "2 kap. Special rules",
    "",
    "1 § Special rule.",
  ].join("\n"),
  html: [
    '<a class="paragraf" name="K1P1"><b>1 §</b></a>',
    '<a class="paragraf" name="K1P2"><b>2 §</b></a>',
    '<a class="paragraf" name="K2P1"><b>1 §</b></a>',
  ].join(""),
};

const index = buildIndex({
  sourceId: "synthetic:1",
  document: syntheticDocument,
  rawFile: "synthetic.json",
});

check("Synthetic chaptered source is supported", index.capability.status === "supported", {
  capability: index.capability,
});
check("Synthetic source without transition markers is temporally flat",
  index.capability.temporal.status === "flat");
check("Synthetic chaptered source has three sections", index.section_count === 3);
check("Repeated section numbers remain distinguishable by chapter",
  index.sections.filter((section) => section.section === "1").length === 2);
check("Synthetic locator resolves to one section",
  index.sections.filter((section) => section.locator === "2 kap. 1 §").length === 1);

const extracted = index.sections.map((section) => syntheticDocument.text
  .slice(section.start_offset, section.end_offset_exclusive)
  .replace(/\r\n|\r/g, "\n")
  .trim());
check("Synthetic section hashes match offsets",
  index.sections.every((section, position) => sha256(extracted[position]) === section.section_sha256));

const chapterless = buildIndex({
  sourceId: "synthetic:chapterless",
  document: {
    text: "1 § First.\n\n2 § Second.\n",
    html: '<a class="paragraf" name="P1"><b>1 §</b></a><a class="paragraf" name="P2"><b>2 §</b></a>',
  },
  rawFile: "synthetic.json",
});
check("Synthetic chapterless source is supported", chapterless.capability.status === "supported");
check("Chapterless locator has no chapter", parseLocator("2 §").chapter === null);

const letteredChapter = buildIndex({
  sourceId: "synthetic:lettered-chapter",
  document: {
    text: "6 b kap. Online services\n\n52 i § Example.\n",
    html: '<a class="paragraf" name="K6bP52i"><b>52 i §</b></a>',
  },
  rawFile: "synthetic.json",
});
check("Lettered chapters beyond a are parsed and addressed",
  letteredChapter.capability.status === "supported"
  && parseLocator("6 b kap. 52 i §").chapter === "6 b"
  && letteredChapter.sections[0].locator === "6 b kap. 52 i §");

const inlineMarker = buildIndex({
  sourceId: "synthetic:inline-marker",
  document: {
    text: "1 § /Träder i kraft I:2030-01-01/ New rule applies.\n",
    html: '<a class="paragraf" name="P1"><b>1 §</b></a>',
  },
  rawFile: "synthetic.json",
});
check("An inline commencement marker blocks a structurally supported provision",
  inlineMarker.capability.status === "supported"
  && inlineMarker.capability.temporal.status === "layered_unresolved"
  && inlineMarker.sections[0].temporal_marker?.date === "2030-01-01");

const layered = buildIndex({
  sourceId: "synthetic:layered",
  document: {
    text: [
      "1 kap. Timing",
      "",
      "1 § Ordinary rule.",
      "",
      "2 § /Träder i kraft I:2030-01-10/",
      "Future-only rule.",
      "",
      "3 § /Upphör att gälla U:2027-01-01/",
      "Outgoing rule.",
      "",
      "3 § /Träder i kraft I:2027-01-01/",
      "Incoming rule.",
      "",
      "4 § /Träder i kraft I:den dag som regeringen bestämmer/",
      "Indeterminate rule.",
    ].join("\n"),
    html: [
      '<a class="paragraf" name="K1P1"><b>1 §</b></a>',
      '<a class="paragraf" name="K1P2"><b>2 §</b></a>',
      '<a class="paragraf" name="K1P3"><b>3 §</b></a>',
      '<a class="paragraf" name="K1P3"><b>3 §</b></a>',
      '<a class="paragraf" name="K1P4"><b>4 §</b></a>',
    ].join(""),
  },
  rawFile: "synthetic.json",
});
const futureOnly = layered.sections.filter((section) => section.locator === "1 kap. 2 §");
const pairedVersions = layered.sections.filter((section) => section.locator === "1 kap. 3 §");
const indeterminate = layered.sections.find((section) => section.locator === "1 kap. 4 §");
check("Layered source records provision markers without selecting a version",
  layered.capability.temporal.status === "layered_unresolved"
  && layered.capability.temporal.section_marker_count === 4
  && provisionTemporalState(layered.capability, futureOnly).resolution === "marked_version_unresolved"
  && provisionTemporalState(layered.capability, pairedVersions).resolution === "multiple_versions_unresolved");
check("Dated and indeterminate marker values remain distinct",
  parseTemporalMarker("/Träder i kraft I:2030-01-10/").date === "2030-01-10"
  && indeterminate.temporal_marker.date === null
  && indeterminate.temporal_marker.date_status === "indeterminate");

const mismatch = buildIndex({
  sourceId: "synthetic:mismatch",
  document: {
    text: "1 kap. First\n\n1 § First.\n\n2 kap. Second\n\n1 § Second.\n",
    html: '<a class="paragraf" name="K1P1"><b>1 §</b></a><a class="paragraf" name="K3P1"><b>1 §</b></a>',
  },
  rawFile: "synthetic.json",
});
check("Chapter mismatch requires review", mismatch.capability.status === "review_required");
check("Malformed locator is rejected", (() => {
  try {
    parseLocator("13 kap. 6 § extra");
    return false;
  } catch {
    return true;
  }
})());
check("Receipt filename segments preserve locator identity", safeFileSegment("13 kap. 6 §") === "13-kap-6");
check("Receipt filename segments provide a fallback", safeFileSegment("") === "item");

const lineResult = splitLinesWithOffsets("a\r\nb\nc\r\nd");
check("Line splitter preserves mixed line-ending offsets",
  JSON.stringify(lineResult.lines) === JSON.stringify(["a", "b", "c", "d"])
  && JSON.stringify(lineResult.offsets) === JSON.stringify([0, 3, 5, 8]));

const current = {
  retrieval_status: "retrieved",
  sfs_number: "synthetic:1",
  document_text_sha256: "hash-a",
  consolidation_signal: "t.o.m. SFS 2026:1",
};
check("Matching synthetic source is current", assessComparison({
  baseline: {
    sfs_number: "synthetic:1",
    source_text_sha256: "hash-a",
    consolidation_signal: "t.o.m. SFS 2026:1",
  },
  current,
  sourceId: "synthetic:1",
}).status === "current");

let missingCacheGuidance = false;
try {
  await loadCachedDocument(new URL("../temp/synthetic-empty-cache/", import.meta.url).pathname, "sfs-2005-551");
} catch (error) {
  missingCacheGuidance = error.message.includes("orient_riksdagen.mjs --source sfs-2005-551");
}
check("Missing source cache gives a copyable orientation instruction", missingCacheGuidance);

const identityCache = await mkdtemp(join(tmpdir(), "lsc-cached-identity-"));
await mkdir(join(identityCache, "sfs-2099-1"));
await writeFile(join(identityCache, "sfs-2099-1", "2099-01-01T00-00-00-000Z.json"),
  JSON.stringify({ dokumentstatus: { dokument: { ...syntheticDocument, beteckning: "2099:2" } } }));
let wrongCachedIdentityRejected = false;
try {
  await loadCachedDocument(identityCache, "sfs-2099-1", { rawFile: "2099-01-01T00-00-00-000Z.json" });
} catch (error) {
  wrongCachedIdentityRejected = error.message.includes("Cached source identity does not match sfs-2099-1");
}
check("Explicit cached snapshot rejects another SFS identity", wrongCachedIdentityRejected);
let noValidIdentityRejected = false;
try {
  await loadCachedDocument(identityCache, "sfs-2099-1");
} catch (error) {
  noValidIdentityRejected = error.message.includes("No valid cached source snapshot for sfs-2099-1")
    && error.message.includes("2099-01-01T00-00-00-000Z.json");
}
check("Plain lookup refuses a cache with no valid snapshot", noValidIdentityRejected);

const freshCache = await mkdtemp(join(tmpdir(), "lsc-fresh-source-"));
const freshId = "sfs-2099-1";
const freshDocument = { ...syntheticDocument, beteckning: "2099:1" };
let responseTextSuffix = "\nOfficial text wrapper v1";
let responseHtmlSuffix = "\n<!-- Official HTML wrapper v1 -->";
let directTextOverride = null;
let failFormat = null;
let freshTick = 0;
const fakeFetch = async (url) => {
  const format = url.split(".").at(-1);
  if (format === failFormat) throw new Error("Synthetic network failure");
  const body = format === "json"
    ? JSON.stringify({ dokumentstatus: { dokument: freshDocument } })
    : format === "text" ? directTextOverride ?? freshDocument.text + responseTextSuffix : freshDocument.html + responseHtmlSuffix;
  return { ok: true, status: 200, text: async () => body };
};
const freshArgs = {
  sourceId: freshId,
  cacheDir: freshCache,
  fetchImpl: fakeFetch,
  now: () => new Date(Date.UTC(2026, 8, 28, 12, 0, freshTick++)),
};
for (const [name, jsonStatus, jsonDocument] of [
  ["HTTP 503", 503, null],
  ["wrong SFS identity", 200, { ...freshDocument, beteckning: "2099:2" }],
  ["missing consolidated text", 200, { ...freshDocument, text: null }],
  ["valid official JSON", 200, freshDocument],
]) {
  const cacheDir = await mkdtemp(join(tmpdir(), "lsc-orient-cache-"));
  const orientFetch = async (url) => {
    const format = url.split(".").at(-1);
    const status = format === "json" ? jsonStatus : 200;
    const body = format === "json"
      ? jsonDocument ? JSON.stringify({ dokumentstatus: { dokument: jsonDocument } }) : "<html>503</html>"
      : format === "text" ? freshDocument.text : freshDocument.html;
    return { ok: status === 200, status, text: async () => body };
  };
  const result = await inspectSource(freshId, [], cacheDir, orientFetch);
  const jsonFiles = (await readdir(join(cacheDir, freshId))).filter((file) => file.endsWith(".json"));
  const valid = name === "valid official JSON";
  check(`Orientation ${valid ? "saves" : "does not save"} ${name}`,
    result.retrieval_status === (valid ? "retrieved" : "unknown")
    && jsonFiles.length === (valid ? 1 : 0));
}
let brokenCache;
let recoveredFresh;
for (const [name, invalidBody] of [
  ["malformed JSON", "<html>503</html>"],
  ["missing text", JSON.stringify({ dokumentstatus: { dokument: { beteckning: "2099:1" } } })],
  ["wrong SFS identity", JSON.stringify({ dokumentstatus: { dokument: { ...freshDocument, beteckning: "2099:2" } } })],
]) {
  const cacheDir = await mkdtemp(join(tmpdir(), "lsc-broken-cache-"));
  await mkdir(join(cacheDir, freshId));
  await writeFile(join(cacheDir, freshId, "2026-01-01T00-00-00-000Z.json"), invalidBody);
  const recovered = await fetchAndPinOfficialSource({ ...freshArgs, cacheDir });
  check(`Fresh lookup recovers from cached ${name}`,
    recovered.status === "first_snapshot"
    && recovered.prior_snapshot_ignored === true
    && (await loadCachedDocument(cacheDir, freshId)).rawFile === recovered.source_snapshot);
  if (name === "malformed JSON") {
    brokenCache = cacheDir;
    recoveredFresh = recovered;
  }
}
const invalidNewerFile = "2099-01-01T00-00-00-000Z.json";
await writeFile(join(brokenCache, freshId, invalidNewerFile), "<html>503</html>");
const comparedWithLastGood = await fetchAndPinOfficialSource({ ...freshArgs, cacheDir: brokenCache });
const comparedIndex = await writeIndex(brokenCache, freshId, { rawFile: comparedWithLastGood.source_snapshot });
check("Fresh lookup compares with the last valid pin despite a broken newer file",
  comparedWithLastGood.status === "verified_unchanged"
  && comparedWithLastGood.compared_snapshot === recoveredFresh.source_snapshot
  && comparedWithLastGood.source_snapshot === recoveredFresh.source_snapshot
  && comparedWithLastGood.ignored_snapshots.includes(invalidNewerFile)
  && comparedIndex.rawFile === comparedWithLastGood.source_snapshot);
const plainPacket = (cacheDir) => JSON.parse(execFileSync(process.execPath, [
  new URL("../connector/get_provision.mjs", import.meta.url).pathname,
  "--source", freshId, "--locator", "1 kap. 1 §",
  "--cache-dir", cacheDir, "--run-dir", join(cacheDir, "runs"),
], { encoding: "utf8" }));
const cachedAfterBroken = await writeIndex(brokenCache, freshId);
const plainAfterBroken = plainPacket(brokenCache);
check("Plain lookup skips a newer malformed JSON and reuses the valid index",
  cachedAfterBroken.reused === true
  && cachedAfterBroken.rawFile === recoveredFresh.source_snapshot
  && plainAfterBroken.status === "found"
  && plainAfterBroken.source_snapshot === recoveredFresh.source_snapshot
  && plainAfterBroken.cached_snapshot_ignored === true
  && JSON.stringify(plainAfterBroken.ignored_snapshots) === JSON.stringify([invalidNewerFile])
  && (JSON.parse(await readFile(join(brokenCache, freshId, "index.json"), "utf8"))).raw_file === recoveredFresh.source_snapshot);
const wrongIdentityCache = await mkdtemp(join(tmpdir(), "lsc-wrong-identity-after-valid-"));
await mkdir(join(wrongIdentityCache, freshId));
await writeFile(join(wrongIdentityCache, freshId, recoveredFresh.source_snapshot),
  await readFile(join(brokenCache, freshId, recoveredFresh.source_snapshot), "utf8"));
await writeFile(join(wrongIdentityCache, freshId, invalidNewerFile),
  JSON.stringify({ dokumentstatus: { dokument: { ...freshDocument, beteckning: "2099:2" } } }));
const plainAfterWrongIdentity = plainPacket(wrongIdentityCache);
check("Plain lookup skips a newer wrong-identity JSON",
  plainAfterWrongIdentity.status === "found"
  && plainAfterWrongIdentity.source_snapshot === recoveredFresh.source_snapshot
  && plainAfterWrongIdentity.cached_snapshot_ignored === true
  && JSON.stringify(plainAfterWrongIdentity.ignored_snapshots) === JSON.stringify([invalidNewerFile]));
freshDocument.text += "\nChanged after the last valid pin.";
const changedAfterBroken = await fetchAndPinOfficialSource({ ...freshArgs, cacheDir: brokenCache });
check("Fresh lookup reports drift from the last valid pin despite a broken newer file",
  changedAfterBroken.status === "changed"
  && changedAfterBroken.compared_snapshot === recoveredFresh.source_snapshot
  && changedAfterBroken.changed_fields.includes("source_text_sha256"));
freshDocument.text = syntheticDocument.text;
const firstFresh = await fetchAndPinOfficialSource(freshArgs);
const sameFresh = await fetchAndPinOfficialSource(freshArgs);
check("Fresh lookup pins first source and reuses an unchanged snapshot",
  firstFresh.status === "first_snapshot"
  && sameFresh.status === "verified_unchanged"
  && sameFresh.source_snapshot === firstFresh.source_snapshot
  && (await loadCachedDocument(freshCache, freshId)).rawFile === firstFresh.source_snapshot);
freshDocument.subtitel = "t.o.m. SFS 2099:2";
const changedMarker = await fetchAndPinOfficialSource(freshArgs);
check("Changed publisher amendment marker preserves a new snapshot",
  changedMarker.status === "changed"
  && changedMarker.changed_fields.includes("consolidation_signal")
  && changedMarker.source_snapshot !== firstFresh.source_snapshot);
freshDocument.text += "\nAdditional wording.";
const changedFresh = await fetchAndPinOfficialSource(freshArgs);
check("Changed official wording creates a new snapshot even with the same amendment label",
  changedFresh.status === "changed"
  && changedFresh.changed_fields.includes("source_text_sha256")
  && changedFresh.source_snapshot !== firstFresh.source_snapshot);
responseHtmlSuffix = "\n<!-- Official HTML wrapper v2 -->";
const changedHtml = await fetchAndPinOfficialSource(freshArgs);
check("A changed direct HTML response is included in the fresh comparison",
  changedHtml.status === "changed"
  && changedHtml.changed_fields.includes("response_html_sha256")
  && changedHtml.source_snapshot !== changedFresh.source_snapshot);
freshDocument.html += '<a class="paragraf" name="K2P2"><b>2 §</b></a>';
const changedEmbeddedHtml = await fetchAndPinOfficialSource(freshArgs);
check("Changed HTML anchors invalidate the pinned structural snapshot",
  changedEmbeddedHtml.status === "changed"
  && changedEmbeddedHtml.changed_fields.includes("source_html_sha256"));
failFormat = "html";
let freshFailed = false;
try { await fetchAndPinOfficialSource(freshArgs); } catch { freshFailed = true; }
check("Failed fresh retrieval does not promote a partial source to latest",
  freshFailed && (await loadCachedDocument(freshCache, freshId)).rawFile === changedEmbeddedHtml.source_snapshot);
failFormat = null;
freshDocument.beteckning = "2099:2";
let identityRejected = false;
try { await fetchAndPinOfficialSource(freshArgs); } catch { identityRejected = true; }
check("A mismatched official identity cannot replace the latest snapshot",
  identityRejected && (await loadCachedDocument(freshCache, freshId)).rawFile === changedEmbeddedHtml.source_snapshot);
freshDocument.beteckning = "2099:1";
responseHtmlSuffix = '<a class="paragraf" name="K9P9"><b>9 §</b></a>';
let formatMismatchRejected = false;
try { await fetchAndPinOfficialSource(freshArgs); } catch { formatMismatchRejected = true; }
check("Disagreeing direct and embedded provision maps cannot replace the snapshot",
  formatMismatchRejected && (await loadCachedDocument(freshCache, freshId)).rawFile === changedEmbeddedHtml.source_snapshot);
responseHtmlSuffix = "\n<!-- Official HTML wrapper v2 -->";
directTextOverride = freshDocument.text.replace("First rule.", "Different rule.") + responseTextSuffix;
let wordingMismatchRejected = false;
try { await fetchAndPinOfficialSource(freshArgs); } catch { wordingMismatchRejected = true; }
check("Matching section maps cannot conceal different direct source wording",
  wordingMismatchRejected && (await loadCachedDocument(freshCache, freshId)).rawFile === changedEmbeddedHtml.source_snapshot);

const summary = {
  test_suite: "synthetic-core-v0.1",
  generated_at: new Date().toISOString(),
  total: results.length,
  passed: results.filter((result) => result.status === "pass").length,
  failed: results.filter((result) => result.status === "fail").length,
  results,
};
const runsDir = new URL("../runs/", import.meta.url).pathname;
await mkdir(runsDir, { recursive: true });
const receiptPath = join(runsDir, `synthetic-core-${summary.generated_at.replaceAll(/[:.]/g, "-")}.json`);
await writeFile(receiptPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receipt: receiptPath, ...summary }, null, 2));
if (summary.failed > 0) process.exitCode = 1;
