import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const readerDraftPath = path.join(here, "reader-draft.json");
const groundedArtifactPath = path.join(here, "grounded-artifact.json");
const outputPath = path.join(here, "index.html");
const content = JSON.parse(fs.readFileSync(readerDraftPath, "utf8"));
const grounded = JSON.parse(fs.readFileSync(groundedArtifactPath, "utf8"));
const evidenceByClaim = new Map(grounded.claims.map((claim) => [claim.claim_id, claim.evidence]));

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function paragraph(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function evidence(card) {
  const source = grounded.source;
  const evidenceItems = evidenceByClaim.get(card.claim_id) || [];
  const locator = evidenceItems.map((item) => item.canonical_locator).join(", ") || "not grounded";
  const evidenceHtml = evidenceItems.map((item) => `<div class="evidence-item">
    <p class="evidence-label">Packet ${escapeHtml(item.packet_id)} · quoted excerpt — verbatim packet text</p>
    <blockquote lang="sv">${paragraph(item.packet_text)}</blockquote>
    <dl class="provenance">
      <dt>Packet ID</dt><dd>${escapeHtml(item.packet_id)}</dd>
      <dt>Authority</dt><dd>${escapeHtml(item.authority_title)} (${escapeHtml(item.authority_id)})</dd>
      <dt>Exact locator</dt><dd>${escapeHtml(item.canonical_locator)}</dd>
      <dt>Source status</dt><dd>${escapeHtml(item.status)}; capability ${escapeHtml(item.capability_status)}</dd>
      <dt>Timing status</dt><dd>${escapeHtml(item.temporal_capability?.status ?? "not recorded")}; this selected locator has no inline transition marker</dd>
      <dt>Consolidation marker</dt><dd>${escapeHtml(item.consolidation_signal)}</dd>
      <dt>Retrieval mode</dt><dd>${escapeHtml(grounded.retrieval_mode)} — not a live currentness check</dd>
      <dt>Snapshot</dt><dd>${escapeHtml(item.retrieved_at)}; ${escapeHtml(item.source_snapshot)}</dd>
      <dt>Section hash</dt><dd class="hash">${escapeHtml(item.section_sha256)}</dd>
      <dt>Offsets</dt><dd>${escapeHtml(item.source_offsets.start)}–${escapeHtml(item.source_offsets.end_exclusive)} (${escapeHtml(item.offset_unit)})</dd>
    </dl>
  </div>`).join("\n");
  return `<details class="evidence" data-evidence-for="${escapeHtml(card.claim_id)}">
  <summary>Show source grounding — ${escapeHtml(locator)}</summary>
  <div class="evidence-body">
    ${evidenceHtml || '<p>This claim is not grounded in a supplied packet.</p>'}
    <p><a href="${escapeHtml(source.source_html_url)}">Open the official Riksdagen HTML source</a> · <a href="${escapeHtml(source.source_url)}">Text endpoint</a></p>
  </div>
</details>`;
}

const groups = [];
for (const card of content.claims) {
  let group = groups.find((item) => item.title === card.topic);
  if (!group) {
    group = { title: card.topic, cards: [] };
    groups.push(group);
  }
  group.cards.push(card);
}

const sections = groups.map((group) => `<section class="topic" id="${escapeHtml(group.cards[0].claim_id)}">
  <h2>${escapeHtml(group.title)}</h2>
  ${group.cards.map((card) => `<article class="card" id="card-${escapeHtml(card.claim_id)}">
    <div class="card-heading"><h3>${escapeHtml(card.title)}</h3><span class="locator">${escapeHtml(card.packet_ids.join(", "))}</span></div>
    <p><strong>Plain-English explanation.</strong> ${escapeHtml(card.text)}</p>
    <p class="boundary"><strong>What still needs checking.</strong> ${escapeHtml(card.boundary)}</p>
    ${evidence(card)}
  </article>`).join("\n")}
</section>`).join("\n");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(content.title)}</title>
  <style>
    :root { --ink:#18283d; --muted:#536274; --blue:#1d568d; --line:#d8e0e8; --panel:#f4f7fa; --gold:#8b5f00; }
    * { box-sizing:border-box; }
    body { margin:0; color:var(--ink); background:#eef2f6; font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { max-width:980px; margin:0 auto; padding:42px 28px 70px; background:white; min-height:100vh; }
    h1,h2,h3 { line-height:1.15; color:var(--blue); }
    h1 { margin:0; font-size:clamp(2.3rem,6vw,4.5rem); letter-spacing:-.04em; max-width:800px; }
    h2 { margin:2.2rem 0 1rem; font-size:2rem; border-top:1px solid var(--line); padding-top:1.6rem; }
    h3 { margin:0; font-size:1.25rem; }
    .eyebrow { color:var(--blue); text-transform:uppercase; letter-spacing:.14em; font-weight:700; }
    .subtitle { color:var(--muted); font-size:1.15rem; font-style:italic; }
    .meta { color:var(--muted); font-size:.92rem; }
    .notice { background:var(--panel); border-left:4px solid var(--blue); padding:1rem 1.2rem; margin:1.5rem 0; }
    .controls { position:sticky; top:0; z-index:2; display:flex; flex-wrap:wrap; gap:.7rem; padding:.75rem 0; background:rgba(255,255,255,.95); border-bottom:1px solid var(--line); }
    button { border:1px solid var(--blue); border-radius:999px; padding:.55rem .9rem; background:white; color:var(--blue); font:inherit; cursor:pointer; }
    button:hover, button.active { background:var(--blue); color:white; }
    .card { border:1px solid var(--line); border-radius:10px; padding:1.15rem 1.25rem; margin:1rem 0 1.35rem; }
    .card-heading { display:flex; justify-content:space-between; gap:1rem; align-items:baseline; }
    .locator { flex:0 0 auto; color:var(--gold); font-weight:700; font-size:.92rem; }
    .boundary { color:var(--muted); }
    .evidence { margin-top:1rem; border-top:1px solid var(--line); padding-top:.8rem; }
    summary { color:var(--gold); font-weight:700; cursor:pointer; }
    .evidence-body { background:#fffaf0; border-left:4px solid #c48a13; padding:1rem 1.1rem; margin-top:.8rem; }
    .evidence-label { color:var(--gold); font-weight:700; margin-top:0; }
    blockquote { margin:0 0 1rem; padding:.8rem 1rem; background:white; border-left:3px solid #bcccdc; white-space:normal; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.9rem; }
    .provenance { display:grid; grid-template-columns:minmax(130px, .35fr) 1fr; gap:.2rem .8rem; font-size:.86rem; }
    .provenance dt { color:var(--muted); font-weight:700; }
    .provenance dd { margin:0; overflow-wrap:anywhere; }
    .hash { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.78rem; }
    a { color:var(--blue); }
    footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--muted); font-size:.9rem; }
    body.reader-only .evidence { display:none; }
    @media (max-width:650px) { main { padding:28px 18px 50px; } .card-heading { display:block; } .locator { display:block; margin-top:.3rem; } .provenance { grid-template-columns:1fr; gap:0; } .provenance dd { margin-bottom:.6rem; } }
  </style>
</head>
<body>
<main>
  <p class="eyebrow">Grounded orientation</p>
  <h1>${escapeHtml(content.title)}</h1>
  <p class="subtitle">${escapeHtml(content.subtitle)}</p>
  <p class="meta">${escapeHtml(grounded.source.title)} · ${content.claims.length} selected references · source snapshot ${escapeHtml(grounded.source.retrieved_at.slice(0,10))}</p>
  <div class="notice">
    <p><strong>Static, dated example.</strong> This page does not call the connector or Riksdagen, download legislation, create a packet or receipt, or check whether the source is current. It presents a teaching set from the source snapshot dated ${escapeHtml(grounded.source.retrieved_at.slice(0,10))}. The official-source links open Riksdagen separately.</p>
    <p><strong>How to read this.</strong> The English text is orientation. The expandable evidence areas show the exact Swedish packet text and provenance. The packets do not provide legal interpretation or advice.</p>
  </div>
  <div class="controls" aria-label="View controls">
    <button id="reader-button" class="active" type="button">Reader view</button>
    <button id="evidence-button" type="button">Show evidence</button>
    <button id="all-button" type="button">Open all evidence</button>
  </div>
  <div id="topics">${sections}</div>
  <footer>
    <p><strong>${escapeHtml(grounded.source.attribution.text)}</strong></p>
    <p>${escapeHtml(grounded.source.attribution.non_endorsement)}</p>
    <p><strong>Source boundary:</strong> this static example uses a cached Riksdagen snapshot dated ${escapeHtml(grounded.source.retrieved_at)} with consolidation marker ${escapeHtml(grounded.source.consolidation_signal)}. It does not call the connector or Riksdagen, download legislation, create packets or receipts, or perform a live currentness check.</p>
    <p>For a real company or transaction, check the current official source, the company’s documents and records, and obtain advice from a qualified Swedish lawyer.</p>
  </footer>
</main>
<script>
  const body = document.body;
  const readerButton = document.getElementById('reader-button');
  const evidenceButton = document.getElementById('evidence-button');
  const allButton = document.getElementById('all-button');
  const evidence = [...document.querySelectorAll('.evidence')];
  function setMode(mode) {
    const reader = mode === 'reader';
    body.classList.toggle('reader-only', reader);
    readerButton.classList.toggle('active', reader);
    evidenceButton.classList.toggle('active', !reader);
  }
  readerButton.addEventListener('click', () => setMode('reader'));
  evidenceButton.addEventListener('click', () => setMode('evidence'));
  allButton.addEventListener('click', () => {
    setMode('evidence');
    evidence.forEach((item) => { item.open = true; });
  });
</script>
</body>
</html>
`;

fs.writeFileSync(outputPath, html);
console.log(`Rendered ${content.claims.length} claims to ${outputPath}`);
