#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listedInSwedishAct, parseArticleLocator, sha256, writeCisgAnnexIndex } from "./cisg_annex_index.mjs";
import {
  defaultCacheDir,
  defaultRunDir,
  ensureDirectory,
  riksdagenAttribution,
  resolveUserPath,
} from "./runtime.mjs";

function snapshotTimestamp(rawFile) {
  const match = String(rawFile ?? "").match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return match ? `${match[1]}:${match[2]}:${match[3]}.${match[4]}Z` : null;
}

function parseArgs(items) {
  const result = { cacheDir: defaultCacheDir(), runDir: defaultRunDir(), sourceId: "sfs-1987-822" };
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] === "--source") result.sourceId = items[++i];
    else if (items[i] === "--article") result.article = items[++i];
    else if (items[i] === "--cache-dir") result.cacheDir = resolveUserPath(items[++i], result.cacheDir);
    else if (items[i] === "--run-dir") result.runDir = resolveUserPath(items[++i], result.runDir);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.article) {
  console.error("Usage: node connector/get_cisg_article.mjs --article 'Artikel 1'");
  process.exit(2);
}

const packetGeneratedAt = new Date().toISOString();
let packet;
try {
  const parsed = parseArticleLocator(args.article);
  const indexed = await writeCisgAnnexIndex(args.cacheDir, args.sourceId);
  const sourceSnapshotAt = snapshotTimestamp(indexed.rawFile);
  const packetTiming = {
    retrieved_at: sourceSnapshotAt ?? packetGeneratedAt,
    source_snapshot_at: sourceSnapshotAt,
    packet_generated_at: packetGeneratedAt,
    retrieval_mode: "cached_snapshot",
  };
  const base = {
    packet_version: "0.2",
    packet_kind: "cisg_annex_article",
    authority_id: args.sourceId,
    source_id: indexed.document.beteckning,
    title: indexed.document.titel,
    requested_locator: args.article,
    source_url: `https://data.riksdagen.se/dokument/${args.sourceId}.text`,
    source_html_url: `https://data.riksdagen.se/dokument/${args.sourceId}.html`,
    attribution: riksdagenAttribution(),
    index_path: indexed.indexPath,
    ...packetTiming,
    consolidation_signal: indexed.document.subtitel ?? null,
    source_text_sha256: indexed.index.source_text_sha256,
    source_html_sha256: indexed.index.source_html_sha256,
    capability: indexed.index.capability,
    annex_index_version: indexed.index.index_version,
    annex_start_offset: indexed.index.annex_start_offset,
    offset_unit: indexed.index.offset_unit,
  };
  if (indexed.index.capability.status !== "supported") {
    packet = {
      status: "unknown",
      ...base,
      warning: "The CISG annex article structure has not passed its capability check. No article was returned as confirmed.",
    };
  } else {
    const matches = indexed.index.articles.filter((article) => article.article === parsed.article);
    if (matches.length === 0) {
      packet = {
        status: "not_found",
        ...base,
        warning: "The CISG annex was indexed, but the requested article was not found.",
      };
    } else {
      const match = matches[0];
      const articleText = indexed.document.text
        .slice(match.start_offset, match.end_offset_exclusive)
        .replace(/\r\n|\r/g, "\n")
        .trim();
      packet = {
        status: "found",
        ...base,
        canonical_locator: match.locator,
        text: articleText,
        section_sha256: sha256(articleText),
        statutory_scope_signal: {
          listed_in_swedish_act_1_section: listedInSwedishAct(match.article),
          explanation: listedInSwedishAct(match.article)
            ? "The Swedish Act's 1 § lists this CISG article among the provisions stated to apply as Swedish law."
            : "The translated annex contains this article, but the Swedish Act's 1 § does not list it among Articles 1-88 and 100.",
        },
        anchor_name: `Artikel ${match.article}`,
        source_snapshot: indexed.rawFile,
        source_offsets: {
          start: match.start_offset,
          end_exclusive: match.end_offset_exclusive,
        },
        note: "Retrieved Swedish CISG annex text; not legal advice or an applicability determination. The Swedish Act's statutory sections are a separate source layer.",
      };
    }
  }
} catch (error) {
  packet = {
    packet_version: "0.2",
    status: "unknown",
    packet_kind: "cisg_annex_article",
    authority_id: args.sourceId,
    requested_locator: args.article,
    retrieved_at: packetGeneratedAt,
    packet_generated_at: packetGeneratedAt,
    retrieval_mode: "unknown",
    warning: error.message,
  };
}

const safeArticle = String(args.article).replaceAll(/[^0-9a-z]+/gi, "-").replace(/^-|-$/g, "");
await ensureDirectory(args.runDir);
const runPath = join(args.runDir, `cisg-article-${args.sourceId}-${safeArticle}-${packetGeneratedAt.replaceAll(/[:.]/g, "-")}.json`);
await writeFile(runPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ run_receipt: runPath, ...packet }, null, 2));
