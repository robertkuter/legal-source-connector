#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDecisionTemplate,
  finalizeReviewDecision,
  importReviewDecision,
  prepareLocatorReview,
  prepareLocatorReviewSurface,
} from "../connector/locator_review.mjs";
import { prepareLocatorReviewBundle, renderReviewHtml } from "../connector/prepare_locator_review.mjs";
import { buildReviewOrientation } from "../connector/review_orientation.mjs";
import { completeLocatorReview } from "../connector/serve_locator_review.mjs";
import { loadCachedDocument, sha256 } from "../connector/sfs_index.mjs";
import { requireCachedSources } from "./cache_requirements.mjs";

const cacheDir = new URL("../cache/riksdagen/", import.meta.url).pathname;
const getProvisionPath = new URL("../connector/get_provision.mjs", import.meta.url).pathname;
const importReviewPath = new URL("../connector/import_review_decision.mjs", import.meta.url).pathname;
if (!await requireCachedSources(cacheDir, [
  "sfs-1995-1554",
  "sfs-1960-729",
  "sfs-1972-207",
  "sfs-2008-579",
])) process.exit(2);

const tempRoot = await mkdtemp(join(tmpdir(), "locator-review-cached-"));
// The URL timing cases intentionally use the pre-2026-09-01 publisher snapshot.
// Pin it so a later live cache refresh cannot silently change their meaning.
const urlCacheDir = join(tempRoot, "pinned-url-cache");
const urlSourceDir = join(urlCacheDir, "sfs-1960-729");
const urlSnapshot = "2026-08-24T13-02-29-802Z";
await mkdir(urlSourceDir, { recursive: true });
for (const format of ["json", "text", "html"]) {
  await copyFile(
    join(cacheDir, "sfs-1960-729", `${urlSnapshot}.${format}`),
    join(urlSourceDir, `${urlSnapshot}.${format}`),
  );
}
const storeDir = join(tempRoot, "store");
const runDir = join(tempRoot, "runs");
const caseDir = join(tempRoot, "cases");
const results = [];
function check(name, passed, details = {}) {
  results.push({ ...details, name, status: passed ? "pass" : "fail" });
}

const cases = [
  {
    sourceId: "sfs-1995-1554",
    locator: "7 kap. 7 §",
    unreleasedLocator: "7 kap. 8 §",
    expectedAnchor: "K7P7",
    expectedNextAnchor: "K7P8",
    expectedInterveningSections: ["3 a", "4", "5", "6", "7"],
    expectedCounts: [217, 222],
  },
  {
    sourceId: "sfs-1960-729",
    locator: "6 b kap. 52 i §",
    unreleasedLocator: "1 kap. 1 §",
    expectedAnchor: "K6bP52i",
    expectedNextAnchor: "K6bP52j",
    expectedInterveningSections: [],
    expectedCounts: [192, 197],
  },
];

