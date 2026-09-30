#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listReviewCases } from "./review_case_report.mjs";
import { defaultReviewCaseDir, resolveUserPath } from "./runtime.mjs";

function parseArgs(items) {
  const result = { caseDir: defaultReviewCaseDir() };
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] === "--case-dir") result.caseDir = resolveUserPath(items[++i], result.caseDir);
  }
  return result;
}

export async function main(items = process.argv.slice(2)) {
  const args = parseArgs(items);
  const records = await listReviewCases(args.caseDir);
  console.log(JSON.stringify({
    status: "listed",
    register_scope: "local_gitignored_review_cases",
    case_count: records.length,
    cases: records.map((record) => ({
      case_id: record.case_id,
      state: record.state,
      report_kind: record.latest_report.report_kind,
      authority_id: record.latest_report.source.authority_id,
      canonical_locator: record.latest_report.locator.canonical,
      reason_codes: record.latest_report.blocker.reason_codes,
      first_seen_at: record.first_seen_at,
      last_seen_at: record.last_seen_at,
      occurrence_count: record.occurrence_count,
    })),
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
