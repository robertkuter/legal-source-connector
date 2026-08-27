import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groundClaims } from "../../connector/render_grounded_claims.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const content = JSON.parse(fs.readFileSync(path.join(here, "primer-content.json"), "utf8"));
const packetSet = JSON.parse(fs.readFileSync(
  path.join(here, "..", "..", "evals", "abl-primer-parity", "source-packet-set.json"),
  "utf8",
));

// This adapter turns the existing primer cards into the smaller shape a model
// should return. The packet text and provenance are deliberately left out.
const readerDraft = {
  draft_version: "0.2.0",
  mode: "packet-only",
  source_path: "packet-only",
  retrieval_mode: "cached_snapshot",
  live_currentness_checked: false,
  output_language: "en",
  title: content.title,
  subtitle: content.subtitle,
  audience: content.audience,
  purpose: content.purpose,
  claims: content.cards.map((card) => ({
    claim_id: card.id,
    topic: card.section,
    title: card.title,
    text: card.plain_english,
    boundary: card.applicability,
    packet_ids: [card.id],
  })),
};

fs.writeFileSync(path.join(here, "reader-draft.json"), JSON.stringify(readerDraft, null, 2) + "\n");
const artifact = groundClaims(readerDraft, packetSet);
artifact.title = readerDraft.title;
artifact.subtitle = readerDraft.subtitle;
artifact.audience = readerDraft.audience;
artifact.purpose = readerDraft.purpose;
fs.writeFileSync(path.join(here, "grounded-artifact.json"), JSON.stringify(artifact, null, 2) + "\n");
console.log(`Built ${artifact.claims.length} grounded claims from the reader draft`);
