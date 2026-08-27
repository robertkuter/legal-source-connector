import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { riksdagenAttribution } from "../../connector/runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const sourcePath = path.join(projectRoot, "examples", "abl-primer", "primer-content.json");
const outputPath = path.join(here, "source-packet-set.json");
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

const packetSet = {
  packet_set_version: "0.1.0",
  purpose: "Controlled packet-only parity test for a reader/evidence ABL primer",
  mode: "packet-only",
  retrieval_mode: source.source.retrieval_mode,
  live_currentness_checked: false,
  authority: {
    authority_id: source.source.authority_id,
    title: source.source.title,
    source_url: source.source.source_url,
    source_html_url: source.source.source_html_url,
    consolidation_signal: source.source.consolidation_signal,
    retrieved_at: source.source.retrieved_at,
    source_snapshot: source.source.source_snapshot,
    source_text_sha256: source.source.source_text_sha256,
    source_html_sha256: source.source.source_html_sha256,
    index_version: source.source.index_version,
    capability_status: source.source.capability_status,
    temporal_capability: source.source.temporal_capability,
    attribution: source.source.attribution ?? riksdagenAttribution()
  },
  packets: source.cards.map((card) => ({
    packet_id: card.id,
    status: card.status,
    requested_locator: card.locator,
    canonical_locator: card.canonical_locator,
    role: card.role,
    section_sha256: card.section_sha256,
    source_offsets: card.source_offsets,
    offset_unit: card.offset_unit,
    anchor_name: card.anchor_name,
    packet_text: card.packet_text,
    temporal: card.temporal ?? {
      capability_status: source.source.temporal_capability.status,
      resolution: "unmarked_locator",
      markers: []
    }
  }))
};

fs.writeFileSync(outputPath, JSON.stringify(packetSet, null, 2) + "\n");
console.log(`Built ${packetSet.packets.length} packets at ${outputPath}`);
