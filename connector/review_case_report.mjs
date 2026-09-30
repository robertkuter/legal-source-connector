import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDirectory } from "./runtime.mjs";
import { sha256 } from "./sfs_index.mjs";

export const REVIEW_CASE_REPORT_SCHEMA_VERSION = "1.0.0";
export const REVIEW_CASE_REGISTER_SCHEMA_VERSION = "1.0.0";
export const REVIEW_CASE_GITHUB_URL = "https://github.com/robertkuter/legal-source-connector/issues/new";

const REPORT_SCHEMA_ID = "sv_sfs_review_case_report";
const REGISTER_SCHEMA_ID = "sv_sfs_review_case_register_record";
const EXCLUDED_PUBLIC_FIELDS = Object.freeze([
  "matter names and user prompts",
  "source text and HTML excerpts",
  "reviewer labels and rationales",
  "source and artifact hashes",
  "local paths and cached filenames",
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function snapshotTimestamp(rawFile) {
  const match = String(rawFile ?? "").match(/(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return match ? `${match[1]}:${match[2]}:${match[3]}.${match[4]}Z` : null;
}

function officialUrls(providerId, authorityId) {
  if (providerId !== "riksdagen_open_data" || !/^sfs-\d{4}-\d+$/i.test(authorityId)) {
    return { text: null, html: null };
  }
  return {
    text: `https://data.riksdagen.se/dokument/${authorityId}.text`,
    html: `https://data.riksdagen.se/dokument/${authorityId}.html`,
  };
}

function reportKind(disposition) {
  if (disposition === "unsupported_pattern") return "unsupported_source_pattern";
  if (disposition === "explanation_only") return "capability_need";
  throw new Error(`Review case reports require explanation_only or unsupported_pattern; received ${disposition}.`);
}

function stableId(prefix, value) {
  return `${prefix}-${sha256(canonicalJson(value)).slice(0, 20)}`;
}

function rejectUnexpectedKeys(errors, value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`unexpected field ${label}.${key}`);
  }
}

export function createReviewCaseReport(artifact, { createdAt = artifact?.prepared_at } = {}) {
  const disposition = artifact?.review_disposition?.status;
  const kind = reportKind(disposition);
  const reasonCodes = [...new Set(artifact.review_disposition.reason_codes ?? [])].sort();
  const signalKinds = [...new Set((artifact.review_signals ?? []).map((signal) => signal.kind))].sort();
  const identity = {
    provider_id: artifact.source.provider_id,
    authority_id: artifact.source.authority_id,
    canonical_locator: artifact.locator.canonical,
    report_kind: kind,
    reason_codes: reasonCodes,
    signal_kinds: signalKinds,
  };
  const caseId = stableId("lscase", identity);
  const occurrenceId = stableId("lsocc", {
    case_id: caseId,
    source_text_sha256: artifact.source.source_text_sha256,
    source_html_sha256: artifact.source.source_html_sha256,
    artifact_schema_version: artifact.artifact_schema_version,
    connector_review_version: artifact.implementation.connector_review_version,
    index_version: artifact.implementation.index_version,
    review_signal_vocabulary_version: artifact.review_signal_vocabulary_version,
  });
  const urls = officialUrls(artifact.source.provider_id, artifact.source.authority_id);
  const report = {
    schema_id: REPORT_SCHEMA_ID,
    schema_version: REVIEW_CASE_REPORT_SCHEMA_VERSION,
    report_kind: kind,
    case_id: caseId,
    occurrence_id: occurrenceId,
    created_at: createdAt,
    workflow_status: "retrieval_withheld",
    source: {
      provider_id: artifact.source.provider_id,
      authority_id: artifact.source.authority_id,
      sfs_number: artifact.source.sfs_number,
      title: artifact.source.title,
      snapshot_at: snapshotTimestamp(artifact.source.source_snapshot),
      official_text_url: urls.text,
      official_html_url: urls.html,
    },
    locator: {
      requested: artifact.locator.requested,
      canonical: artifact.locator.canonical,
    },
    blocker: {
      disposition,
      reason_codes: reasonCodes,
      signal_kinds: signalKinds,
      automatic_capability_status: artifact.automatic_capability.status,
      publisher_anchor_count: artifact.automatic_capability.html_anchor_count,
      text_candidate_count: artifact.automatic_capability.text_candidate_count,
    },
    implementation: {
      connector_review_version: artifact.implementation.connector_review_version,
      index_version: artifact.implementation.index_version,
      artifact_schema_version: artifact.artifact_schema_version,
      decision_schema_version: artifact.implementation.decision_schema_version,
      review_signal_vocabulary_version: artifact.review_signal_vocabulary_version,
    },
    reproduction: {
      command: `node connector/get_provision.mjs --source ${artifact.source.authority_id} --locator ${JSON.stringify(artifact.locator.requested)}`,
    },
    github: {
      new_issue_url: REVIEW_CASE_GITHUB_URL,
    },
    privacy: {
      safe_for_public_issue_draft: true,
      requires_human_review_before_submission: true,
      excluded_fields: [...EXCLUDED_PUBLIC_FIELDS],
    },
  };
  const errors = validateReviewCaseReport(report);
  if (errors.length) throw new Error(`Unsafe or invalid review case report: ${errors.join("; ")}`);
  return report;
}

export function validateReviewCaseReport(report) {
  const errors = [];
  rejectUnexpectedKeys(errors, report, [
    "schema_id", "schema_version", "report_kind", "case_id", "occurrence_id", "created_at",
    "workflow_status", "source", "locator", "blocker", "implementation", "reproduction",
    "github", "privacy",
  ], "report");
  rejectUnexpectedKeys(errors, report?.source, [
    "provider_id", "authority_id", "sfs_number", "title", "snapshot_at", "official_text_url",
    "official_html_url",
  ], "report.source");
  rejectUnexpectedKeys(errors, report?.locator, ["requested", "canonical"], "report.locator");
  rejectUnexpectedKeys(errors, report?.blocker, [
    "disposition", "reason_codes", "signal_kinds", "automatic_capability_status",
    "publisher_anchor_count", "text_candidate_count",
  ], "report.blocker");
  rejectUnexpectedKeys(errors, report?.implementation, [
    "connector_review_version", "index_version", "artifact_schema_version",
    "decision_schema_version", "review_signal_vocabulary_version",
  ], "report.implementation");
  rejectUnexpectedKeys(errors, report?.reproduction, ["command"], "report.reproduction");
  rejectUnexpectedKeys(errors, report?.github, ["new_issue_url"], "report.github");
  rejectUnexpectedKeys(errors, report?.privacy, [
    "safe_for_public_issue_draft", "requires_human_review_before_submission", "excluded_fields",
  ], "report.privacy");
  if (report?.schema_id !== REPORT_SCHEMA_ID) errors.push("unsupported schema_id");
  if (report?.schema_version !== REVIEW_CASE_REPORT_SCHEMA_VERSION) errors.push("unsupported schema_version");
  if (!["unsupported_source_pattern", "capability_need"].includes(report?.report_kind)) errors.push("invalid report_kind");
  if (!/^lscase-[0-9a-f]{20}$/.test(report?.case_id ?? "")) errors.push("invalid case_id");
  if (!/^lsocc-[0-9a-f]{20}$/.test(report?.occurrence_id ?? "")) errors.push("invalid occurrence_id");
  if (!report?.created_at || Number.isNaN(Date.parse(report.created_at))) errors.push("invalid created_at");
  if (report?.workflow_status !== "retrieval_withheld") errors.push("workflow_status must be retrieval_withheld");
  if (!report?.source?.provider_id || !report?.source?.authority_id || !report?.source?.sfs_number) errors.push("incomplete source identity");
  if (!report?.locator?.requested || !report?.locator?.canonical) errors.push("incomplete locator identity");
  if (!["explanation_only", "unsupported_pattern"].includes(report?.blocker?.disposition)) errors.push("invalid blocker disposition");
  if (!Array.isArray(report?.blocker?.reason_codes) || !report.blocker.reason_codes.length) errors.push("missing reason_codes");
  if (!Array.isArray(report?.blocker?.signal_kinds) || !report.blocker.signal_kinds.length) errors.push("missing signal_kinds");
  if (!Number.isInteger(report?.blocker?.publisher_anchor_count) || report.blocker.publisher_anchor_count < 0) errors.push("invalid publisher_anchor_count");
  if (!Number.isInteger(report?.blocker?.text_candidate_count) || report.blocker.text_candidate_count < 0) errors.push("invalid text_candidate_count");
  for (const key of [
    "connector_review_version", "index_version", "artifact_schema_version",
    "decision_schema_version", "review_signal_vocabulary_version",
  ]) {
    if (!report?.implementation?.[key]) errors.push(`missing implementation.${key}`);
  }
  if (!report?.reproduction?.command?.startsWith("node connector/get_provision.mjs ")) errors.push("invalid reproduction command");
  if (report?.github?.new_issue_url !== REVIEW_CASE_GITHUB_URL) errors.push("unexpected GitHub destination");
  if (report?.privacy?.safe_for_public_issue_draft !== true
    || report?.privacy?.requires_human_review_before_submission !== true) errors.push("incomplete privacy contract");

  const serialized = JSON.stringify(report);
  const forbiddenKeys = [
    "source_text_sha256", "source_html_sha256", "artifact_sha256", "decision_record_sha256",
    "source_snapshot", "source_markup", "source_text", "provision_text", "reviewer", "rationale",
    "local_path", "artifact_path", "review_store",
  ];
  for (const key of forbiddenKeys) {
    if (serialized.includes(`\"${key}\"`)) errors.push(`forbidden public field ${key}`);
  }
  if (/(?:\/Users\/|\/home\/|file:\/\/|[A-Za-z]:\\\\)/.test(serialized)) errors.push("local filesystem path detected");
  return [...new Set(errors)];
}

export function renderGitHubIssueDraft(report) {
  const errors = validateReviewCaseReport(report);
  if (errors.length) throw new Error(`Cannot render invalid review case report: ${errors.join("; ")}`);
  const reasonCodes = report.blocker.reason_codes.map((item) => `\`${item}\``).join(", ");
  const signalKinds = report.blocker.signal_kinds.map((item) => `\`${item}\``).join(", ");
  const sourceLink = report.source.official_html_url
    ? `[Official publisher HTML](${report.source.official_html_url})`
    : "Official publisher URL unavailable in the generated draft";
  const titlePrefix = report.report_kind === "unsupported_source_pattern"
    ? "Unsupported source pattern"
    : "Known capability need";
  return {
    title: `[${titlePrefix}] ${report.source.authority_id} ${report.locator.canonical}`,
    body: [
      "## What happened",
      "",
      `The connector withheld retrieval for **${report.source.authority_id} · ${report.locator.canonical}**.`,
      `Disposition: \`${report.blocker.disposition}\`. Automatic capability: \`${report.blocker.automatic_capability_status}\`.`,
      "",
      "## Structural signals",
      "",
      `- Reason codes: ${reasonCodes}`,
      `- Signal kinds: ${signalKinds}`,
      `- Publisher anchors: ${report.blocker.publisher_anchor_count}`,
      `- Plain-text candidates: ${report.blocker.text_candidate_count}`,
      `- Source snapshot time: ${report.source.snapshot_at ?? "unavailable"}`,
      `- ${sourceLink}`,
      "",
      "## Reproduce",
      "",
      "```bash",
      report.reproduction.command,
      "```",
      "",
      "## Connector versions",
      "",
      `- Connector review: \`${report.implementation.connector_review_version}\``,
      `- Index: \`${report.implementation.index_version}\``,
      `- Review artifact: \`${report.implementation.artifact_schema_version}\``,
      `- Review signals: \`${report.implementation.review_signal_vocabulary_version}\``,
      "",
      `Pattern ID: \`${report.case_id}\`  `,
      `Occurrence ID: \`${report.occurrence_id}\``,
      "",
      "## Privacy check",
      "",
      "This draft was generated from a strict allowlist. It excludes matter context, prompts, source excerpts, reviewer information, hashes, cached filenames and local paths. Please still review it before submitting.",
    ].join("\n"),
  };
}

export async function recordReviewCase({ caseDir, report }) {
  const errors = validateReviewCaseReport(report);
  if (errors.length) throw new Error(`Cannot record invalid review case report: ${errors.join("; ")}`);
  await ensureDirectory(caseDir);
  const recordPath = join(caseDir, `${report.case_id}.json`);
  let existing = null;
  try {
    existing = JSON.parse(await readFile(recordPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing && (existing.store_schema_id !== REGISTER_SCHEMA_ID
    || existing.store_schema_version !== REVIEW_CASE_REGISTER_SCHEMA_VERSION
    || existing.case_id !== report.case_id)) {
    throw new Error(`Existing review case record is incompatible: ${recordPath}`);
  }
  const priorIds = existing?.occurrence_ids ?? [];
  const occurrenceIds = priorIds.includes(report.occurrence_id)
    ? priorIds
    : [...priorIds, report.occurrence_id];
  const record = {
    store_schema_id: REGISTER_SCHEMA_ID,
    store_schema_version: REVIEW_CASE_REGISTER_SCHEMA_VERSION,
    case_id: report.case_id,
    state: existing?.state ?? "pending",
    first_seen_at: existing?.first_seen_at ?? report.created_at,
    last_seen_at: report.created_at,
    occurrence_count: occurrenceIds.length,
    occurrence_ids: occurrenceIds,
    latest_report: report,
  };
  const temporaryPath = `${recordPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporaryPath, recordPath);
  return { status: existing ? "updated" : "recorded", recordPath, record };
}

export async function listReviewCases(caseDir) {
  let names;
  try {
    names = await readdir(caseDir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const record = JSON.parse(await readFile(join(caseDir, name), "utf8"));
    if (record.store_schema_id !== REGISTER_SCHEMA_ID
      || record.store_schema_version !== REVIEW_CASE_REGISTER_SCHEMA_VERSION) continue;
    records.push(record);
  }
  return records.sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at));
}