for (const [position, testCase] of cases.entries()) {
  const caseCacheDir = testCase.sourceId === "sfs-1960-729" ? urlCacheDir : cacheDir;
  const cached = await loadCachedDocument(caseCacheDir, testCase.sourceId);
  if (position === 0) {
    const prepared = await prepareLocatorReviewBundle({
      sourceId: testCase.sourceId,
      locator: testCase.locator,
      cacheDir: caseCacheDir,
      outputDir: join(tempRoot, "prepared"),
      caseDir,
    });
    check("One-command handoff prepares the exact review page",
      prepared.status === "prepared"
      && prepared.review_disposition.status === "decision_available"
      && prepared.canonical_locator === testCase.locator
      && (await readFile(prepared.open_target, "utf8")).includes("Save review locally"));
  }
  const artifact = prepareLocatorReview({
    sourceId: testCase.sourceId,
    requestedLocator: testCase.locator,
    document: cached.document,
    rawFile: cached.rawFile,
    preparedAt: `2026-09-08T12:0${position}:00.000Z`,
  });
  const orientation = buildReviewOrientation(artifact);
  const html = renderReviewHtml(artifact, createDecisionTemplate(artifact));
  check(`${testCase.sourceId} uses the matching short orientation`,
    orientation.kind === (position === 0 ? "intervening_text" : "reproducible_boundary")
    && orientation.evidenceTarget === (position === 0 ? "trigger-evidence" : null)
    && (position === 0
      ? html.includes("See the yellow-highlighted source lines")
        && html.includes('href="#trigger-evidence"')
      : !html.includes('id="source-mismatch"')
        && html.includes(`Inspect ${testCase.locator} only`)));
  check(`${testCase.sourceId} prepares exact cached locator evidence`,
    artifact.automatic_capability.status === "review_required"
    && artifact.automatic_capability.html_anchor_count === testCase.expectedCounts[0]
    && artifact.automatic_capability.text_candidate_count === testCase.expectedCounts[1]
    && artifact.publisher_anchor.name === testCase.expectedAnchor
    && artifact.publisher_anchor.source_markup.includes(`name="${testCase.expectedAnchor}"`)
    && artifact.boundary.next_publisher_anchor.name === testCase.expectedNextAnchor
    && artifact.review_context.next_publisher_candidate.section
      === artifact.boundary.next_publisher_anchor.section
    && JSON.stringify(artifact.review_context.intervening_text_candidates.map((item) => item.section))
      === JSON.stringify(testCase.expectedInterveningSections)
    && artifact.review_context.reading_views[0].flagged_lines.length
      === testCase.expectedInterveningSections.length
    && artifact.review_context.reading_views[0].source_lines.some((item) =>
      item.line === artifact.review_context.next_publisher_candidate.start_line)
    && sha256(artifact.provision_text) === artifact.provision_text_sha256, {
    capability: artifact.automatic_capability,
    anchor: artifact.publisher_anchor,
  });
  const decision = finalizeReviewDecision({
    ...createDecisionTemplate(artifact),
    decision_status: "confirmed",
    reviewer: {
      label: "Cached-source acceptance fixture",
      reviewed_at: `2026-09-08T12:1${position}:00.000Z`,
      rationale: "Acceptance fixture confirms the exact cached text, publisher anchor, neighboring boundary and hashes for this locator only.",
    },
  });
  let imported;
  if (position === 0) {
    imported = await importReviewDecision({
      artifact,
      decision,
      sourceId: testCase.sourceId,
      document: cached.document,
      rawFile: cached.rawFile,
      storeDir,
    });
  } else {
    const artifactPath = join(tempRoot, `${testCase.sourceId}-artifact.json`);
    const decisionPath = join(tempRoot, `${testCase.sourceId}-decision.json`);
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    await writeFile(decisionPath, `${JSON.stringify(decision, null, 2)}\n`, "utf8");
    imported = JSON.parse(execFileSync(process.execPath, [
      importReviewPath,
      "--artifact", artifactPath,
      "--decision", decisionPath,
      "--cache-dir", caseCacheDir,
      "--review-store", storeDir,
    ], { encoding: "utf8" }));
  }
  check(`${testCase.sourceId} completed cached decision imports`, imported.status === "imported", {
    import_status: imported.status,
    decision_record_sha256: imported.decision_record_sha256,
  });

  const packet = JSON.parse(execFileSync(process.execPath, [
    getProvisionPath,
    "--source", testCase.sourceId,
    "--locator", testCase.locator,
    "--cache-dir", caseCacheDir,
    "--review-store", storeDir,
    "--run-dir", runDir,
    "--case-dir", caseDir,
  ], { encoding: "utf8" }));
  check(`${testCase.sourceId} normal lookup returns only the reviewed locator`,
    packet.status === "found"
    && packet.basis === "human_reviewed_snapshot"
    && packet.capability.status === "review_required"
    && packet.review.status === "valid"
    && packet.review.scope === "locator"
    && packet.canonical_locator === testCase.locator
    && packet.anchor_name === testCase.expectedAnchor
    && sha256(packet.text) === packet.section_sha256
    && packet.review.decision_record_sha256 === decision.decision_record_sha256, {
    packet_status: packet.status,
    basis: packet.basis,
    capability: packet.capability,
    review: packet.review,
  });

  if (position === 0) {
    const completed = await completeLocatorReview({
      artifact, decision, cacheDir: caseCacheDir, storeDir, runDir, caseDir,
    });
    check("Local save uses the shared validator and retries the exact locator",
      completed.status === "completed"
      && completed.import_status === "imported"
      && completed.lookup_status === "found"
      && completed.result_basis === "human_reviewed_snapshot"
      && completed.automatic_capability === "review_required"
      && completed.fresh_check_performed === false
      && completed.next_step_for_current_wording.command.join(" ").includes("get_provision.mjs --fresh")
      && completed.next_step_for_current_wording.instruction.includes("pinned local snapshot")
      && completed.packet.retrieval_mode === "cached_snapshot"
      && completed.packet.canonical_locator === testCase.locator);
  }

  const unreleased = JSON.parse(execFileSync(process.execPath, [
    getProvisionPath,
    "--source", testCase.sourceId,
    "--locator", testCase.unreleasedLocator,
    "--cache-dir", caseCacheDir,
    "--review-store", storeDir,
    "--run-dir", runDir,
    "--case-dir", caseDir,
  ], { encoding: "utf8" }));
  check(`${testCase.sourceId} review does not release another locator`,
    unreleased.status === "unknown"
    && unreleased.capability.status === "review_required"
    && unreleased.review.valid_decision_found === false
    && ["decision_available", "explanation_only", "unsupported_pattern"].includes(unreleased.review_action.disposition)
    && unreleased.review_action.operation === "prepare_locator_review"
    && unreleased.review_action.source_observation?.use === "reading_only"
    && unreleased.review_action.source_observation?.candidates?.length >= 1
    && !Object.hasOwn(unreleased, "text"), {
    requested_locator: testCase.unreleasedLocator,
    packet_status: unreleased.status,
    review: unreleased.review,
  });
}

