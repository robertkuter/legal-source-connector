#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
import {
  createDecisionTemplate,
  finalizeReviewDecision,
  findValidLocatorReview,
  importReviewDecision,
  prepareLocatorReview,
  prepareLocatorReviewSurface,
  validateReviewDecision,
} from "../connector/locator_review.mjs";
import { renderReviewHtml } from "../connector/prepare_locator_review.mjs";
import { buildReviewOrientation, buildReviewQuestions } from "../connector/review_orientation.mjs";
import {
  createReviewCaseReport,
  listReviewCases,
  recordReviewCase,
  renderGitHubIssueDraft,
  validateReviewCaseReport,
} from "../connector/review_case_report.mjs";
import { createReviewServer } from "../connector/serve_locator_review.mjs";

const results = [];
function check(name, passed, details = {}) {
  results.push({ name, status: passed ? "pass" : "fail", ...details });
}

const decisionSchema = JSON.parse(await readFile(
  new URL("../schemas/locator-review-decision.v1.1.schema.json", import.meta.url),
  "utf8",
));
check("Versioned decision schema is well-formed and locator-scoped",
  decisionSchema.properties.schema_version.const === "1.1.0"
  && decisionSchema.properties.review_scope.const === "locator"
  && decisionSchema.properties.source.required.includes("source_html_sha256")
  && decisionSchema.required.includes("decision_record_sha256"));

const caseReportSchema = JSON.parse(await readFile(
  new URL("../schemas/review-case-report.v1.schema.json", import.meta.url),
  "utf8",
));
check("Versioned case-report schema is privacy-safe and retrieval-blocked",
  caseReportSchema.properties.schema_version.const === "1.0.0"
  && caseReportSchema.properties.workflow_status.const === "retrieval_withheld"
  && caseReportSchema.additionalProperties === false
  && !JSON.stringify(caseReportSchema).includes("provision_text"));

const annualAccountsStyle = {
  titel: "Synthetic ÅRL boundary case",
  beteckning: "synthetic:arl",
  subtitel: "synthetic snapshot",
  text: [
    "1 kap. Regler",
    "",
    "1 § Första regeln.",
    "",
    "2 § Hänvisningar följer.",
    "",
    "2 § om en annan bestämmelse.",
    "och dess krav.",
    "",
    "3 § Tredje regeln.",
  ].join("\n"),
  html: [
    '<a class="paragraf" name="K1P1"><b>1 §</b></a>',
    '<a class="paragraf" name="K1P2"><b>2 §</b></a>',
    '<a class="paragraf" name="K1P3"><b>3 §</b></a>',
  ].join(""),
};

const copyrightStyle = {
  titel: "Synthetic URL timing case",
  beteckning: "synthetic:url",
  subtitel: "synthetic snapshot",
  text: [
    "2 a kap. Rättigheter",
    "",
    "1 § Första regeln.",
    "",
    "2 § /Träder i kraft I:2030-01-01/",
    "Framtida lydelse.",
    "",
    "2 § /Upphör att gälla U:2030-01-01/",
    "Utgående lydelse.",
    "",
    "3 § En omarkerad regel.",
  ].join("\n"),
  html: [
    '<a class="paragraf" name="K2aP1"><b>1 §</b></a>',
    '<a class="paragraf" name="K2aP2"><b>2 §</b></a>',
    '<a class="paragraf" name="K2aP3"><b>3 §</b></a>',
  ].join(""),
};

const artifact = prepareLocatorReview({
  sourceId: "synthetic-arl",
  requestedLocator: "1 kap. 2 §",
  document: annualAccountsStyle,
  rawFile: "synthetic-arl.json",
  preparedAt: "2026-09-08T10:00:00.000Z",
});
check("ÅRL-style false heading produces a locator artifact while automatic capability remains review_required",
  artifact.automatic_capability.status === "review_required"
  && artifact.review_scope === "locator"
  && artifact.review_disposition.status === "decision_available"
  && artifact.review_disposition.decision_allowed === true
  && artifact.review_signal_vocabulary_version === "1.0.0"
  && artifact.review_signals.some((signal) => signal.kind === "text_only_candidate")
  && artifact.publisher_anchor.name === "K1P2"
  && artifact.publisher_anchor.source_markup === '<a class="paragraf" name="K1P2"><b>2 §</b></a>'
  && artifact.review_context.same_locator_candidates.length === 2
  && artifact.review_context.intervening_text_candidates.length === 1
  && artifact.review_context.intervening_text_candidates[0].start_line === 7
  && artifact.review_context.next_publisher_candidate.start_line === 10
  && artifact.review_context.reading_views.length === 1
  && artifact.review_context.reading_views[0].source_lines.some((item) => item.line === 7 && item.text.includes("om en annan bestämmelse"))
  && artifact.review_context.reading_views[0].source_lines.some((item) => item.line === 10 && item.text.startsWith("3 §"))
  && artifact.boundary.next_publisher_anchor.name === "K1P3"
  && artifact.provision_text.includes("om en annan bestämmelse"));

