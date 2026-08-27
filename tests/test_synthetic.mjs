#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assessComparison } from "../connector/staleness_logic.mjs";
import { safeFileSegment } from "../connector/runtime.mjs";
import {
  buildIndex,
  loadCachedDocument,
  parseLocator,
  parseTemporalMarker,
  provisionTemporalState,
  sha256,
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
