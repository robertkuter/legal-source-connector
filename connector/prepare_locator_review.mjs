#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDecisionTemplate, prepareLocatorReviewSurface } from "./locator_review.mjs";
import {
  createReviewCaseReport,
  recordReviewCase,
  renderGitHubIssueDraft,
} from "./review_case_report.mjs";
import { loadCachedDocument } from "./sfs_index.mjs";
import { buildReviewOrientation, buildReviewQuestions } from "./review_orientation.mjs";
import {
  defaultCacheDir,
  defaultReviewCaseDir,
  defaultReviewDir,
  ensureDirectory,
  resolveUserPath,
  safeFileSegment,
} from "./runtime.mjs";

function parseArgs(items) {
  const result = {
    cacheDir: defaultCacheDir(),
    outputDir: join(defaultReviewDir(), "prepared"),
    caseDir: defaultReviewCaseDir(),
  };
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] === "--source") result.sourceId = items[++i];
    else if (items[i] === "--locator") result.locator = items[++i];
    else if (items[i] === "--cache-dir") result.cacheDir = resolveUserPath(items[++i], result.cacheDir);
    else if (items[i] === "--output-dir") result.outputDir = resolveUserPath(items[++i], result.outputDir);
    else if (items[i] === "--case-dir") result.caseDir = resolveUserPath(items[++i], result.caseDir);
  }
  return result;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function embeddedJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

const SIGNAL_TITLES = Object.freeze({
  coverage_difference: "Coverage difference",
  identity_order_difference: "Identity or order difference",
  text_only_candidate: "Duplicate-looking text",
  missing_text_candidate: "Publisher anchor without matching text",
  temporal_layer: "Temporal versions",
  duplicate_publisher_identity: "Duplicate publisher identity",
  renumbering_editorial_notice: "Renumbering notice",
  broken_boundary: "Broken boundary chain",
  unclassified_structure: "Unclassified source structure",
});

function renderSignalCards(signals) {
  return signals.map((signal) => `<article class="signal-card ${signal.blocks_decision ? "signal-blocking" : ""}"><span class="signal-state ${signal.blocks_decision ? "blocked" : signal.severity === "information" ? "information" : "observed"}">${htmlEscape(signal.blocks_decision ? "Blocks decision" : signal.scope === "source" ? "Observed across Act" : "Observed at locator")}</span><h4>${htmlEscape(SIGNAL_TITLES[signal.kind] ?? signal.kind)}</h4><code class="signal-cue">${htmlEscape(signal.evidence.summary)}</code><p>${htmlEscape(signal.meaning)}</p><p class="signal-effect"><strong>Connector response</strong>${htmlEscape(signal.connector_response)}</p></article>`).join("");
}

function dispositionLabel(disposition) {
  if (disposition.status === "explanation_only") return "Explanation only";
  if (disposition.status === "unsupported_pattern") return "Unsupported pattern";
  return "Decision available";
}