const template = createDecisionTemplate(artifact);
const reviewHtml = renderReviewHtml(artifact, template);
const orientation = buildReviewOrientation(artifact);
const reviewQuestions = buildReviewQuestions(artifact);
check("Review orientation derives local evidence without changing decision capability",
  orientation.kind === "intervening_text"
  && orientation.localEvidence.includes("source's net +1 count gap")
  && orientation.evidenceTarget === "trigger-evidence"
  && orientation.limit.includes("identity or order warning")
  && artifact.review_disposition.decision_allowed === true);
check("Review questions cover start, intervening lines and stop without preselecting an answer",
  reviewQuestions.map((question) => question.id).join(",") === "start,inside,stop"
  && reviewQuestions[1].text.includes("1 highlighted heading-like line")
  && reviewQuestions[2].text.includes("K1P3")
  && reviewHtml.includes('name="review-inside" value="cannot_confirm"')
  && reviewHtml.includes('id="review-note"')
  && !reviewHtml.includes('type="radio" checked'));
check("Self-contained HTML review bundle exposes the evidence and completion controls",
  reviewHtml.includes("does not change automatic capability")
  && reviewHtml.includes(artifact.publisher_anchor.name)
  && reviewHtml.includes(artifact.provision_text_sha256)
  && reviewHtml.includes("Numbered source view")
  && reviewHtml.includes("Reader view")
  && reviewHtml.includes("Download decision record")
  && reviewHtml.includes("Save review locally")
  && reviewHtml.includes('href="#trigger-evidence"')
  && reviewHtml.includes('id="trigger-evidence"')
  && reviewHtml.includes('crypto.subtle.digest("SHA-256"')
  && !/<(?:link|script)[^>]+(?:src|href)=/i.test(reviewHtml));
const inlineScript = reviewHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
let scriptParses = false;
try { new Script(inlineScript); scriptParses = true; } catch { /* recorded below */ }
check("Review page local-save script parses", scriptParses);
check("Review UI makes scope, retained automatic status and import boundary visible",
  reviewHtml.includes("This review has a hard boundary")
  && reviewHtml.includes("This decision cannot")
  && reviewHtml.includes("release another locator or the full Act")
  && reviewHtml.includes("Only a successful import changes the lookup result for this locator")
  && reviewHtml.includes("Source excerpts and reviewer details stay in the local, gitignored review area"));
check("Review UI teaches anchor, line and offset evidence before asking for a decision",
  reviewHtml.includes('<details class="anchor-primer"')
  && !reviewHtml.includes('aria-label="Review workflow"')
  && reviewHtml.includes("First: what is a publisher anchor?")
  && reviewHtml.includes("An anchor is an invisible bookmark")
  && reviewHtml.includes("Publisher's HTML representation")
  && reviewHtml.includes("Plain-text representation")
  && reviewHtml.includes("The line number helps a person find the passage")
  && reviewHtml.includes("Several lines look like")
  && reviewHtml.includes("No corresponding publisher anchor at this line")
  && reviewHtml.includes("Why this review opened")
  && reviewHtml.includes("matching the source's net +1 count gap")
  && reviewHtml.includes("See both ends of the reviewed provision")
  && reviewHtml.includes("Next anchored provision")
  && reviewHtml.includes("Same-number text; no anchor")
  && reviewHtml.includes("Same words, with source line wrapping removed")
  && reviewHtml.includes("The numbered source lines, offsets and SHA-256 hash remain the evidence")
  && reviewHtml.includes('name=&quot;K1P3&quot;')
  && reviewHtml.includes("Show the signals actually found in this source")
  && reviewHtml.includes("Observed across Act")
  && reviewHtml.includes("Connector response")
  && reviewHtml.includes("Only signals carried by this exact, hashed artifact appear here")
  && !reviewHtml.includes("signed, hash-bound"));

