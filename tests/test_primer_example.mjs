import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exampleDir = path.join(root, "examples", "abl-primer");
const readerDraftPath = path.join(exampleDir, "reader-draft.json");
const groundedArtifactPath = path.join(exampleDir, "grounded-artifact.json");
const htmlPath = path.join(exampleDir, "index.html");

execFileSync(process.execPath, [path.join(exampleDir, "build_grounded_artifact.mjs")], { cwd: root, stdio: "pipe" });
const readerDraft = JSON.parse(fs.readFileSync(readerDraftPath, "utf8"));
const grounded = JSON.parse(fs.readFileSync(groundedArtifactPath, "utf8"));

assert.equal(readerDraft.claims.length, 10, "the public example must contain the ten retained claims");
assert.equal(new Set(readerDraft.claims.map((claim) => claim.claim_id)).size, 10, "claim IDs must be unique");
assert.equal(grounded.claims.length, readerDraft.claims.length, "every reader claim must have an artifact record");
assert.equal(grounded.source.capability_status, "supported");
assert.equal(grounded.retrieval_mode, "cached_snapshot");
assert.equal(grounded.source.attribution.text, "Källa: Sveriges riksdag");
assert.equal(grounded.source.temporal_capability.status, "layered_unresolved");

for (const claim of readerDraft.claims) {
  assert.ok(!("packet_text" in claim), `${claim.claim_id} reader draft must not carry source text`);
  assert.ok(!("section_sha256" in claim), `${claim.claim_id} reader draft must not carry source hashes`);
  assert.ok(claim.text.length > 0, `${claim.claim_id} must carry reader prose`);
  assert.ok(claim.boundary.length > 0, `${claim.claim_id} must carry a review boundary`);
  assert.equal(claim.text.includes("selected provision"), false, `${claim.claim_id} reader prose must not sound like a source audit`);
  assert.equal(claim.text.includes("packet"), false, `${claim.claim_id} reader prose must not expose packet mechanics`);
}

for (const claim of grounded.claims) {
  assert.equal(claim.grounding_status, "grounded", `${claim.claim_id} must be grounded`);
  assert.equal(claim.evidence.length, claim.packet_ids.length, `${claim.claim_id} evidence count must match packet IDs`);
  for (const evidence of claim.evidence) {
    assert.equal(evidence.status, "found", `${claim.claim_id} evidence must be found`);
    assert.equal(evidence.canonical_locator, evidence.requested_locator, `${claim.claim_id} locator must not drift`);
    assert.match(evidence.section_sha256, /^[0-9a-f]{64}$/, `${claim.claim_id} must carry a SHA-256 section hash`);
    assert.ok(evidence.packet_text.length > 0, `${claim.claim_id} must carry exact packet text`);
    const normalized = evidence.packet_text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
    const actualHash = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
    assert.equal(actualHash, evidence.section_sha256, `${claim.claim_id} packet text must reproduce its section hash`);
    assert.ok(evidence.source_offsets.start < evidence.source_offsets.end_exclusive, `${claim.claim_id} offsets must increase`);
  }
}

const locators = grounded.claims.flatMap((claim) => claim.evidence.map((evidence) => evidence.canonical_locator));
assert.equal(locators.includes("7 kap. 40 §"), false, "ambiguous 7 kap. 40 § must stay excluded");
assert.equal(locators.includes("13 kap. 35 §"), false, "ungrounded 13 kap. 35 § must stay excluded");

execFileSync(process.execPath, [path.join(exampleDir, "render_primer.mjs")], { cwd: root, stdio: "pipe" });
const html = fs.readFileSync(htmlPath, "utf8");
for (const claim of readerDraft.claims) {
  assert.match(html, new RegExp(`card-${claim.claim_id}`), `${claim.claim_id} must render`);
  for (const packetId of claim.packet_ids) assert.match(html, new RegExp(`Packet ${packetId}`), `${packetId} evidence must render`);
}
assert.match(html, /Reader view/);
assert.match(html, /Show evidence/);
assert.match(html, /Open all evidence/);
assert.match(html, /What still needs checking/);
assert.match(html, /cached Riksdagen snapshot/);
assert.match(html, /Källa: Sveriges riksdag/);
assert.match(html, /not produced, endorsed or sponsored by Sveriges riksdag/);

console.log(JSON.stringify({
  suite: "abl-primer-example-v0.2",
  claims: readerDraft.claims.length,
  passed: true,
  generated_html: htmlPath,
}, null, 2));