function renderReadableText(sourceText) {
  const paragraphs = String(sourceText ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  return paragraphs.length
    ? paragraphs.map((paragraph) => `<p>${htmlEscape(paragraph)}</p>`).join("")
    : `<p class="empty-evidence">No complete candidate text is available.</p>`;
}

function renderReadingViews(views, { decisionAvailable = false } = {}) {
  if (!Array.isArray(views) || !views.length) return "";
  return `<div class="reading-views">${views.map((view, viewPosition) => {
    const flags = new Map((view.flagged_lines ?? []).map((item) => [item.line, item.label]));
    const sourceRows = view.source_lines.map((item) => {
      const labels = [];
      const classes = [];
      if (item.line === view.start_line) {
        labels.push(view.anchor_name ? "Anchored start" : "Starts here");
        classes.push("line-start");
      }
      if (flags.has(item.line)) {
        labels.push(flags.get(item.line));
        classes.push("line-flagged");
      }
      if (item.line === view.end_line_exclusive) {
        labels.push(item.line === view.next_start_line ? "Boundary" : "Excluded heading · Stop here");
        classes.push("line-boundary");
      }
      if (item.line === view.next_start_line) {
        labels.push(view.same_locator_next
          ? "Next candidate, same locator"
          : `Next anchor${view.next_anchor_name ? ` ${view.next_anchor_name}` : ""}`);
        classes.push("line-next");
      }
      return `<div class="source-line ${classes.join(" ")}"><span class="source-line-number">${item.line}</span><code>${htmlEscape(item.text || " ")}</code>${labels.length ? `<span class="line-label">${htmlEscape(labels.join(" · "))}</span>` : ""}</div>`;
    }).join("");
    const candidateLabel = decisionAvailable
      ? "Proposed extraction"
      : `Source candidate ${viewPosition + 1} of ${views.length}`;
    const unanchored = view.evidence_status === "unanchored_text_candidate";
    const provisional = unanchored || view.evidence_status === "provisional_text_candidate";
    const provisionalSpan = view.excerpt_boundary_basis === "end_of_source"
      ? "from a heading-like line to the end of the available source"
      : "between two heading-like lines";
    const marker = `${provisional
      ? `<span class="reading-warning">Official plain text ${provisionalSpan}. ${unanchored ? "No matching publisher anchor was found." : "The anchor pairing is unresolved."} The excerpt boundary is provisional; this is source evidence, not a confirmed provision.</span>`
      : ""}${view.temporal_marker
      ? `<span class="reading-warning">${htmlEscape(view.temporal_marker.raw)}</span>`
      : ""}`;
    const nextBoundary = view.next_locator
      ? `<div class="reader-boundary"><span>${provisional ? "Excerpt stops before next text heading" : "Reading stops before"}</span><strong>${htmlEscape(view.next_locator)}</strong>${view.next_anchor_name ? `<code>${htmlEscape(view.next_anchor_name)}</code>` : ""}</div>`
      : `<div class="reader-boundary"><span>${provisional ? "Excerpt extends to" : "Reading stops at"}</span><strong>End of available source</strong></div>`;
    return `<article class="reading-comparison"><div class="reading-heading"><div><span class="lane-label">${candidateLabel}</span><h3>${htmlEscape(view.label)}</h3></div><div class="reading-coordinates"><span>Lines ${view.start_line}–${Math.max(view.start_line, view.end_line_exclusive - 1)}</span><span>Offsets ${view.source_offsets.start}–${view.source_offsets.end_exclusive}</span><span>${htmlEscape(view.anchor_name ?? (unanchored ? "No publisher anchor" : "Anchor pairing unverified"))}</span></div></div>${marker}<div class="reading-grid"><div class="source-pane"><div class="pane-heading"><strong>Numbered source view</strong><span>${provisional ? view.next_locator ? "Exact snapshot lines; next text heading shown for context" : "Exact snapshot lines through end of available source" : "Exact snapshot lines, including the following boundary"}</span></div><div class="source-lines" lang="sv">${sourceRows}</div></div><div class="reader-pane"><div class="pane-heading"><strong>Reader view</strong><span>Same words, with source line wrapping removed</span></div><div class="legal-reading" lang="sv">${renderReadableText(view.source_text)}</div>${nextBoundary}<small class="presentation-note">This right-hand view is for reading only. The numbered source lines, offsets and SHA-256 hash remain the evidence.</small></div></div><div class="reading-hash"><span>Candidate text SHA-256</span><code>${htmlEscape(view.source_text_sha256)}</code></div></article>`;
  }).join("")}</div>`;
}

function renderExplanationHtml(artifact, providedCaseReport = null) {
  const disposition = artifact.review_disposition;
  const orientation = buildReviewOrientation(artifact);
  const caseReport = providedCaseReport ?? createReviewCaseReport(artifact);
  const officialSourceLinks = [
    ["Read complete official plain text", caseReport.source.official_text_url],
    ["Read official HTML", caseReport.source.official_html_url],
  ].filter(([, url]) => url).map(([label, url]) => `<a href="${htmlEscape(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`).join(" · ");
  const issueDraft = renderGitHubIssueDraft(caseReport);
  const reportAction = caseReport.report_kind === "unsupported_source_pattern"
    ? "Report unsupported source pattern"
    : "Record capability need";
  const anchors = artifact.explanation_context.matching_publisher_anchors;
  const candidates = artifact.explanation_context.matching_text_candidates;
  const context = artifact.explanation_context.source_context.map((item) => `${item.line}: ${item.text}`).join("\n");
  const readingViews = renderReadingViews(artifact.explanation_context.reading_views);
  const anchorRows = anchors.length
    ? anchors.map((anchor) => `<div class="evidence-row"><div><span>Publisher anchor ${anchor.position}</span><strong><code>${htmlEscape(anchor.name)}</code></strong></div><pre>${htmlEscape(anchor.source_markup)}</pre><small>${htmlEscape(anchor.heading_text)}</small></div>`).join("")
    : `<p class="empty-evidence">No matching publisher anchor was found.</p>`;
  const candidateRows = candidates.length
    ? candidates.map((candidate) => `<div class="evidence-row"><div><span>Plain-text candidate ${candidate.position}</span><strong>Line ${candidate.start_line} · offset ${candidate.start_offset}</strong></div><code>${htmlEscape(`${artifact.locator.section} § ${candidate.heading_text}`)}</code>${candidate.temporal_marker ? `<small class="marker">${htmlEscape(candidate.temporal_marker.raw)}</small>` : ""}</div>`).join("")
    : `<p class="empty-evidence">No matching plain-text candidate was found.</p>`;
  const tone = disposition.status === "explanation_only" ? "explain" : "unsupported";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Source block explanation — ${htmlEscape(artifact.locator.canonical)}</title>
  <style>
    :root { color-scheme: light; --ink:#17201d; --muted:#5d6964; --line:#d7ddd9; --paper:#fffef9; --surface:#f3f5f1; --green:#164f3b; --green-soft:#e6f0eb; --amber:#925816; --amber-soft:#fbf1df; --blue:#345b72; --blue-soft:#e8f0f4; --red:#873b32; --red-soft:#f8e9e6; --shadow:0 18px 50px rgba(30,45,39,.09); font:16px/1.55 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    * { box-sizing:border-box; } body { margin:0; color:var(--ink); background:#e9ede9; } .shell { max-width:78rem; min-height:100vh; margin:0 auto; background:var(--paper); box-shadow:var(--shadow); }
    header { padding:3.25rem clamp(1.25rem,5vw,4.75rem) 2.25rem; color:white; background:var(--green); } .eyebrow { margin:0 0 .8rem; color:#c7dbd1; font-size:.75rem; font-weight:750; letter-spacing:.13em; text-transform:uppercase; } h1 { max-width:18ch; margin:0; font:600 clamp(2.35rem,5vw,4.4rem)/1.02 Georgia,"Times New Roman",serif; letter-spacing:-.035em; } .lede { max-width:52rem; margin:1.1rem 0 0; color:#dfebe5; font-size:1.08rem; } .header-meta { display:flex; flex-wrap:wrap; gap:.55rem; margin-top:1.75rem; } .badge { display:inline-flex; align-items:center; gap:.42rem; border:1px solid currentColor; border-radius:999px; padding:.32rem .7rem; color:#d9e8e0; font-size:.78rem; font-weight:700; }
    main { padding:0 clamp(1.25rem,5vw,4.75rem) 4.5rem; } .scope-contract { display:grid; grid-template-columns:auto 1fr; gap:1rem; margin:0 -1rem 2.5rem; padding:1.45rem 1rem; border-bottom:1px solid; background:${tone === "explain" ? "var(--amber-soft)" : "var(--red-soft)"}; border-color:${tone === "explain" ? "#ead4af" : "#e4c0bb"}; } .scope-icon { display:grid; place-items:center; width:2.5rem; height:2.5rem; border-radius:50%; color:white; background:${tone === "explain" ? "var(--amber)" : "var(--red)"}; font-weight:800; } .scope-contract h2 { margin:0 0 .22rem; font-size:1rem; } .scope-contract p { margin:0; color:${tone === "explain" ? "#674a27" : "#693b36"}; }
    .workflow { display:grid; grid-template-columns:repeat(3,1fr); gap:.75rem; margin:0 0 2.5rem; padding:0; list-style:none; } .workflow li { position:relative; min-height:4.5rem; padding:.85rem 1rem .85rem 3rem; border:1px solid var(--line); border-radius:.7rem; color:var(--muted); background:white; } .workflow strong { display:block; color:var(--ink); font-size:.9rem; } .step-number { position:absolute; left:.85rem; top:.9rem; display:grid; place-items:center; width:1.55rem; height:1.55rem; border-radius:50%; color:white; background:var(--green); font-size:.75rem; font-weight:800; }
    section { margin:2.75rem 0; } .section-kicker { margin:0 0 .35rem; color:var(--green); font-size:.72rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; } h2 { margin:0; font:600 1.65rem/1.2 Georgia,"Times New Roman",serif; } h3 { margin:0 0 .7rem; font-size:.9rem; } .section-intro { max-width:50rem; margin:.55rem 0 1.25rem; color:var(--muted); }
    .disposition { display:grid; grid-template-columns:auto 1fr; gap:1rem; padding:1.25rem; border:1px solid ${tone === "explain" ? "#e2cda8" : "#e0bbb5"}; border-radius:.85rem; background:${tone === "explain" ? "var(--amber-soft)" : "var(--red-soft)"}; } .disposition strong { display:block; margin-bottom:.25rem; font:600 1.18rem/1.3 Georgia,"Times New Roman",serif; } .disposition p { margin:0; color:var(--muted); } .status-pill { display:inline-block; align-self:start; border-radius:999px; padding:.3rem .6rem; color:${tone === "explain" ? "var(--amber)" : "var(--red)"}; background:white; font-size:.7rem; font-weight:800; text-transform:uppercase; }
    .signal-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(16rem,1fr)); gap:.75rem; margin-top:1rem; } .signal-card { display:flex; flex-direction:column; padding:1rem; border:1px solid var(--line); border-radius:.65rem; background:white; } .signal-card.signal-blocking { border-color:${tone === "explain" ? "#dfc496" : "#ddb4ae"}; } .signal-card h4 { margin:.55rem 0 .25rem; font-size:.9rem; } .signal-card p { margin:0; color:var(--muted); font-size:.8rem; } .signal-cue { display:block; margin:.15rem 0 .65rem; padding:.55rem; border-radius:.4rem; color:var(--ink); background:var(--surface); font-size:.73rem; overflow-wrap:anywhere; } .signal-effect { margin-top:.8rem!important; padding-top:.7rem; border-top:1px solid var(--line); } .signal-effect strong { display:block; margin-bottom:.2rem; color:var(--green); font-size:.65rem; letter-spacing:.06em; text-transform:uppercase; } .signal-state { align-self:flex-start; border-radius:999px; padding:.2rem .45rem; font-size:.62rem; font-weight:800; letter-spacing:.05em; text-transform:uppercase; } .signal-state.blocked { color:${tone === "explain" ? "var(--amber)" : "var(--red)"}; background:${tone === "explain" ? "var(--amber-soft)" : "var(--red-soft)"}; } .signal-state.observed { color:var(--amber); background:var(--amber-soft); } .signal-state.information { color:var(--blue); background:var(--blue-soft); }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; } .card { border:1px solid var(--line); border-radius:.8rem; padding:1.25rem; background:white; } .evidence-list { display:grid; gap:.65rem; } .evidence-row { padding:.85rem; border:1px solid var(--line); border-radius:.55rem; background:var(--surface); } .evidence-row div { display:flex; justify-content:space-between; gap:.75rem; } .evidence-row span { color:var(--muted); font-size:.75rem; font-weight:700; text-transform:uppercase; } .evidence-row strong,.evidence-row code,.evidence-row small { display:block; overflow-wrap:anywhere; } .evidence-row pre { margin:.5rem 0; padding:.65rem; white-space:pre-wrap; color:#dcefe5; background:#142b22; border-radius:.4rem; font-size:.75rem; } .marker { margin-top:.45rem; color:var(--amber); font-weight:700; } .context { margin:0; padding:1rem; white-space:pre-wrap; overflow-wrap:anywhere; color:#34403a; background:var(--surface); border-radius:.5rem; font-size:.8rem; line-height:1.55; }
    .reading-views { display:grid; gap:1.25rem; margin-top:1.25rem; } .reading-comparison { overflow:hidden; border:1px solid var(--line); border-radius:.85rem; background:white; } .reading-heading { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1rem 1.15rem; color:white; background:#294d3e; } .reading-heading h3 { margin:0; font:600 1.08rem/1.25 Georgia,"Times New Roman",serif; } .reading-heading .lane-label { color:#cfe0d8; } .reading-coordinates { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.4rem; } .reading-coordinates span,.reading-warning { border-radius:999px; padding:.24rem .52rem; background:rgba(255,255,255,.14); font-size:.68rem; font-weight:750; } .reading-warning { display:block; margin:.8rem 1rem 0; color:var(--red); background:var(--red-soft); overflow-wrap:anywhere; } .reading-grid { display:grid; grid-template-columns:minmax(0,1.08fr) minmax(18rem,.92fr); } .source-pane { min-width:0; border-right:1px solid var(--line); background:#f7f8f5; } .reader-pane { min-width:0; background:#fffef9; } .pane-heading { display:flex; justify-content:space-between; gap:.7rem; padding:.75rem 1rem; border-bottom:1px solid var(--line); } .pane-heading strong { font-size:.8rem; } .pane-heading span { color:var(--muted); font-size:.72rem; text-align:right; } .source-lines { max-height:40rem; overflow:auto; padding:.55rem 0; } .source-line { display:grid; grid-template-columns:4rem minmax(0,1fr) auto; align-items:start; min-height:1.7rem; border-left:4px solid transparent; } .source-line-number { padding:.22rem .65rem; color:var(--blue); font:750 .7rem/1.45 ui-sans-serif,sans-serif; text-align:right; } .source-line code { padding:.2rem .55rem; white-space:pre-wrap; overflow-wrap:anywhere; font-size:.73rem; } .line-label { align-self:center; margin:.18rem .55rem .18rem .2rem; border-radius:999px; padding:.16rem .42rem; color:#5d4524; background:var(--amber-soft); font-size:.59rem; font-weight:800; white-space:nowrap; } .line-start { border-color:var(--green); background:var(--green-soft); } .line-flagged { border-color:var(--amber); background:var(--amber-soft); } .line-boundary { border-color:var(--red); background:var(--red-soft); } .line-next { border-color:var(--blue); background:var(--blue-soft); } .legal-reading { padding:1.35rem; font:1rem/1.7 Georgia,"Times New Roman",serif; } .legal-reading p { margin:0 0 1rem; } .legal-reading p:first-child::first-line { font-weight:700; } .reader-boundary { display:grid; grid-template-columns:1fr auto; gap:.18rem .6rem; margin:0 1.15rem 1rem; padding:.8rem; border-top:3px solid var(--blue); background:var(--blue-soft); } .reader-boundary span { grid-column:1/-1; color:var(--muted); font-size:.65rem; font-weight:800; text-transform:uppercase; } .reader-boundary code { color:var(--blue); } .presentation-note { display:block; margin:0 1.15rem 1.15rem; color:var(--muted); } .reading-hash { display:grid; grid-template-columns:auto 1fr; gap:.6rem; padding:.65rem 1rem; border-top:1px solid var(--line); color:var(--muted); background:var(--surface); font-size:.68rem; } .reading-hash code { overflow-wrap:anywhere; color:var(--ink); }
    .next { padding:clamp(1.25rem,4vw,2.25rem); border:1px solid ${tone === "explain" ? "#e2cda8" : "#e0bbb5"}; border-radius:.9rem; background:${tone === "explain" ? "var(--amber-soft)" : "var(--red-soft)"}; } .next h2 { margin-bottom:.6rem; } .next p { max-width:50rem; margin:.35rem 0; color:var(--muted); } .no-action { margin-top:1rem; padding:1rem; border:1px solid var(--line); border-radius:.6rem; background:white; font-weight:700; } .case-reporting { padding:clamp(1.25rem,4vw,2.25rem); border:1px solid #b9cec4; border-radius:.9rem; background:var(--green-soft); } .case-reporting h2 { margin-bottom:.6rem; } .case-reporting p { max-width:52rem; color:var(--muted); } .privacy-contract { display:grid; grid-template-columns:auto 1fr; gap:.75rem; margin:1rem 0; padding:1rem; border:1px solid #b9cec4; border-radius:.65rem; background:white; } .privacy-contract strong { display:block; } .privacy-contract span { color:var(--muted); font-size:.8rem; } .privacy-mark { display:grid; place-items:center; width:2rem; height:2rem; border-radius:50%; color:white; background:var(--green); font-weight:800; } .report-actions { display:flex; flex-wrap:wrap; gap:.65rem; margin-top:1rem; } .report-actions button,.report-actions a { appearance:none; border:1px solid var(--green); border-radius:.5rem; padding:.68rem .88rem; color:white; background:var(--green); font:750 .78rem/1.2 ui-sans-serif,sans-serif; text-decoration:none; cursor:pointer; } .report-actions .secondary { color:var(--green); background:white; } .report-message { min-height:1.5rem; margin:.7rem 0 0; color:var(--green); font-size:.78rem; font-weight:700; } .issue-preview { max-height:24rem; overflow:auto; margin:.8rem 0 0; padding:1rem; white-space:pre-wrap; overflow-wrap:anywhere; color:#34403a; background:white; border-radius:.5rem; font-size:.73rem; } details { margin-top:1rem; border-top:1px solid var(--line); padding-top:.9rem; } summary { cursor:pointer; color:var(--blue); font-weight:700; } .hashes { margin:.8rem 0 0; padding:.8rem; color:var(--muted); background:var(--blue-soft); border-radius:.45rem; font-size:.73rem; overflow-wrap:anywhere; } code,pre { font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace; } footer { padding:1.25rem clamp(1.25rem,5vw,4.75rem); color:#d7e3dd; background:#20332b; font-size:.78rem; } footer strong { color:white; }
    @media(max-width:760px){ .workflow,.grid,.reading-grid{grid-template-columns:1fr}.scope-contract{margin-inline:0}.disposition{grid-template-columns:1fr}.evidence-row div{display:block}.reading-heading{align-items:flex-start;flex-direction:column}.reading-coordinates{justify-content:flex-start}.source-pane{border-right:0;border-bottom:1px solid var(--line)}.source-line{grid-template-columns:3.4rem minmax(0,1fr)}.line-label{grid-column:2;margin:.1rem .55rem .35rem}.reading-hash{grid-template-columns:1fr} }
    @media print { body{background:white}.shell{box-shadow:none}.next{break-inside:avoid} }
  </style>
</head>
<body>
  <div class="shell">
    <header><p class="eyebrow">Legal Source Connector · Evidence explanation</p><h1>${tone === "explain" ? "This provision needs a different kind of decision" : "This source pattern is not yet reviewable"}</h1><p class="lede">The connector can show what stopped the lookup without inviting a decision that this review scope cannot safely support.</p><div class="header-meta"><span class="badge">Local evidence bundle</span><span class="badge">Scope: one locator</span><span class="badge">Signals ${htmlEscape(artifact.review_signal_vocabulary_version)}</span></div></header>
    <main>
      <aside class="scope-contract"><div class="scope-icon">!</div><div><h2>No structural approval is available</h2><p>This page cannot release <code>${htmlEscape(artifact.locator.canonical)}</code>, another locator or the source. It explains the evidence and the connector's safe response.</p></div></aside>
      <ol class="workflow"><li><span class="step-number">1</span><strong>Understand the stop</strong>See the evidence category.</li><li><span class="step-number">2</span><strong>Inspect what differs</strong>Compare the publisher and text views.</li><li><span class="step-number">3</span><strong>Know what is needed</strong>No approval control is presented.</li></ol>
      <section><p class="section-kicker">Step 1 · Review disposition</p><h2>Why the lookup remains blocked</h2><p class="section-intro">The disposition is a connector decision about what kind of human action, if any, this evidence supports.</p><div class="disposition"><span class="status-pill">${htmlEscape(dispositionLabel(disposition))}</span><div><strong>${htmlEscape(artifact.locator.canonical)}</strong><p>${htmlEscape(disposition.summary)}</p><p>${htmlEscape(orientation.localEvidence)} <a href="#${orientation.evidenceTarget}">${htmlEscape(orientation.evidenceLink)}</a>. ${htmlEscape(orientation.limit)}</p></div></div><div class="signal-grid">${renderSignalCards(artifact.review_signals)}</div></section>
      <section id="source-evidence"><p class="section-kicker">Step 2 · Source evidence</p><h2>What the publisher and text representations show</h2><p class="section-intro">These are competing or incomplete source coordinates—not alternative answers selected by the connector. ${officialSourceLinks}</p><div class="grid"><article class="card"><h3>Publisher anchors (${anchors.length})</h3><div class="evidence-list">${anchorRows}</div></article><article class="card"><h3>Plain-text candidates (${candidates.length})</h3><div class="evidence-list">${candidateRows}</div></article></div>${readingViews || (context ? `<details open><summary>Show the surrounding source lines</summary><pre class="context">${htmlEscape(context)}</pre></details>` : "")}</section>
      <section class="next"><p class="section-kicker">Step 3 · Connector response</p><h2>${tone === "explain" ? "A different capability is required" : "Connector support is required"}</h2><p>${tone === "explain" ? "This is not a request for a structural thumbs-up. The evidence requires a separately tested rule—such as date-aware version selection or explicit treatment of a publisher renumbering notice." : "The connector does not yet have a tested rule for this structure. The evidence should be retained as a development case rather than resolved through a general override."}</p><div class="no-action">No decision questions, Save review button or force option is available on this page.</div><details><summary>Show immutable source and artifact hashes</summary><div class="hashes"><strong>Text SHA-256</strong><br>${artifact.source.source_text_sha256}<br><br><strong>HTML SHA-256</strong><br>${artifact.source.source_html_sha256}<br><br><strong>Evidence artifact SHA-256</strong><br>${artifact.artifact_sha256}</div></details></section>
      <section class="case-reporting"><p class="section-kicker">Optional · Improve the connector</p><h2>${htmlEscape(reportAction)}</h2><p>The connector has assigned this blocked pattern <code>${htmlEscape(caseReport.case_id)}</code>. Normal lookup and page preparation record it in the local case queue. If you want to raise it on GitHub, copy the privacy-safe draft, inspect it, then choose whether to submit it yourself.</p><div class="privacy-contract"><span class="privacy-mark">✓</span><div><strong>The shareable draft is built from an allowlist</strong><span>It excludes matter context, prompts, source excerpts, reviewer information, hashes, cached filenames and local paths. Nothing is uploaded automatically.</span></div></div><div class="report-actions"><button type="button" id="copy-case-report">Copy safe GitHub report</button><button type="button" class="secondary" id="download-case-report">Download safe case report</button><button type="button" class="secondary" id="download-local-evidence">Download private evidence artifact</button><a class="secondary" href="${htmlEscape(caseReport.github.new_issue_url)}" target="_blank" rel="noopener noreferrer">Open GitHub issue</a></div><p class="report-message" id="report-message" role="status">Review the draft before sharing it outside this computer.</p><details><summary>Preview the exact GitHub draft</summary><pre class="issue-preview">${htmlEscape(`${issueDraft.title}\n\n${issueDraft.body}`)}</pre></details></section>
    </main>
    <footer><strong>Källa: Sveriges riksdag.</strong> This independent project is not produced, endorsed or sponsored by Sveriges riksdag. The evidence bundle remains local by default.</footer>
  </div>
  <script>
    const issueDraft = ${embeddedJson(issueDraft)};
    const safeCaseReport = ${embeddedJson(caseReport)};
    const privateEvidenceArtifact = ${embeddedJson(artifact)};
    const message = document.getElementById("report-message");
    const issueText = issueDraft.title + "\\n\\n" + issueDraft.body;
    async function copyText(value) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    function downloadJson(filename, value) {
      const blob = new Blob([JSON.stringify(value, null, 2) + "\\n"], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    }
    document.getElementById("copy-case-report").addEventListener("click", async () => {
      try {
        await copyText(issueText);
        message.textContent = "Safe draft copied. Inspect it, open GitHub and paste only if you choose to report the case.";
      } catch (error) {
        message.textContent = "Clipboard access was unavailable. Expand the preview and copy the draft manually.";
      }
    });
    document.getElementById("download-case-report").addEventListener("click", () => {
      downloadJson(safeCaseReport.case_id + "--safe-report.json", safeCaseReport);
      message.textContent = "Safe case report downloaded. It still requires your review before public sharing.";
    });
    document.getElementById("download-local-evidence").addEventListener("click", () => {
      downloadJson(safeCaseReport.occurrence_id + "--private-evidence.json", privateEvidenceArtifact);
      message.textContent = "Private evidence downloaded. It contains source excerpts and must not be attached to a public issue without separate review.";
    });
  </script>
</body>
</html>\n`;
}

export function renderReviewHtml(artifact, template, { caseReport = null } = {}) {
  if (artifact?.review_disposition?.status !== "decision_available") return renderExplanationHtml(artifact, caseReport);
  const orientation = buildReviewOrientation(artifact);
  const capabilityIssues = artifact.automatic_capability.issues
    .map((issue) => `<li>${htmlEscape(issue)}</li>`).join("");
  const sameLocatorCandidates = artifact.review_context.same_locator_candidates
    .map((candidate) => `<li>candidate ${candidate.position}: line ${candidate.start_line}, offset ${candidate.start_offset}${candidate.position === artifact.review_context.target_candidate.position ? " — proposed target" : ""}</li>`)
    .join("");
  const readingViews = renderReadingViews(artifact.review_context.reading_views, { decisionAvailable: true });
  const targetCandidate = artifact.review_context.target_candidate;
  const nextPublisherCandidate = artifact.review_context.next_publisher_candidate;
  const interveningCandidates = artifact.review_context.intervening_text_candidates ?? [];
  const nextAnchor = artifact.boundary.next_publisher_anchor;
  const chapteredAnchorParts = artifact.publisher_anchor.name.match(/^K(\d+[a-z]?)P(\d+[a-z]?)$/i);
  const chapterlessAnchorParts = artifact.publisher_anchor.name.match(/^P(\d+[a-z]?)$/i);
  const anchorEncodingExplanation = chapteredAnchorParts
    ? `<strong>K${htmlEscape(chapteredAnchorParts[1])}</strong> means chapter ${htmlEscape(artifact.publisher_anchor.chapter)}; <strong>P${htmlEscape(chapteredAnchorParts[2])}</strong> means section ${htmlEscape(artifact.publisher_anchor.section)}.`
    : chapterlessAnchorParts
      ? `<strong>P${htmlEscape(chapterlessAnchorParts[1])}</strong> means section ${htmlEscape(artifact.publisher_anchor.section)} in a chapterless Act.`
      : "The anchor name is preserved exactly because its encoding is not recognized by this explainer.";
  const nextAnchorLocator = nextAnchor
    ? `${nextAnchor.chapter ? `${nextAnchor.chapter} kap. ` : ""}${nextAnchor.section} §`
    : null;
  const countDifference = artifact.automatic_capability.text_candidate_count
    - artifact.automatic_capability.html_anchor_count;
  const boundaryHeading = artifact.review_context.following_boundary_context
    .find((item) => item.line === artifact.boundary.end_line_exclusive)?.text ?? "Following standalone heading";
  const interveningCandidateLabels = interveningCandidates
    .map((candidate) => `${candidate.chapter ? `${candidate.chapter} kap. ` : ""}${candidate.section} §`);
  const countRelationship = interveningCandidates.length
    ? `<div class="scale-link"><span class="scale-total"><strong>${artifact.automatic_capability.html_anchor_count}</strong> publisher anchors</span><span class="scale-arrow" aria-hidden="true">→</span><span class="scale-total"><strong>${artifact.automatic_capability.text_candidate_count}</strong> text candidates</span><span class="scale-equals">This provision contains <strong>${interveningCandidates.length}</strong> intervening heading-like text candidates${countDifference === interveningCandidates.length ? ", matching the source's net +" + countDifference + " count gap" : " within the wider source mismatch"}.</span><div class="candidate-chips">${interveningCandidateLabels.map((label) => `<code>${htmlEscape(label)}</code>`).join("")}</div><small>Matching counts provide context; they do not clear other source-wide differences.</small></div>`
    : "";
  const triggerBridge = `${htmlEscape(orientation.localEvidence)}${orientation.evidenceTarget ? ` <a href="#${orientation.evidenceTarget}">${htmlEscape(orientation.evidenceLink)}</a>.` : ""} ${htmlEscape(orientation.limit)}`;
  const mismatchSignals = renderSignalCards(artifact.review_signals);
  const reviewQuestions = buildReviewQuestions(artifact);
  const questionControls = reviewQuestions.map((question) => `<fieldset class="review-question"><legend>${htmlEscape(question.text)}</legend><div class="review-options"><label><input type="radio" name="review-${question.id}" value="yes">Yes</label><label><input type="radio" name="review-${question.id}" value="cannot_confirm">Cannot confirm</label></div></fieldset>`).join("");
  const candidateComparison = artifact.review_context.same_locator_candidates.length > 1
    ? `<aside class="candidate-explainer" aria-labelledby="candidate-heading"><div><span class="status-pill">Why the parser paused</span><h3 id="candidate-heading">Several lines look like “${htmlEscape(artifact.locator.section)} §”, but only one matches this publisher anchor</h3><p>The parser reports each candidate. The reviewer is being asked to confirm the publisher-matched start and the complete provision boundary.</p>${countRelationship}</div><div class="candidate-list">${artifact.review_context.same_locator_candidates.map((candidate) => {
      const isTarget = candidate.position === targetCandidate.position;
      return `<div class="candidate-row ${isTarget ? "candidate-target" : "candidate-lookalike"}"><span class="candidate-marker" aria-hidden="true">${isTarget ? "✓" : "≠"}</span><div><strong>Line ${candidate.start_line} · offset ${candidate.start_offset}</strong><code>${htmlEscape(`${artifact.locator.section} § ${candidate.heading_text}`)}</code><small>${isTarget ? `Matches publisher anchor ${artifact.publisher_anchor.name}; proposed provision start.` : "No corresponding publisher anchor at this line; it is inside the proposed provision, not its anchored start."}</small></div></div>`;
    }).join("")}</div></aside>`
    : "";
  const decisionFilename = `${safeFileSegment(artifact.source.authority_id)}--${safeFileSegment(artifact.locator.canonical)}--decision.json`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Locator review — ${htmlEscape(artifact.locator.canonical)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17201d;
      --muted: #5d6964;
      --line: #d7ddd9;
      --paper: #fffef9;
      --surface: #f3f5f1;
      --surface-strong: #e9ede8;
      --green: #164f3b;
      --green-soft: #e6f0eb;
      --amber: #925816;
      --amber-soft: #fbf1df;
      --blue: #345b72;
      --blue-soft: #e8f0f4;
      --shadow: 0 18px 50px rgba(30, 45, 39, .09);
      font: 16px/1.55 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: #e9ede9; }
    .shell { max-width: 78rem; margin: 0 auto; background: var(--paper); min-height: 100vh; box-shadow: var(--shadow); }
    header { padding: 1.6rem clamp(1.25rem, 5vw, 4.75rem) 1.45rem; color: white; background: var(--green); }
    .eyebrow { margin: 0 0 .8rem; color: #c7dbd1; font-size: .75rem; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; }
    h1 { margin: 0; font: 600 clamp(2rem, 3.4vw, 3rem)/1.08 Georgia, "Times New Roman", serif; letter-spacing: -.025em; }
    .lede { max-width: 52rem; margin: .55rem 0 0; color: #dfebe5; font-size: .96rem; }
    .header-meta { display: flex; flex-wrap: wrap; gap: .55rem; margin-top: .85rem; }
    .badge { display: inline-flex; align-items: center; gap: .42rem; border: 1px solid currentColor; border-radius: 999px; padding: .32rem .7rem; font-size: .78rem; font-weight: 700; letter-spacing: .015em; }
    .badge::before { content: ""; width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; }
    .badge-light { color: #d9e8e0; }
    main { padding: 0 clamp(1.25rem, 5vw, 4.75rem) 4.5rem; }
    .scope-contract { display: grid; grid-template-columns: auto 1fr; gap: .8rem; margin: 0 -1rem 1.25rem; padding: .9rem 1rem; background: var(--amber-soft); border-bottom: 1px solid #ead4af; }
    .scope-icon { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: 50%; color: white; background: var(--amber); font-weight: 800; }
    .scope-contract h2 { margin: 0 0 .22rem; font-size: 1rem; }
    .scope-contract p { margin: 0; color: #674a27; }
    section { margin: 1.8rem 0; }
    .section-kicker { margin: 0 0 .35rem; color: var(--green); font-size: .72rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h2 { margin: 0; font: 600 1.65rem/1.2 Georgia, "Times New Roman", serif; }
    h3 { margin: 0 0 .7rem; font-size: .9rem; }
    .section-intro { max-width: 48rem; margin: .55rem 0 1.25rem; color: var(--muted); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
    .card { border: 1px solid var(--line); border-radius: .8rem; padding: 1.25rem; background: white; }
    .card a { color: var(--blue); font-weight: 750; }
    .card h3 { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
    .card p:last-child { margin-bottom: 0; }
    .status-pill { flex: none; border-radius: 999px; padding: .25rem .55rem; color: var(--amber); background: var(--amber-soft); font: 750 .7rem/1.2 ui-sans-serif, sans-serif; letter-spacing: .045em; text-transform: uppercase; }
    .identity { margin: .4rem 0 .2rem; font: 600 1.16rem/1.35 Georgia, "Times New Roman", serif; }
    .metadata { display: grid; grid-template-columns: max-content 1fr; gap: .35rem .75rem; margin: 1rem 0 0; font-size: .85rem; }
    .metadata dt { color: var(--muted); }
    .metadata dd { margin: 0; overflow-wrap: anywhere; }
    code, pre { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    code { font-size: .9em; }
    .issue-list { margin: .8rem 0 0; padding-left: 1.2rem; color: #5f4a2d; }
    .issue-list li + li { margin-top: .45rem; }
    .anchor-primer { margin: 1.25rem 0; overflow: hidden; border: 1px solid #c6d4cc; border-radius: .9rem; background: white; box-shadow: 0 8px 24px rgba(30, 45, 39, .05); }
    .anchor-primer > summary { padding: .85rem 1.15rem; color: var(--green); background: var(--green-soft); font-weight: 750; }
    .anchor-primer[open] > summary { border-bottom: 1px solid #c6d4cc; }
    .primer-heading { display: grid; grid-template-columns: 2.5rem 1fr; gap: .9rem; padding: 1.25rem 1.35rem; color: white; background: #294d3e; }
    .primer-heading .scope-icon { color: var(--green); background: #dbe9e1; }
    .primer-heading h3 { margin: 0 0 .25rem; font: 600 1.25rem/1.2 Georgia, "Times New Roman", serif; }
    .primer-heading p { margin: 0; color: #dce8e2; }
    .anchor-map { display: grid; grid-template-columns: minmax(0, 1fr) 6.5rem minmax(0, 1fr); align-items: stretch; }
    .evidence-lane { padding: 1.35rem; }
    .lane-label { display: block; margin-bottom: .55rem; color: var(--muted); font-size: .7rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    .source-code { margin: 0; padding: 1rem; white-space: pre-wrap; overflow-wrap: anywhere; color: #dcefe5; background: #142b22; border-radius: .55rem; font-size: .82rem; line-height: 1.6; }
    .anchor-token { display: inline-block; margin: .75rem 0 .45rem; padding: .35rem .65rem; border: 1px solid #a8c3b5; border-radius: .4rem; color: var(--green); background: var(--green-soft); font: 800 1rem/1.2 "SFMono-Regular", Consolas, monospace; }
    .lane-note { margin: .2rem 0 0; color: var(--muted); font-size: .83rem; }
    .map-bridge { display: grid; align-content: center; justify-items: center; gap: .2rem; color: var(--green); background: var(--surface); font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; text-align: center; }
    .map-arrow { font-size: 1.8rem; line-height: 1; }
    .line-sample { display: grid; grid-template-columns: 5.5rem 1fr; overflow: hidden; border: 1px solid var(--line); border-radius: .55rem; }
    .line-number { padding: .85rem .7rem; color: var(--blue); background: var(--blue-soft); font: 750 .78rem/1.45 ui-sans-serif, sans-serif; }
    .line-text { padding: .85rem; overflow-wrap: anywhere; font: .82rem/1.5 "SFMono-Regular", Consolas, monospace; }
    .coordinate-legend { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line); background: #fafbf8; }
    .coordinate-legend div { padding: 1rem 1.15rem; }
    .coordinate-legend div + div { border-left: 1px solid var(--line); }
    .coordinate-legend strong { display: block; margin-bottom: .25rem; color: var(--green); }
    .coordinate-legend span { display: block; color: var(--muted); font-size: .8rem; }
    .primer-conclusion { margin: 0; padding: 1rem 1.35rem; border-top: 1px solid #d9e4dd; color: #315044; background: #eef5f1; }
    .signal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: .75rem; margin-top: .9rem; }
    .signal-card { display: flex; flex-direction: column; padding: 1rem; border: 1px solid var(--line); border-radius: .65rem; background: white; }
    .signal-card h4 { margin: .55rem 0 .25rem; font-size: .86rem; }
    .signal-card p { margin: 0; color: var(--muted); font-size: .78rem; }
    .signal-cue { display: block; margin: .15rem 0 .65rem; padding: .55rem; border-radius: .4rem; color: var(--ink); background: var(--surface); font-size: .72rem; overflow-wrap: anywhere; }
    .signal-card .signal-effect { margin-top: .8rem; padding-top: .7rem; border-top: 1px solid var(--line); color: #3d4d46; }
    .signal-effect strong { display: block; margin-bottom: .2rem; color: var(--green); font-size: .65rem; letter-spacing: .06em; text-transform: uppercase; }
    .signal-state { display: inline-block; border-radius: 999px; padding: .2rem .45rem; font-size: .62rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
    .signal-state.observed { color: var(--amber); background: var(--amber-soft); }
    .signal-state.guardrail { color: var(--blue); background: var(--blue-soft); }
    .signal-state.information { color: var(--blue); background: var(--blue-soft); }
    .signal-state.blocked { color: #873b32; background: #f8e9e6; }
    .candidate-explainer { display: grid; grid-template-columns: minmax(14rem, .72fr) minmax(0, 1.28fr); gap: 1.25rem; margin: 1.25rem 0; padding: 1.25rem; border: 1px solid #e2cda8; border-radius: .8rem; background: var(--amber-soft); }
    .candidate-explainer h3 { margin: .65rem 0 .35rem; font: 600 1.18rem/1.25 Georgia, "Times New Roman", serif; }
    .candidate-explainer p { margin: 0; color: #675235; font-size: .88rem; }
    .candidate-list { display: grid; gap: .6rem; }
    .candidate-row { display: grid; grid-template-columns: 2rem 1fr; gap: .7rem; padding: .85rem; border: 1px solid #decaa8; border-radius: .55rem; background: rgba(255,255,255,.72); }
    .candidate-marker { display: grid; place-items: center; align-self: start; width: 1.75rem; height: 1.75rem; border-radius: 50%; font-weight: 850; }
    .candidate-target .candidate-marker { color: white; background: var(--green); }
    .candidate-lookalike .candidate-marker { color: var(--amber); background: #f2dfbd; }
    .candidate-row strong, .candidate-row code, .candidate-row small { display: block; }
    .candidate-row strong { font-size: .76rem; }
    .candidate-row code { margin: .25rem 0; overflow-wrap: anywhere; color: var(--ink); }
    .candidate-row small { color: var(--muted); }
    .scale-link { margin-top: 1rem; padding: .85rem; border: 1px solid #decaa8; border-radius: .55rem; background: rgba(255,255,255,.68); }
    .scale-total { display: inline-flex; align-items: baseline; gap: .25rem; color: #654820; font-size: .75rem; }
    .scale-total strong { font-size: 1.15rem; }
    .scale-arrow { display: inline-block; margin: 0 .4rem; color: var(--amber); }
    .scale-equals { display: block; margin-top: .45rem; color: var(--ink); font-size: .82rem; }
    .candidate-chips { display: flex; flex-wrap: wrap; gap: .3rem; margin: .55rem 0; }
    .candidate-chips code { padding: .18rem .4rem; border-radius: .3rem; color: #5f421d; background: #f3dfbc; font-weight: 700; }
    .scale-link small { display: block; color: var(--muted); font-size: .72rem; }
    .boundary-chain { margin: 1rem 0 1.25rem; overflow: hidden; border: 1px solid #bfd2c8; border-radius: .8rem; background: white; }
    .boundary-chain > h3 { margin: 0; padding: 1rem 1.2rem; color: white; background: var(--green); font: 600 1.05rem/1.25 Georgia, "Times New Roman", serif; }
    .boundary-path { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: stretch; padding: 1rem; background: #f6f8f5; }
    .boundary-node { padding: .9rem; border: 1px solid var(--line); border-radius: .55rem; background: white; }
    .boundary-node .lane-label { margin-bottom: .35rem; }
    .boundary-node strong, .boundary-node code, .boundary-node small { display: block; }
    .boundary-node code { margin: .25rem 0; color: var(--green); font-weight: 800; overflow-wrap: anywhere; }
    .boundary-node small { color: var(--muted); }
    .path-arrow { display: grid; place-items: center; padding: 0 .55rem; color: var(--green); font-size: 1.45rem; font-weight: 850; }
    .next-anchor-markup { margin: 0; padding: .75rem 1rem; border-top: 1px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; color: #dcefe5; background: #142b22; font-size: .76rem; }
    .reading-views { display: grid; gap: 1.25rem; margin-top: 1.25rem; }
    .reading-comparison { overflow: hidden; border: 1px solid var(--line); border-radius: .85rem; background: white; }
    .reading-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.15rem; color: white; background: #294d3e; }
    .reading-heading h3 { margin: 0; font: 600 1.08rem/1.25 Georgia, "Times New Roman", serif; }
    .reading-heading .lane-label { color: #cfe0d8; }
    .reading-coordinates { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .4rem; }
    .reading-coordinates span, .reading-warning { border-radius: 999px; padding: .24rem .52rem; background: rgba(255,255,255,.14); font-size: .68rem; font-weight: 750; }
    .reading-warning { display: block; margin: .8rem 1rem 0; color: #873b32; background: #f8e9e6; overflow-wrap: anywhere; }
    .reading-grid { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(18rem, .92fr); }
    .source-pane { min-width: 0; border-right: 1px solid var(--line); background: #f7f8f5; }
    .reader-pane { min-width: 0; background: #fffef9; }
    .pane-heading { display: flex; justify-content: space-between; gap: .7rem; padding: .75rem 1rem; border-bottom: 1px solid var(--line); }
    .pane-heading strong { font-size: .8rem; }
    .pane-heading span { color: var(--muted); font-size: .72rem; text-align: right; }
    .source-lines { max-height: 40rem; overflow: auto; padding: .55rem 0; }
    .source-line { display: grid; grid-template-columns: 4rem minmax(0, 1fr) auto; align-items: start; min-height: 1.7rem; border-left: 4px solid transparent; }
    .source-line-number { padding: .22rem .65rem; color: var(--blue); font: 750 .7rem/1.45 ui-sans-serif, sans-serif; text-align: right; }
    .source-line code { padding: .2rem .55rem; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .73rem; }
    .line-label { align-self: center; margin: .18rem .55rem .18rem .2rem; border-radius: 999px; padding: .16rem .42rem; color: #5d4524; background: var(--amber-soft); font-size: .59rem; font-weight: 800; white-space: nowrap; }
    .line-start { border-color: var(--green); background: var(--green-soft); }
    .line-flagged { border-color: var(--amber); background: var(--amber-soft); }
    .line-boundary { border-color: #873b32; background: #f8e9e6; }
    .line-next { border-color: var(--blue); background: var(--blue-soft); }
    .legal-reading { padding: 1.35rem; font: 1rem/1.7 Georgia, "Times New Roman", serif; }
    .legal-reading p { margin: 0 0 1rem; }
    .legal-reading p:first-child::first-line { font-weight: 700; }
    .reader-boundary { display: grid; grid-template-columns: 1fr auto; gap: .18rem .6rem; margin: 0 1.15rem 1rem; padding: .8rem; border-top: 3px solid var(--blue); background: var(--blue-soft); }
    .reader-boundary span { grid-column: 1 / -1; color: var(--muted); font-size: .65rem; font-weight: 800; text-transform: uppercase; }
    .reader-boundary code { color: var(--blue); }
    .presentation-note { display: block; margin: 0 1.15rem 1.15rem; color: var(--muted); }
    .reading-hash { display: grid; grid-template-columns: auto 1fr; gap: .6rem; padding: .65rem 1rem; border-top: 1px solid var(--line); color: var(--muted); background: var(--surface); font-size: .68rem; }
    .reading-hash code { overflow-wrap: anywhere; color: var(--ink); }
    details { margin-top: 1rem; border-top: 1px solid var(--line); padding-top: .9rem; }
    summary { cursor: pointer; color: var(--blue); font-weight: 700; }
    .hashes { margin: .8rem 0 0; padding: .8rem; color: var(--muted); background: var(--blue-soft); border-radius: .45rem; font-size: .73rem; overflow-wrap: anywhere; }
    .decision { border: 1px solid #bdd0c6; border-radius: .9rem; padding: clamp(1.25rem, 4vw, 2.25rem); background: var(--green-soft); }
    .effect-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: .8rem; margin: 1.25rem 0; }
    .effect { border-radius: .65rem; padding: 1rem; background: rgba(255,255,255,.68); }
    .effect h3 { margin: 0 0 .4rem; }
    .effect ul { margin: 0; padding-left: 1.1rem; color: var(--muted); font-size: .88rem; }
    .effect li + li { margin-top: .3rem; }
    .review-question { margin: .75rem 0; padding: .9rem 1rem; border: 1px solid #abc6b8; border-radius: .65rem; background: white; }
    .review-question legend { padding: 0 .25rem; font-weight: 650; }
    .review-options { display: flex; gap: 1.25rem; flex-wrap: wrap; margin-top: .25rem; }
    .review-options label { display: inline-flex; align-items: center; gap: .35rem; cursor: pointer; }
    input[type=radio] { width: 1.1rem; height: 1.1rem; accent-color: var(--green); }
    label.field { display: block; margin: 1rem 0; font-weight: 700; }
    label.field small { display: block; margin: .2rem 0 .4rem; color: var(--muted); font-weight: 400; }
    input[type=text], textarea { width: 100%; border: 1px solid #9eaaa4; border-radius: .45rem; padding: .72rem .8rem; color: var(--ink); background: white; font: inherit; }
    input:focus, textarea:focus { outline: 3px solid rgba(52,91,114,.2); border-color: var(--blue); }
    .action-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-top: 1.25rem; }
    button { border: 0; border-radius: .45rem; padding: .78rem 1rem; color: white; background: var(--green); font: 750 .92rem/1.2 inherit; cursor: pointer; box-shadow: 0 3px 0 #0c3829; }
    button:disabled { color: #7a847f; background: #d5dad7; box-shadow: none; cursor: not-allowed; }
    #message { margin: 0; color: var(--green); font-weight: 650; }
    .next-step { margin-top: 1.2rem; padding-top: 1rem; border-top: 1px solid #bdd0c6; color: var(--muted); font-size: .88rem; }
    footer { padding: 1.25rem clamp(1.25rem, 5vw, 4.75rem); color: #d7e3dd; background: #20332b; font-size: .78rem; }
    footer strong { color: white; }
    @media (max-width: 760px) {
      .grid, .effect-grid, .candidate-explainer, .reading-grid { grid-template-columns: 1fr; }
      .scope-contract { margin-inline: 0; }
      .anchor-map { grid-template-columns: 1fr; }
      .map-bridge { padding: .7rem; }
      .map-arrow { transform: rotate(90deg); }
      .coordinate-legend { grid-template-columns: 1fr; }
      .coordinate-legend div + div { border-left: 0; border-top: 1px solid var(--line); }
      .boundary-path { grid-template-columns: 1fr; gap: .5rem; }
      .path-arrow { transform: rotate(90deg); padding: .1rem; }
      .reading-heading { align-items: flex-start; flex-direction: column; }
      .reading-coordinates { justify-content: flex-start; }
      .source-pane { border-right: 0; border-bottom: 1px solid var(--line); }
      .source-line { grid-template-columns: 3.4rem minmax(0, 1fr); }
      .line-label { grid-column: 2; margin: .1rem .55rem .35rem; }
      .reading-hash { grid-template-columns: 1fr; }
    }
    @media print {
      body { background: white; }
      .shell { box-shadow: none; }
      .decision { break-inside: avoid; }
      button { display: none; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <p class="eyebrow">Legal Source Connector · Evidence review</p>
      <h1>Review one exact provision</h1>
      <p class="lede">Inspect the official-source snapshot and confirm a tightly bounded locator decision. The connector will validate it again before use.</p>
      <div class="header-meta">
        <span class="badge badge-light">Local review bundle</span>
        <span class="badge badge-light">Scope: one locator</span>
        <span class="badge badge-light">Schema ${htmlEscape(template.schema_version)}</span>
      </div>
    </header>
    <main>
      <aside class="scope-contract" aria-labelledby="scope-title">
        <div class="scope-icon" aria-hidden="true">!</div>
        <div><h2 id="scope-title">This review has a hard boundary</h2><p>It can confirm only <code>${htmlEscape(artifact.locator.canonical)}</code> in this exact snapshot. It does not change automatic capability, approve the source generally, select an I:/U: version, or decide legal effect.</p></div>
      </aside>
      <section aria-labelledby="source-heading">
        <p class="section-kicker">Step 1 · Source and stop reason</p>
        <h2 id="source-heading">Know exactly what you are reviewing</h2>
        <p class="section-intro">The source identity and both source representations are fixed into this artifact. Any later byte or version change invalidates the decision.</p>
        <details class="anchor-primer" aria-label="Publisher anchor and offset explainer">
          <summary>How the publisher anchor, line and offsets relate</summary>
          <div class="primer-heading">
            <div class="scope-icon" aria-hidden="true">?</div>
            <div><h3 id="anchor-primer-heading">First: what is a publisher anchor?</h3><p>An anchor is an invisible bookmark in Riksdagen's HTML. It is independent structural evidence—not another paragraph number and not a line count.</p></div>
          </div>
          <div class="anchor-map">
            <div class="evidence-lane">
              <span class="lane-label">Publisher's HTML representation</span>
              <pre class="source-code">${htmlEscape(artifact.publisher_anchor.source_markup ?? "Exact publisher markup unavailable in this artifact.")}</pre>
              <code class="anchor-token">${htmlEscape(artifact.publisher_anchor.name)}</code>
              <p class="lane-note">${anchorEncodingExplanation} The publisher placed this bookmark immediately before the displayed <strong>${htmlEscape(artifact.publisher_anchor.heading_text)}</strong>.</p>
            </div>
            <div class="map-bridge"><span>same legal address</span><span class="map-arrow" aria-hidden="true">→</span></div>
            <div class="evidence-lane">
              <span class="lane-label">Plain-text representation</span>
              <div class="line-sample"><span class="line-number">Line ${targetCandidate.start_line}</span><code class="line-text">${htmlEscape(`${artifact.locator.section} § ${targetCandidate.heading_text}`)}</code></div>
              <code class="anchor-token">offset ${targetCandidate.start_offset}</code>
              <p class="lane-note">The line number helps a person find the passage. The offset is the exact machine coordinate where extraction begins in this snapshot.</p>
            </div>
          </div>
          <div class="coordinate-legend">
            <div><strong>Anchor</strong><span>Publisher-assigned legal structure: <code>${htmlEscape(artifact.publisher_anchor.name)}</code>.</span></div>
            <div><strong>Line ${targetCandidate.start_line}</strong><span>Human-readable location after splitting the official plain text into lines.</span></div>
            <div><strong>Offsets ${artifact.boundary.source_offsets.start}–${artifact.boundary.source_offsets.end_exclusive}</strong><span>Exact UTF-16 range; the end is excluded so the next heading is not captured.</span></div>
          </div>
          <p class="primer-conclusion"><strong>The proposition you are reviewing:</strong> publisher bookmark <code>${htmlEscape(artifact.publisher_anchor.name)}</code> and text line ${targetCandidate.start_line} identify the same ${htmlEscape(artifact.locator.canonical)}. Extraction starts at offset ${artifact.boundary.source_offsets.start} and ends before the heading leading to ${nextAnchor ? `<code>${htmlEscape(nextAnchor.name)}</code> (${htmlEscape(nextAnchorLocator)})` : "the end of the source"}.</p>
        </details>
        <div class="grid">
          <article class="card">
            <h3>Official-source snapshot <span class="status-pill" style="color:var(--blue);background:var(--blue-soft)">Bound</span></h3>
            <p class="identity">${htmlEscape(artifact.source.title)}</p>
            <dl class="metadata">
              <dt>SFS</dt><dd>${htmlEscape(artifact.source.sfs_number)}</dd>
              <dt>Source ID</dt><dd><code>${htmlEscape(artifact.source.authority_id)}</code></dd>
              <dt>Snapshot</dt><dd><code>${htmlEscape(artifact.source.source_snapshot)}</code></dd>
              <dt>Provider</dt><dd>Sveriges riksdag</dd>
            </dl>
          </article>
          <article class="card">
            <h3>Automatic result <span class="status-pill">Review required</span></h3>
            <p><strong>Why this review opened:</strong> ${artifact.automatic_capability.html_anchor_count} publisher HTML anchors were compared with ${artifact.automatic_capability.text_candidate_count} text-parser candidates. The source maps do not align, so unreviewed locators in this snapshot cannot be confirmed automatically.</p>
            <p>${triggerBridge}</p>
            <ul class="issue-list">${capabilityIssues}</ul>
          </article>
        </div>
        <details id="source-signals">
          <summary>Show the signals actually found in this source</summary>
          <p class="section-intro">Each card separates the observed evidence, its plain-language meaning and the connector response. Only signals carried by this exact, hashed artifact appear here.</p>
          <div class="signal-grid">${mismatchSignals}</div>
        </details>
        <details>
          <summary>Show immutable source and artifact hashes</summary>
          <div class="hashes"><strong>Text SHA-256</strong><br>${artifact.source.source_text_sha256}<br><br><strong>HTML SHA-256</strong><br>${artifact.source.source_html_sha256}<br><br><strong>Review artifact SHA-256</strong><br>${artifact.artifact_sha256}</div>
        </details>
      </section>

      <section aria-labelledby="target-heading">
        <p class="section-kicker">Step 2 · Provision boundary</p>
        <h2 id="target-heading">Inspect ${htmlEscape(artifact.locator.canonical)} only</h2>
        <p class="section-intro">The comparison above explains the automatic stop. Here, check that the proposed extraction starts at this locator's publisher anchor and stops before the following provision. Duplicate-looking candidates are exposed rather than hidden.</p>
        ${candidateComparison}
        ${nextAnchor && nextPublisherCandidate ? `<aside class="boundary-chain" aria-labelledby="boundary-chain-heading"><h3 id="boundary-chain-heading">See both ends of the reviewed provision</h3><div class="boundary-path"><div class="boundary-node"><span class="lane-label">Start anchor</span><strong>${htmlEscape(artifact.locator.canonical)}</strong><code>${htmlEscape(artifact.publisher_anchor.name)}</code><small>Line ${targetCandidate.start_line} · offset ${targetCandidate.start_offset}</small></div><span class="path-arrow" aria-hidden="true">→</span><div class="boundary-node"><span class="lane-label">Stop before</span><strong>Line ${artifact.boundary.end_line_exclusive}</strong><code>${htmlEscape(boundaryHeading)}</code><small>Boundary offset ${artifact.boundary.source_offsets.end_exclusive}; this heading is not included.</small></div><span class="path-arrow" aria-hidden="true">→</span><div class="boundary-node"><span class="lane-label">Next anchored provision</span><strong>${htmlEscape(nextAnchorLocator)}</strong><code>${htmlEscape(nextAnchor.name)}</code><small>Line ${nextPublisherCandidate.start_line} · offset ${nextPublisherCandidate.start_offset}</small></div></div><pre class="next-anchor-markup">${htmlEscape(nextAnchor.source_markup ?? "Exact next-anchor markup unavailable in this artifact.")}</pre></aside>` : ""}
        <p class="section-intro"><strong>Read across:</strong> the left side preserves every source line from the provision start through the next anchored provision; the right side presents the same provision without source line wrapping. The coloured rows identify the proposition being reviewed.</p>
        <div id="trigger-evidence">${readingViews}</div>
        <details>
          <summary>Show duplicate-looking candidates and technical boundary evidence</summary>
          <div class="card"><p><strong>Selection evidence:</strong> <code>${htmlEscape(artifact.boundary.selection_evidence)}</code></p><p><strong>Same-locator candidates:</strong></p><ul>${sameLocatorCandidates}</ul><p><strong>Full provision SHA-256:</strong><br><code>${artifact.provision_text_sha256}</code></p></div>
        </details>
      </section>

      <section class="decision" aria-labelledby="decision-heading">
        <p class="section-kicker">Step 3 · Human decision</p>
        <h2 id="decision-heading">Confirm this provision's boundary</h2>
        <p class="section-intro">Answer the questions supported by this page's evidence. <a href="#trigger-evidence">Recheck the numbered source lines</a> if needed. If you cannot confirm any answer, this page will not create a decision. A saved decision is checked again on every matching lookup.</p>
        <details><summary>What this decision can and cannot do</summary><div class="effect-grid">
          <div class="effect"><h3>This decision can</h3><ul><li>release this locator for this snapshot</li><li>return it with <code>human_reviewed_snapshot</code> basis</li><li>retain your review label, time and recorded choices</li></ul></div>
          <div class="effect"><h3>This decision cannot</h3><ul><li>release another locator or the full Act</li><li>erase the <code>review_required</code> capability result</li><li>resolve a dated I:/U: version or legal applicability</li></ul></div>
        </div></details>
        ${questionControls}
        <label class="field" for="reviewer">Reviewer label<small>A local name or role label that identifies who performed this review.</small><input id="reviewer" type="text" autocomplete="name" placeholder="e.g. RK · legal review"></label>
        <label class="field" for="review-note">Optional note<small>Add anything the recorded choices do not capture. You do not need to restate the evidence above.</small><textarea id="review-note" rows="3" placeholder="Optional context for the next reviewer"></textarea></label>
        <div class="action-row"><button id="save" type="button" hidden disabled>Save review locally</button><button id="download" type="button" disabled>Download decision record</button><p id="message" role="status" aria-live="polite">Answer each question and add a reviewer label.</p></div>
        <p class="next-step"><strong>Next:</strong> a successful local save imports the decision and retries this locator. For the downloaded JSON fallback, use <code>connector/import_review_decision.mjs</code>, then <code>connector/get_provision.mjs</code>. Only a successful import changes the lookup result for this locator.</p>
      </section>
    </main>
    <footer><strong>Källa: Sveriges riksdag.</strong> This independent project is not produced, endorsed or sponsored by Sveriges riksdag. Source excerpts and reviewer details stay in the local, gitignored review area by default.</footer>
  </div>
  <script>
    const template = ${embeddedJson(template)};
    const reviewQuestions = ${embeddedJson(reviewQuestions)};
    const outputFilename = ${embeddedJson(decisionFilename)};
    function canonicalize(value) {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
      return value;
    }
    async function sha256(value) {
      const bytes = new TextEncoder().encode(value);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
    }
    const reviewer = document.getElementById("reviewer");
    const reviewNote = document.getElementById("review-note");
    const download = document.getElementById("download");
    const save = document.getElementById("save");
    const message = document.getElementById("message");
    const localSave = location.protocol === "http:"
      && location.hostname === "127.0.0.1"
      && /^\\/review\\/[a-f0-9]{48,}$/i.test(location.pathname)
      && new URLSearchParams(location.search).get("save") === "1";
    if (localSave) save.hidden = false;
    function answers() {
      return reviewQuestions.map((question) => document.querySelector('input[name="review-' + question.id + '"]:checked')?.value ?? null);
    }
    function updateReadiness() {
      const selected = answers();
      const ready = Boolean(reviewer.value.trim()) && selected.every((answer) => answer === "yes");
      download.disabled = !ready;
      save.disabled = !ready;
      message.textContent = ready
        ? "Ready to save this locator-only decision."
        : selected.includes("cannot_confirm")
          ? "No decision will be created from this page."
          : "Answer each question and add a reviewer label.";
    }
    for (const control of document.querySelectorAll(".review-question input")) control.addEventListener("change", updateReadiness);
    reviewer.addEventListener("input", updateReadiness);
    async function completedDecision() {
      const label = reviewer.value.trim();
      if (!label || !answers().every((answer) => answer === "yes")) return null;
      const note = reviewNote.value.trim();
      const rationale = "Reviewer selected Yes on the local review page for: "
        + reviewQuestions.map((question) => question.text).join(" ")
        + (note ? " Optional note: " + note : "");
      const decision = structuredClone(template);
      decision.decision_status = "confirmed";
      decision.reviewer = { label, reviewed_at: new Date().toISOString(), rationale };
      delete decision.decision_record_sha256;
      decision.decision_record_sha256 = await sha256(JSON.stringify(canonicalize(decision)));
      return decision;
    }
    save.addEventListener("click", async () => {
      const decision = await completedDecision();
      if (!decision) return updateReadiness();
      save.disabled = true;
      message.textContent = "Validating the review and retrying the locator…";
      try {
        const response = await fetch(location.pathname + "/decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(decision),
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error((result.errors || [result.warning || "Review was rejected."]).join(" "));
        message.textContent = "Saved and validated. Retry result: " + result.lookup_status
          + " (" + result.result_basis + "). Return to the host for the connector result.";
      } catch (error) {
        message.textContent = "Save failed: " + error.message + " Download the decision JSON and use the import command if needed.";
        save.disabled = false;
      }
    });
    download.addEventListener("click", async () => {
      const decision = await completedDecision();
      if (!decision) return updateReadiness();
      const blob = new Blob([JSON.stringify(decision, null, 2) + "\\n"], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = outputFilename;
      link.click();
      URL.revokeObjectURL(link.href);
      message.textContent = "Decision downloaded. This page has not approved or stored anything; import is the next validation step.";
    });
  </script>
</body>
</html>\n`;
}

export async function prepareLocatorReviewBundle(args) {
    const cached = await loadCachedDocument(args.cacheDir, args.sourceId);
    const artifact = prepareLocatorReviewSurface({
      sourceId: args.sourceId,
      requestedLocator: args.locator,
      document: cached.document,
      rawFile: cached.rawFile,
    });
    const template = artifact.review_disposition.status === "decision_available"
      ? createDecisionTemplate(artifact)
      : null;
    const caseReport = template ? null : createReviewCaseReport(artifact);
    const caseRecord = caseReport
      ? await recordReviewCase({ caseDir: args.caseDir, report: caseReport })
      : null;
    const reviewSlug = `${safeFileSegment(args.sourceId)}--${safeFileSegment(artifact.locator.canonical)}`;
    const reviewDir = join(args.outputDir, reviewSlug);
    await ensureDirectory(reviewDir);
    const artifactPath = join(reviewDir, "review-artifact.json");
    const decisionPath = join(reviewDir, "decision-template.json");
    const htmlPath = join(reviewDir, "review.html");
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    if (template) await writeFile(decisionPath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
    await writeFile(htmlPath, renderReviewHtml(artifact, template, { caseReport }), "utf8");
    return {
      status: "prepared",
      review_scope: "locator",
      authority_id: args.sourceId,
      requested_locator: args.locator,
      canonical_locator: artifact.locator.canonical,
      review_disposition: artifact.review_disposition,
      review_signals: artifact.review_signals,
      automatic_capability: artifact.automatic_capability,
      artifact_sha256: artifact.artifact_sha256,
      artifact_path: artifactPath,
      decision_template_path: template ? decisionPath : null,
      case_report: caseRecord ? {
        case_id: caseReport.case_id,
        occurrence_id: caseReport.occurrence_id,
        report_kind: caseReport.report_kind,
        local_record_status: caseRecord.status,
        local_record_path: caseRecord.recordPath,
        github_new_issue_url: caseReport.github.new_issue_url,
      } : null,
      open_target: htmlPath,
    };
}

export async function main(items = process.argv.slice(2)) {
  const args = parseArgs(items);
  if (!args.sourceId || !args.locator) {
    console.error("Usage: node connector/prepare_locator_review.mjs --source sfs-1995-1554 --locator '7 kap. 7 §'");
    process.exitCode = 2;
    return;
  }
  try {
    console.log(JSON.stringify(await prepareLocatorReviewBundle(args), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: "not_prepared", warning: error.message }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