const reviewServerRoot = await mkdtemp(join(tmpdir(), "locator-review-server-"));
const reviewHtmlPath = join(reviewServerRoot, "review.html");
await writeFile(reviewHtmlPath, reviewHtml, "utf8");
const reviewServer = await createReviewServer({
  htmlPath: reviewHtmlPath,
  token: "0123456789abcdef0123456789abcdef0123456789abcdef",
});
try {
  const served = await fetch(reviewServer.url);
  const missing = await fetch(`http://${reviewServer.host}:${reviewServer.port}/review/not-the-token`);
  check("Local review server is loopback-only, token-scoped and no-store",
    reviewServer.host === "127.0.0.1"
    && served.status === 200
    && served.headers.get("cache-control") === "no-store"
    && served.headers.get("x-frame-options") === "DENY"
    && (await served.text()).includes("Review one exact provision")
    && missing.status === 404
    && !reviewServer.url.includes("?save=1"));
  const readOnlyPost = await fetch(`${reviewServer.url}/decision`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision_status: "confirmed" }),
  });
  check("File-only viewer has no save endpoint", readOnlyPost.status === 404);
} finally {
  await reviewServer.close();
}
const saveServer = await createReviewServer({
  htmlPath: reviewHtmlPath,
  onDecision: async (decision) => ({
    status: decision?.decision_status === "confirmed" ? "completed" : "rejected",
    errors: ["Decision was not confirmed."],
  }),
  token: "0123456789abcdef0123456789abcdef0123456789abcdef",
});
try {
  const decisionUrl = `${saveServer.url.split("?")[0]}/decision`;
  const wrongOrigin = await fetch(decisionUrl, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" },
    body: JSON.stringify({ decision_status: "confirmed" }),
  });
  const wrongRoute = await fetch(`http://${saveServer.host}:${saveServer.port}/review/not-the-token/decision`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision_status: "confirmed" }),
  });
  const saved = await fetch(decisionUrl, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: `http://${saveServer.host}:${saveServer.port}` },
    body: JSON.stringify({ decision_status: "confirmed" }),
  });
  check("Local decision endpoint requires the token and same origin",
    saveServer.url.includes("?save=1")
    && wrongOrigin.status === 403 && wrongRoute.status === 404 && saved.status === 200);
} finally {
  await saveServer.close();
}
const validDecision = finalizeReviewDecision({
  ...template,
  decision_status: "confirmed",
  reviewer: {
    label: "Synthetic reviewer",
    reviewed_at: "2026-09-08T10:05:00.000Z",
    rationale: "Checked the exact anchor, target heading, following anchor, offsets and displayed provision text.",
  },
});
const valid = validateReviewDecision({
  artifact,
  decision: validDecision,
  sourceId: "synthetic-arl",
  document: annualAccountsStyle,
  rawFile: "synthetic-arl.json",
});
check("Complete locator decision validates", valid.valid, { errors: valid.errors });
const differentFilenameValidation = validateReviewDecision({
  artifact,
  decision: validDecision,
  sourceId: "synthetic-arl",
  document: annualAccountsStyle,
  rawFile: "newer-snapshot.json",
});
check("Locator decision remains bound to its exact snapshot filename",
  !differentFilenameValidation.valid
  && differentFilenameValidation.errors.some((error) => error.includes("snapshot filename")));

const changedAnchorArtifact = structuredClone(artifact);
changedAnchorArtifact.publisher_anchor.source_markup = '<a class="paragraf" name="K1P9"><b>9 §</b></a>';
const changedAnchorArtifactValidation = validateReviewDecision({
  artifact: changedAnchorArtifact,
  decision: validDecision,
  sourceId: "synthetic-arl",
  document: annualAccountsStyle,
  rawFile: "synthetic-arl.json",
});
check("Exact publisher anchor markup is protected by the artifact hash",
  !changedAnchorArtifactValidation.valid
  && changedAnchorArtifactValidation.errors.some((error) => error.includes("artifact hash")));

function changedDecision(change) {
  const copy = structuredClone(validDecision);
  change(copy);
  return finalizeReviewDecision(copy);
}