const copyright = await loadCachedDocument(urlCacheDir, "sfs-1960-729");
let cachedTemporalRejected = false;
try {
  prepareLocatorReview({
    sourceId: "sfs-1960-729",
    requestedLocator: "2 a kap. 26 n §",
    document: copyright.document,
    rawFile: copyright.rawFile,
  });
} catch (error) {
  cachedTemporalRejected = error.message.includes("I:/U:");
}
check("Cached URL I:/U: locator cannot be released by structural review", cachedTemporalRejected);
const copyrightTransition = prepareLocatorReviewSurface({
  sourceId: "sfs-1960-729",
  requestedLocator: "2 a kap. 26 n §",
  document: copyright.document,
  rawFile: copyright.rawFile,
  preparedAt: "2026-09-08T12:25:00.000Z",
});
const copyrightTransitionPacket = JSON.parse(execFileSync(process.execPath, [
  getProvisionPath,
  "--source", "sfs-1960-729",
  "--locator", "2 a kap. 26 n §",
  "--cache-dir", urlCacheDir,
  "--review-store", storeDir,
  "--run-dir", runDir,
  "--case-dir", caseDir,
], { encoding: "utf8" }));
check("Source-map mismatch still exposes both marked URL text candidates without selecting either",
  copyrightTransition.review_disposition.status === "explanation_only"
  && copyrightTransition.explanation_context.reading_views.length === 2
  && copyrightTransition.explanation_context.reading_views.every((view) => view.evidence_status === "provisional_text_candidate")
  && copyrightTransition.explanation_context.reading_views[0].source_text.includes("Ny beteckning 26 q §")
  && copyrightTransition.explanation_context.reading_views[1].temporal_marker?.kind === "enters_on"
  && copyrightTransitionPacket.status === "unknown"
  && !Object.hasOwn(copyrightTransitionPacket, "text")
  && copyrightTransitionPacket.review_action.source_observation.status === "unselected_text_candidates"
  && copyrightTransitionPacket.review_action.source_observation.candidates.length === 2
  && copyrightTransitionPacket.review_action.source_observation.candidates.every((candidate) => candidate.excerpt)
  && copyrightTransitionPacket.review_action.source_observation.candidates[1].temporal_marker?.kind === "enters_on");

const damages = await loadCachedDocument(cacheDir, "sfs-1972-207");
const damagesExplanation = prepareLocatorReviewSurface({
  sourceId: "sfs-1972-207",
  requestedLocator: "3 kap. 5 §",
  document: damages.document,
  rawFile: damages.rawFile,
  preparedAt: "2026-09-08T12:30:00.000Z",
});
const damagesHtml = renderReviewHtml(damagesExplanation, null);
const damagesOrientation = buildReviewOrientation(damagesExplanation);
const damagesPacket = JSON.parse(execFileSync(process.execPath, [
  getProvisionPath,
  "--source", "sfs-1972-207",
  "--locator", "3 kap. 5 §",
  "--cache-dir", cacheDir,
  "--review-store", storeDir,
  "--run-dir", runDir,
  "--case-dir", caseDir,
], { encoding: "utf8" }));
check("Skadeståndslagen duplicate I:/U: versions produce explanation only",
  damagesExplanation.automatic_capability.status === "supported"
  && damagesExplanation.review_disposition.status === "explanation_only"
  && damagesExplanation.explanation_context.matching_publisher_anchors.length === 2
  && damagesExplanation.explanation_context.matching_text_candidates.length === 2
  && damagesExplanation.explanation_context.reading_views.length === 2
  && damagesExplanation.review_signals.some((signal) => signal.kind === "temporal_layer" && signal.blocks_decision)
  && damagesHtml.includes("Temporal versions")
  && damagesHtml.includes("Source candidate 1 of 2")
  && damagesHtml.includes("Numbered source view")
  && damagesHtml.includes("Reader view")
  && damagesHtml.includes("Upphör att gälla U:2026-09-01")
  && damagesHtml.includes("Träder i kraft I:2026-09-01")
  && damagesPacket.status === "ambiguous"
  && damagesPacket.review_action.disposition === "explanation_only"
  && damagesPacket.review_action.decision_allowed === false
  && damagesPacket.review_action.source_observation.status === "unselected_text_candidates"
  && damagesPacket.review_action.source_observation.candidates.length === 2
  && damagesPacket.review_action.source_observation.candidates.every((candidate) => candidate.excerpt && candidate.temporal_marker)
  && !Object.hasOwn(damagesPacket, "text")
  && damagesPacket.review_action.case_report.report_kind === "capability_need"
  && damagesPacket.review_action.case_report.local_record_status === "recorded"
  && !damagesHtml.includes('id="confirm"'));
