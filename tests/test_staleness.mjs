import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assessComparison } from "../connector/staleness_logic.mjs";

const sourceId = "sfs-2008-567";
const baseline = {
  authority_id: sourceId,
  sfs_number: "2008:567",
  source_text_sha256: "hash-a",
  consolidation_signal: "t.o.m. SFS 2025:736",
};

const retrieved = {
  retrieval_status: "retrieved",
  sfs_number: "2008:567",
  document_text_sha256: "hash-a",
  consolidation_signal: "Ändrad: t.o.m. SFS 2025:736",
};

const cases = [
  {
    name: "Matching source remains current",
    expected: "current",
    current: retrieved,
  },
  {
    name: "Changed complete text is stale",
    expected: "stale",
    current: { ...retrieved, document_text_sha256: "hash-b" },
  },
  {
    name: "Changed consolidation marker is stale",
    expected: "stale",
    current: { ...retrieved, consolidation_signal: "Ändrad: t.o.m. SFS 2026:1" },
  },
  {
    name: "Failed retrieval is unknown",
    expected: "unknown",
    current: { ...retrieved, retrieval_status: "unknown", document_text_sha256: null },
  },
  {
    name: "Different SFS identity is unknown",
    expected: "unknown",
    current: { ...retrieved, sfs_number: "1915:218" },
  },
  {
    name: "Baseline without complete hash is unknown",
    expected: "unknown",
    baseline: { ...baseline, source_text_sha256: null },
    current: retrieved,
  },
];

const results = cases.map(({ name, expected, current, baseline: caseBaseline }) => {
  const result = assessComparison({
    baseline: caseBaseline ?? baseline,
    current,
    sourceId,
  });
  return {
    name,
    status: result.status === expected ? "pass" : "fail",
    expected,
    actual: result.status,
    reason: result.reason,
  };
});

const summary = {
  test_suite: "staleness-decision-logic-v0.1",
  generated_at: new Date().toISOString(),
  total: results.length,
  passed: results.filter((result) => result.status === "pass").length,
  failed: results.filter((result) => result.status === "fail").length,
  baseline_unchanged: JSON.stringify(baseline) === JSON.stringify({
    authority_id: sourceId,
    sfs_number: "2008:567",
    source_text_sha256: "hash-a",
    consolidation_signal: "t.o.m. SFS 2025:736",
  }),
  results,
};

const runsDir = new URL("../runs/", import.meta.url).pathname;
await mkdir(runsDir, { recursive: true });
const receiptPath = join(
  runsDir,
  `staleness-logic-${summary.generated_at.replaceAll(/[:.]/g, "-")}.json`,
);
await writeFile(receiptPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receipt: receiptPath, ...summary }, null, 2));

if (summary.failed > 0 || !summary.baseline_unchanged) process.exitCode = 1;
