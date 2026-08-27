import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { groundClaims } from "../connector/render_grounded_claims.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exampleDir = path.join(root, "examples", "abl-primer");
const packetSet = JSON.parse(fs.readFileSync(
  path.join(root, "evals", "abl-primer-parity", "source-packet-set.json"),
  "utf8",
));

execFileSync(process.execPath, [path.join(exampleDir, "build_grounded_artifact.mjs")], { cwd: root, stdio: "pipe" });
const readerDraft = JSON.parse(fs.readFileSync(path.join(exampleDir, "reader-draft.json"), "utf8"));
const artifact = JSON.parse(fs.readFileSync(path.join(exampleDir, "grounded-artifact.json"), "utf8"));

assert.equal(readerDraft.claims.length, 10);
assert.equal(artifact.artifact_version, "0.2.0");
assert.equal(artifact.claims.length, readerDraft.claims.length);
assert.equal(artifact.mode, "packet-only");
assert.equal(artifact.live_currentness_checked, false);
assert.equal(artifact.output_language, "en");
assert.equal(artifact.source_language, "sv");
assert.equal(artifact.source.attribution.text, "Källa: Sveriges riksdag");
assert.equal(artifact.source.temporal_capability.status, "layered_unresolved");

for (const claim of readerDraft.claims) {
  assert.ok(!("packet_text" in claim), `${claim.claim_id} reader draft must not contain source text`);
  assert.ok(!("section_sha256" in claim), `${claim.claim_id} reader draft must not contain source hashes`);
}

for (const claim of artifact.claims) {
  assert.equal(claim.grounding_status, "grounded");
  assert.equal(claim.evidence.length, claim.packet_ids.length);
  for (const evidence of claim.evidence) {
    const normalized = evidence.packet_text.replace(/\r\n?/g, "\n").trim();
    const actualHash = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
    assert.equal(actualHash, evidence.section_sha256, `${claim.claim_id} evidence hash must be deterministic`);
    assert.ok(evidence.packet_text.length > 0);
    assert.equal(evidence.status, "found");
    assert.equal(evidence.canonical_locator, evidence.requested_locator);
    assert.equal(evidence.attribution.text, "Källa: Sveriges riksdag");
    assert.ok(evidence.source_offsets.start < evidence.source_offsets.end_exclusive);
  }
}

const badDraft = {
  mode: "packet-only",
  source_path: "packet-only",
  retrieval_mode: "cached_snapshot",
  live_currentness_checked: false,
  claims: [{ claim_id: "C-bad", text: "Unsupported claim", packet_ids: ["P999"] }],
};
assert.throws(() => groundClaims(badDraft, packetSet), /unknown packet P999/);

const ungroundedDraft = {
  ...badDraft,
  claims: [{ claim_id: "C-unknown", text: "Needs a human check", packet_ids: [], grounding_status: "ungrounded" }],
};
const ungroundedArtifact = groundClaims(ungroundedDraft, packetSet);
assert.equal(ungroundedArtifact.claims[0].grounding_status, "ungrounded");
assert.deepEqual(ungroundedArtifact.claims[0].evidence, []);

const swedishArtifact = groundClaims({
  ...badDraft,
  output_language: "sv",
  claims: [{ claim_id: "C-sv", text: "Styrelsen har ett aktivt ansvar.", packet_ids: ["P02"] }],
}, packetSet);
assert.equal(swedishArtifact.output_language, "sv");
assert.equal(swedishArtifact.source_language, "sv");
assert.equal(swedishArtifact.claims[0].evidence[0].packet_text, packetSet.packets.find((packet) => packet.packet_id === "P02").packet_text);

console.log(JSON.stringify({
  suite: "grounded-claims-harness-v0.2",
  passed: true,
  claims: artifact.claims.length,
  checks: ["reader_draft_has_no_evidence", "deterministic_evidence_enrichment", "unknown_packet_rejected", "explicit_ungrounded_allowed"],
}, null, 2));