check("Temporal orientation points to unselected evidence without enabling review",
  damagesOrientation.kind === "temporal_versions"
  && damagesOrientation.evidenceTarget === "source-evidence"
  && damagesHtml.includes('href="#source-evidence"')
  && damagesHtml.includes("Compare the unselected source candidates")
  && !damagesHtml.includes('id="confirm"'));

const competition = await loadCachedDocument(cacheDir, "sfs-2008-579");
const renumberingExplanation = prepareLocatorReviewSurface({
  sourceId: "sfs-2008-579",
  requestedLocator: "4 kap. 16 a §",
  document: competition.document,
  rawFile: competition.rawFile,
  preparedAt: "2026-09-08T12:31:00.000Z",
});
const renumberingHtml = renderReviewHtml(renumberingExplanation, null);
const renumberingOrientation = buildReviewOrientation(renumberingExplanation);
const renumberingPacket = JSON.parse(execFileSync(process.execPath, [
  getProvisionPath,
  "--source", "sfs-2008-579",
  "--locator", "4 kap. 16 a §",
  "--cache-dir", cacheDir,
  "--review-store", storeDir,
  "--run-dir", runDir,
  "--case-dir", caseDir,
], { encoding: "utf8" }));
check("Konkurrenslagen duplicate publisher identity and renumbering notice produce explanation only",
  renumberingExplanation.automatic_capability.status === "supported"
  && renumberingExplanation.review_disposition.status === "explanation_only"
  && renumberingExplanation.explanation_context.reading_views.length === 2
  && renumberingExplanation.review_signals.some((signal) => signal.kind === "duplicate_publisher_identity" && signal.blocks_decision)
  && renumberingExplanation.review_signals.some((signal) => signal.kind === "renumbering_editorial_notice" && signal.blocks_decision)
  && renumberingHtml.includes("Duplicate publisher identity")
  && renumberingHtml.includes("Renumbering notice")
  && renumberingHtml.includes("Ny beteckning 17 § genom lag (2017:986)")
  && renumberingHtml.includes("Editorial renumbering notice")
  && renumberingHtml.includes("Substantive same-locator candidate")
  && renumberingHtml.includes("Reading stops before")
  && renumberingPacket.status === "ambiguous"
  && renumberingPacket.review_action.disposition === "explanation_only"
  && renumberingPacket.review_action.source_observation.status === "unselected_text_candidates"
  && renumberingPacket.review_action.source_observation.candidates.length === 2
  && !Object.hasOwn(renumberingPacket, "text")
  && renumberingPacket.review_action.signal_kinds.includes("renumbering_editorial_notice")
  && renumberingPacket.review_action.case_report.report_kind === "capability_need"
  && renumberingPacket.review_action.case_report.case_id.startsWith("lscase-")
  && renumberingHtml.includes("No decision questions, Save review button or force option is available")
  && !renumberingHtml.includes('id="download"'));
check("Renumbering orientation names the notice and keeps confirmation unavailable",
  renumberingOrientation.kind === "renumbering_notice"
  && renumberingHtml.includes("editorial renumbering notice alongside another passage")
  && !renumberingHtml.includes('id="confirm"'));

const summary = {
  test_suite: "locator-review-cached-v1",
  generated_at: new Date().toISOString(),
  temp_artifacts: "isolated operating-system temporary directory; not retained in Git",
  total: results.length,
  passed: results.filter((result) => result.status === "pass").length,
  failed: results.filter((result) => result.status === "fail").length,
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