const rejectionCases = [
  ["Incomplete decision is rejected", changedDecision((item) => { delete item.reviewer.rationale; })],
  ["Unresolved decision is rejected", changedDecision((item) => { item.decision_status = "unresolved"; })],
  ["Wrong source is rejected", changedDecision((item) => { item.source.authority_id = "synthetic-other"; })],
  ["Wrong locator is rejected", changedDecision((item) => { item.locator.canonical = "1 kap. 3 §"; })],
  ["Changed text hash is rejected", changedDecision((item) => { item.source.source_text_sha256 = "0".repeat(64); })],
  ["Changed HTML hash is rejected", changedDecision((item) => { item.source.source_html_sha256 = "1".repeat(64); })],
  ["Changed connector-review version is rejected", changedDecision((item) => { item.implementation.connector_review_version = "9.0.0"; })],
  ["Changed index version is rejected", changedDecision((item) => { item.implementation.index_version = "999"; })],
  ["Changed decision schema is rejected", changedDecision((item) => { item.schema_version = "2.0.0"; })],
  ["Inconsistent boundary is rejected", changedDecision((item) => { item.source_offsets.end_exclusive += 1; })],
  ["Provision hash mismatch is rejected", changedDecision((item) => { item.provision_text_sha256 = "2".repeat(64); })],
  ["Source-wide scope leakage is rejected", changedDecision((item) => { item.review_scope = "source_snapshot"; })],
];
for (const [name, decision] of rejectionCases) {
  const validation = validateReviewDecision({
    artifact,
    decision,
    sourceId: "synthetic-arl",
    document: annualAccountsStyle,
    rawFile: "synthetic-arl.json",
  });
  check(name, !validation.valid, { errors: validation.errors });
}

const tamperedHash = structuredClone(validDecision);
tamperedHash.reviewer.rationale += " Tampered after signing.";
const tamperedValidation = validateReviewDecision({
  artifact,
  decision: tamperedHash,
  sourceId: "synthetic-arl",
  document: annualAccountsStyle,
  rawFile: "synthetic-arl.json",
});
check("Changed decision content with a stale decision-record hash is rejected", !tamperedValidation.valid
  && tamperedValidation.errors.some((error) => error.includes("decision-record hash")));

const changedSnapshot = structuredClone(annualAccountsStyle);
changedSnapshot.text += "\nChanged bytes.";
const changedSnapshotValidation = validateReviewDecision({
  artifact,
  decision: validDecision,
  sourceId: "synthetic-arl",
  document: changedSnapshot,
  rawFile: "synthetic-arl.json",
});
check("Changed live snapshot invalidates an otherwise complete decision", !changedSnapshotValidation.valid
  && changedSnapshotValidation.errors.some((error) => error.includes("text snapshot hash")), {
  errors: changedSnapshotValidation.errors,
});
const changedHtmlSnapshot = structuredClone(annualAccountsStyle);
changedHtmlSnapshot.html += "<!-- changed bytes -->";
const changedHtmlSnapshotValidation = validateReviewDecision({
  artifact,
  decision: validDecision,
  sourceId: "synthetic-arl",
  document: changedHtmlSnapshot,
  rawFile: "synthetic-arl.json",
});
check("Changed live HTML snapshot invalidates an otherwise complete decision",
  !changedHtmlSnapshotValidation.valid
  && changedHtmlSnapshotValidation.errors.some((error) => error.includes("HTML snapshot hash")), {
  errors: changedHtmlSnapshotValidation.errors,
});

