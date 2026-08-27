import fs from "node:fs";
import crypto from "node:crypto";
import { riksdagenAttribution } from "./runtime.mjs";

function normalize(value) {
  return String(value).replace(/\r\n?/g, "\n").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function buildEvidence(packet, packetSet) {
  const text = normalize(packet.packet_text);
  const actualHash = sha256(text);
  if (actualHash !== packet.section_sha256) {
    throw new Error(`${packet.packet_id} packet_text does not reproduce section_sha256`);
  }

  return {
    packet_id: packet.packet_id,
    status: packet.status,
    requested_locator: packet.requested_locator,
    canonical_locator: packet.canonical_locator,
    role: packet.role,
    packet_text: packet.packet_text,
    section_sha256: packet.section_sha256,
    source_offsets: packet.source_offsets,
    offset_unit: packet.offset_unit,
    anchor_name: packet.anchor_name,
    authority_id: packetSet.authority.authority_id,
    authority_title: packetSet.authority.title,
    source_url: packetSet.authority.source_url,
    source_html_url: packetSet.authority.source_html_url,
    consolidation_signal: packetSet.authority.consolidation_signal,
    retrieved_at: packetSet.authority.retrieved_at,
    source_snapshot: packetSet.authority.source_snapshot,
    source_text_sha256: packetSet.authority.source_text_sha256,
    source_html_sha256: packetSet.authority.source_html_sha256,
    index_version: packetSet.authority.index_version,
    capability_status: packetSet.authority.capability_status,
    temporal_capability: packetSet.authority.temporal_capability ?? null,
    attribution: packetSet.authority.attribution ?? riksdagenAttribution(),
  };
}

/**
 * Enrich a model-produced reader draft with deterministic source evidence.
 *
 * The draft owns the explanation. The packet set owns the quotation and
 * provenance. The model never gets to rewrite the evidence fields here.
 */
export function groundClaims(draft, packetSet) {
  assertString(draft.mode, "draft.mode");
  assertString(draft.source_path, "draft.source_path");
  assertString(draft.retrieval_mode, "draft.retrieval_mode");
  const outputLanguage = draft.output_language || draft.language || "en";
  assertString(outputLanguage, "draft.output_language");
  if (draft.live_currentness_checked !== false) {
    throw new Error("packet-only drafts must set live_currentness_checked to false");
  }
  if (!Array.isArray(draft.claims) || draft.claims.length === 0) {
    throw new Error("draft.claims must contain at least one claim");
  }
  if (!packetSet?.authority?.authority_id || !Array.isArray(packetSet.packets)) {
    throw new Error("packet set is missing authority or packets");
  }

  const packets = new Map(packetSet.packets.map((packet) => [packet.packet_id, packet]));
  const claimIds = new Set();
  const claims = draft.claims.map((claim, index) => {
    const claimId = claim.claim_id || `C${String(index + 1).padStart(2, "0")}`;
    if (claimIds.has(claimId)) throw new Error(`duplicate claim_id: ${claimId}`);
    claimIds.add(claimId);
    assertString(claim.text, `${claimId}.text`);
    if (!Array.isArray(claim.packet_ids) || claim.packet_ids.length === 0) {
      if (claim.grounding_status !== "ungrounded") {
        throw new Error(`${claimId} needs packet_ids or grounding_status=ungrounded`);
      }
    }

    const evidence = (claim.packet_ids || []).map((packetId) => {
      const packet = packets.get(packetId);
      if (!packet) throw new Error(`${claimId} refers to unknown packet ${packetId}`);
      if (packet.status !== "found") throw new Error(`${packetId} is not safe evidence: ${packet.status}`);
      return buildEvidence(packet, packetSet);
    });

    return {
      claim_id: claimId,
      topic: claim.topic || null,
      title: claim.title || null,
      text: claim.text,
      boundary: claim.boundary || null,
      packet_ids: claim.packet_ids || [],
      grounding_status: evidence.length > 0 ? "grounded" : "ungrounded",
      evidence,
    };
  });

  return {
    artifact_version: "0.2.0",
    mode: draft.mode,
    source_path: draft.source_path,
    retrieval_mode: draft.retrieval_mode,
    live_currentness_checked: draft.live_currentness_checked,
    output_language: outputLanguage,
    source_language: "sv",
    source: {
      authority_id: packetSet.authority.authority_id,
      title: packetSet.authority.title,
      source_url: packetSet.authority.source_url,
      source_html_url: packetSet.authority.source_html_url,
      consolidation_signal: packetSet.authority.consolidation_signal,
      retrieved_at: packetSet.authority.retrieved_at,
      source_snapshot: packetSet.authority.source_snapshot,
      source_text_sha256: packetSet.authority.source_text_sha256,
      source_html_sha256: packetSet.authority.source_html_sha256,
      index_version: packetSet.authority.index_version,
      capability_status: packetSet.authority.capability_status,
      temporal_capability: packetSet.authority.temporal_capability ?? null,
      attribution: packetSet.authority.attribution ?? riksdagenAttribution(),
    },
    claims,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) throw new Error(`unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`missing value for --${key}`);
    args[key] = next;
    index += 1;
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.draft || !args.packets) {
    throw new Error("usage: node connector/render_grounded_claims.mjs --draft draft.json --packets packet-set.json [--output artifact.json]");
  }
  const draft = JSON.parse(fs.readFileSync(args.draft, "utf8"));
  const packetSet = JSON.parse(fs.readFileSync(args.packets, "utf8"));
  const artifact = groundClaims(draft, packetSet);
  const output = JSON.stringify(artifact, null, 2) + "\n";
  if (args.output) fs.writeFileSync(args.output, output);
  else process.stdout.write(output);
  if (args.output) console.error(`Rendered ${artifact.claims.length} claims with deterministic evidence to ${args.output}`);
}