const tempRoot = await mkdtemp(join(tmpdir(), "locator-review-synthetic-"));
const storeDir = join(tempRoot, "store");
const imported = await importReviewDecision({
  artifact,
  decision: validDecision,
  sourceId: "synthetic-arl",
  document: annualAccountsStyle,
  rawFile: "synthetic-arl.json",
  storeDir,
});
check("Validated decision imports into the isolated local store", imported.status === "imported");
if (imported.status === "imported") {
  const stored = JSON.parse(await readFile(imported.store_path, "utf8"));
  check("Stored record retains artifact and decision hashes",
    stored.artifact.artifact_sha256 === artifact.artifact_sha256
    && stored.decision.decision_record_sha256 === validDecision.decision_record_sha256);
  const tamperedStoreDir = join(tempRoot, "tampered-store");
  await mkdir(tamperedStoreDir, { recursive: true });
  stored.decision.reviewer.rationale += " Changed after import.";
  await writeFile(join(tamperedStoreDir, "tampered.json"), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  const tamperedStoredReview = await findValidLocatorReview({
    storeDir: tamperedStoreDir,
    sourceId: "synthetic-arl",
    requestedLocator: "1 kap. 2 §",
    document: annualAccountsStyle,
    rawFile: "synthetic-arl.json",
  });
  check("Lookup revalidates and rejects a store record changed after import",
    tamperedStoredReview.status === "not_found"
    && tamperedStoredReview.rejected.length === 1
    && tamperedStoredReview.rejected[0].errors.some((error) => error.includes("decision-record hash")));
}
const exactReview = await findValidLocatorReview({
  storeDir,
  sourceId: "synthetic-arl",
  requestedLocator: "1 kap. 2 §",
  document: annualAccountsStyle,
  rawFile: "synthetic-arl.json",
});
await writeFile(join(storeDir, "damaged.json"), JSON.stringify({
  store_schema: "sv_sfs_locator_review_store_record",
  store_schema_version: "1.0.0",
  artifact: null,
  decision: validDecision,
}), "utf8");
const reviewWithDamagedNeighbour = await findValidLocatorReview({
  storeDir,
  sourceId: "synthetic-arl",
  requestedLocator: "1 kap. 2 §",
  document: annualAccountsStyle,
  rawFile: "synthetic-arl.json",
});
check("A damaged decision file cannot hide a valid review for the same locator",
  reviewWithDamagedNeighbour.status === "found"
  && reviewWithDamagedNeighbour.rejected.some((item) => item.file === "damaged.json"));
const leakedReview = await findValidLocatorReview({
  storeDir,
  sourceId: "synthetic-arl",
  requestedLocator: "1 kap. 3 §",
  document: annualAccountsStyle,
  rawFile: "synthetic-arl.json",
});
check("Imported review is reusable only for its exact locator", exactReview.status === "found" && leakedReview.status === "not_found");
const reviewedCacheDir = join(tempRoot, "reviewed-cache");
const reviewedSourceDir = join(reviewedCacheDir, "synthetic-arl");
await mkdir(reviewedSourceDir, { recursive: true });
await writeFile(join(reviewedSourceDir, "synthetic-arl.json"),
  JSON.stringify({ dokumentstatus: { dokument: annualAccountsStyle } }));
await writeFile(join(reviewedSourceDir, "zz-broken.json"), "<html>503</html>");
const reviewedPacket = JSON.parse(execFileSync(process.execPath, [
  new URL("../connector/get_provision.mjs", import.meta.url).pathname,
  "--source", "synthetic-arl", "--locator", "1 kap. 2 §",
  "--cache-dir", reviewedCacheDir, "--review-store", storeDir,
  "--case-dir", join(tempRoot, "cases"), "--run-dir", join(tempRoot, "runs"),
], { encoding: "utf8" }));
check("Plain lookup retains exact reviewed-snapshot binding after skipping a broken newer file",
  reviewedPacket.status === "found"
  && reviewedPacket.basis === "human_reviewed_snapshot"
  && reviewedPacket.source_snapshot === "synthetic-arl.json"
  && JSON.stringify(reviewedPacket.ignored_snapshots) === JSON.stringify(["zz-broken.json"]));

const unmarkedCopyrightArtifact = prepareLocatorReview({
  sourceId: "synthetic-url",
  requestedLocator: "2 a kap. 3 §",
  document: copyrightStyle,
  rawFile: "synthetic-url.json",
  preparedAt: "2026-09-08T11:00:00.000Z",
});
check("URL-style source permits review of an unmarked locator without resolving source timing",
  unmarkedCopyrightArtifact.automatic_capability.status === "review_required"
  && unmarkedCopyrightArtifact.automatic_capability.temporal.status === "layered_unresolved"
  && unmarkedCopyrightArtifact.temporal.resolution === "unmarked_locator"
  && unmarkedCopyrightArtifact.temporal.markers.length === 0);
const letteredReviewHtml = renderReviewHtml(
  unmarkedCopyrightArtifact,
  createDecisionTemplate(unmarkedCopyrightArtifact),
);
check("Anchor explainer preserves lettered chapter encoding without requiring engineer knowledge",
  letteredReviewHtml.includes("K2aP3")
  && letteredReviewHtml.includes("K2a</strong> means chapter 2 a")
  && letteredReviewHtml.includes("P3</strong> means section 3"));
check("A locator without intervening heading-like lines asks only for its two boundaries",
  buildReviewQuestions(unmarkedCopyrightArtifact).map((question) => question.id).join(",") === "start,stop"
  && !letteredReviewHtml.includes('name="review-inside"'));
let temporalRejected = false;
try {
  prepareLocatorReview({
    sourceId: "synthetic-url",
    requestedLocator: "2 a kap. 2 §",
    document: copyrightStyle,
    rawFile: "synthetic-url.json",
  });
} catch (error) {
  temporalRejected = error.message.includes("I:/U:");
}
check("Structural review cannot select between I:/U: marked versions", temporalRejected);

const temporalExplanation = prepareLocatorReviewSurface({
  sourceId: "synthetic-url",
  requestedLocator: "2 a kap. 2 §",
  document: copyrightStyle,
  rawFile: "synthetic-url.json",
  preparedAt: "2026-09-08T11:05:00.000Z",
});
const temporalExplanationHtml = renderReviewHtml(temporalExplanation, null);
const temporalScriptsParse = [...temporalExplanationHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .every((match) => {
    try {
      new Function(match[1]);
      return true;
    } catch {
      return false;
    }
  });
check("A timing-marked locator receives an explanation-only page without decision controls",
  temporalExplanation.review_disposition.status === "explanation_only"
  && temporalExplanation.review_disposition.decision_allowed === false
  && buildReviewQuestions(temporalExplanation).length === 0
  && temporalExplanation.review_signals.some((signal) => signal.kind === "temporal_layer" && signal.blocks_decision)
  && temporalExplanation.explanation_context.reading_views.length === 2
  && temporalExplanation.explanation_context.reading_views.every((view) => view.evidence_status === "provisional_text_candidate" && view.temporal_marker)
  && temporalExplanationHtml.includes("This provision needs a different kind of decision")
  && temporalExplanationHtml.includes("Temporal versions")
  && temporalExplanationHtml.includes("No decision questions, Save review button or force option is available")
  && temporalExplanationHtml.includes("Record capability need")
  && temporalExplanationHtml.includes("Copy safe GitHub report")
  && temporalExplanationHtml.includes("Download private evidence artifact")
  && temporalExplanationHtml.includes("Nothing is uploaded automatically")
  && temporalScriptsParse
  && !temporalExplanationHtml.includes('id="confirm"')
  && !temporalExplanationHtml.includes('id="download"'));

const elapsedTransition = {
  ...copyrightStyle,
  text: copyrightStyle.text.replaceAll("2030-01-01", "2020-01-01"),
};
const elapsedExplanation = prepareLocatorReviewSurface({
  sourceId: "synthetic-url-elapsed",
  requestedLocator: "2 a kap. 2 §",
  document: elapsedTransition,
  rawFile: "synthetic-url-elapsed.json",
  preparedAt: "2026-09-28T12:00:00.000Z",
});
check("Elapsed I:/U: dates remain blocked in a pinned snapshot",
  elapsedExplanation.review_disposition.status === "explanation_only"
  && elapsedExplanation.review_disposition.decision_allowed === false
  && elapsedExplanation.review_signals.some((signal) => signal.kind === "temporal_layer" && signal.blocks_decision)
  && !renderReviewHtml(elapsedExplanation, null).includes('id="confirm"'));

const temporalCaseReport = createReviewCaseReport(temporalExplanation);
const temporalIssueDraft = renderGitHubIssueDraft(temporalCaseReport);
check("Capability report contains reproducible public metadata but no evidence or reviewer fields",
  temporalCaseReport.report_kind === "capability_need"
  && temporalCaseReport.workflow_status === "retrieval_withheld"
  && temporalCaseReport.case_id.startsWith("lscase-")
  && temporalCaseReport.occurrence_id.startsWith("lsocc-")
  && validateReviewCaseReport(temporalCaseReport).length === 0
  && temporalIssueDraft.body.includes(temporalCaseReport.case_id)
  && temporalIssueDraft.body.includes("requires_human_review_before_submission") === false
  && !JSON.stringify(temporalCaseReport).includes("Framtida lydelse")
  && !JSON.stringify(temporalCaseReport).includes('"source_text_sha256"')
  && !JSON.stringify(temporalCaseReport).includes('"source_snapshot"')
  && !JSON.stringify(temporalCaseReport).includes('"reviewer"'));
const unsafeCaseReport = structuredClone(temporalCaseReport);
unsafeCaseReport.source.provision_text = "Matter-derived text must not be shared";
check("Case-report validator rejects fields outside the public allowlist",
  validateReviewCaseReport(unsafeCaseReport).some((error) => error.includes("unexpected field"))
  && validateReviewCaseReport(unsafeCaseReport).some((error) => error.includes("forbidden public field")));

const caseDir = join(tempRoot, "cases");
const firstCaseRecord = await recordReviewCase({ caseDir, report: temporalCaseReport });
const duplicateCaseRecord = await recordReviewCase({ caseDir, report: temporalCaseReport });
const changedOccurrenceArtifact = structuredClone(temporalExplanation);
changedOccurrenceArtifact.source.source_text_sha256 = "a".repeat(64);
const changedOccurrenceReport = createReviewCaseReport(changedOccurrenceArtifact, {
  createdAt: "2026-09-08T11:06:00.000Z",
});
const changedCaseRecord = await recordReviewCase({ caseDir, report: changedOccurrenceReport });
const listedCases = await listReviewCases(caseDir);
check("Local case register deduplicates reruns and counts a changed snapshot as another occurrence",
  firstCaseRecord.status === "recorded"
  && duplicateCaseRecord.status === "updated"
  && duplicateCaseRecord.record.occurrence_count === 1
  && changedOccurrenceReport.case_id === temporalCaseReport.case_id
  && changedOccurrenceReport.occurrence_id !== temporalCaseReport.occurrence_id
  && changedCaseRecord.record.occurrence_count === 2
  && listedCases.length === 1
  && listedCases[0].state === "pending");
let explanationTemplateRejected = false;
try {
  createDecisionTemplate(temporalExplanation);
} catch (error) {
  explanationTemplateRejected = error.message.includes("decision_available");
}
check("Explanation-only artifacts cannot create decision templates", explanationTemplateRejected);

const missingNextStyle = {
  titel: "Synthetic missing boundary case",
  beteckning: "synthetic:missing-boundary",
  subtitel: "synthetic snapshot",
  text: [
    "1 kap. Regler",
    "",
    "1 § Första regeln.",
    "",
    "2 § Andra regeln utan reproducerbar nästa gräns.",
  ].join("\n"),
  html: [
    '<a class="paragraf" name="K1P1"><b>1 §</b></a>',
    '<a class="paragraf" name="K1P2"><b>2 §</b></a>',
    '<a class="paragraf" name="K1P3"><b>3 §</b></a>',
  ].join(""),
};
const unsupportedBoundary = prepareLocatorReviewSurface({
  sourceId: "synthetic-missing-boundary",
  requestedLocator: "1 kap. 2 §",
  document: missingNextStyle,
  rawFile: "synthetic-missing-boundary.json",
  preparedAt: "2026-09-08T11:10:00.000Z",
});
const unsupportedBoundaryHtml = renderReviewHtml(unsupportedBoundary, null);
const unsupportedOrientation = buildReviewOrientation(unsupportedBoundary);
check("A broken neighbouring boundary becomes an unsupported explanation page",
  unsupportedBoundary.review_disposition.status === "unsupported_pattern"
  && unsupportedBoundary.review_signals.some((signal) => signal.kind === "broken_boundary" && signal.blocks_decision)
  && unsupportedOrientation.kind === "incomplete_boundary"
  && unsupportedBoundaryHtml.includes('href="#source-evidence"')
  && unsupportedBoundaryHtml.includes("This source pattern is not yet reviewable")
  && unsupportedBoundaryHtml.includes("Broken boundary chain")
  && unsupportedBoundaryHtml.includes("Report unsupported source pattern")
  && !unsupportedBoundaryHtml.includes('id="confirm"'));

const unsupportedCaseReport = createReviewCaseReport(unsupportedBoundary);
check("Unsupported pattern uses a separate report kind but the same privacy contract",
  unsupportedCaseReport.report_kind === "unsupported_source_pattern"
  && unsupportedCaseReport.case_id !== temporalCaseReport.case_id
  && validateReviewCaseReport(unsupportedCaseReport).length === 0);

const unanchoredSource = {
  titel: "Synthetic text-only section",
  beteckning: "synthetic:unanchored",
  subtitel: "synthetic snapshot",
  text: [
    "1 kap. Regler",
    "",
    "1 § Första regeln.",
    "",
    "2 § Text som juristen behöver läsa.",
    "Andra raden hör till samma textkandidat.",
    "",
    "3 § Följande regel.",
  ].join("\n"),
  html: [
    '<a class="paragraf" name="K1P1"><b>1 §</b></a>',
    "<b>2 §</b> Text som juristen behöver läsa.",
    '<a class="paragraf" name="K1P3"><b>3 §</b></a>',
  ].join(""),
};
const unanchoredSurface = prepareLocatorReviewSurface({
  sourceId: "synthetic-unanchored",
  requestedLocator: "1 kap. 2 §",
  document: unanchoredSource,
  rawFile: "synthetic-unanchored.json",
  preparedAt: "2026-09-08T11:11:00.000Z",
});
const unanchoredHtml = renderReviewHtml(unanchoredSurface, null);
const unanchoredCaseReport = createReviewCaseReport(unanchoredSurface);
check("A text-only candidate is readable as unverified source evidence without a decision",
  unanchoredSurface.review_disposition.status === "unsupported_pattern"
  && unanchoredSurface.explanation_context.reading_views.length === 1
  && unanchoredSurface.explanation_context.reading_views[0].evidence_status === "unanchored_text_candidate"
  && unanchoredSurface.explanation_context.reading_views[0].source_text.includes("Andra raden hör till samma textkandidat.")
  && unanchoredHtml.includes("Official plain text between two heading-like lines")
  && unanchoredHtml.includes("Andra raden hör till samma textkandidat.")
  && !unanchoredHtml.includes('id="confirm"')
  && !JSON.stringify(unanchoredCaseReport).includes("Andra raden hör till samma textkandidat."));

const packetCacheDir = join(tempRoot, "packet-cache");
const getProvisionPath = new URL("../connector/get_provision.mjs", import.meta.url).pathname;
async function syntheticPacket(sourceId, locator, document) {
  const sourceDir = join(packetCacheDir, sourceId);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "synthetic-snapshot.json"), JSON.stringify({
    dokumentstatus: { dokument: { ...document, beteckning: sourceId.replace(/^sfs-(\d{4})-(\d+)$/, "$1:$2") } },
  }));
  return JSON.parse(execFileSync(process.execPath, [
    getProvisionPath,
    "--source", sourceId,
    "--locator", locator,
    "--cache-dir", packetCacheDir,
    "--review-store", join(tempRoot, "packet-review-store"),
    "--case-dir", join(tempRoot, "packet-cases"),
    "--run-dir", join(tempRoot, "packet-runs"),
  ], { encoding: "utf8" }));
}
const unanchoredPacket = await syntheticPacket("sfs-9999-2", "1 kap. 2 §", unanchoredSource);
const brokenBoundaryPacket = await syntheticPacket("sfs-9999-3", "1 kap. 2 §", missingNextStyle);
check("Blocked packets expose provisional candidate spans without confirmed text",
  unanchoredPacket.status === "unknown"
  && !Object.hasOwn(unanchoredPacket, "text")
  && unanchoredPacket.review_action.source_observation.status === "unverified_text_candidate"
  && unanchoredPacket.review_action.source_observation.candidates[0].excerpt.includes("Andra raden hör till samma textkandidat.")
  && brokenBoundaryPacket.status === "unknown"
  && !Object.hasOwn(brokenBoundaryPacket, "text")
  && brokenBoundaryPacket.review_action.source_observation.status === "unverified_text_candidate"
  && brokenBoundaryPacket.review_action.source_observation.candidates[0].excerpt.includes("Andra regeln")
  && brokenBoundaryPacket.review_action.source_observation.candidates[0].excerpt_boundary_basis === "end_of_source");

const summary = {
  test_suite: "locator-review-synthetic-v1",
  generated_at: new Date().toISOString(),
  total: results.length,
  passed: results.filter((result) => result.status === "pass").length,
  failed: results.filter((result) => result.status === "fail").length,
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
