#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { importReviewDecision } from "./locator_review.mjs";
import { loadCachedDocument } from "./sfs_index.mjs";
import {
  defaultCacheDir,
  defaultReviewStoreDir,
  resolveUserPath,
} from "./runtime.mjs";

function parseArgs(items) {
  const result = { cacheDir: defaultCacheDir(), storeDir: defaultReviewStoreDir() };
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] === "--artifact") result.artifactPath = resolveUserPath(items[++i]);
    else if (items[i] === "--decision") result.decisionPath = resolveUserPath(items[++i]);
    else if (items[i] === "--cache-dir") result.cacheDir = resolveUserPath(items[++i], result.cacheDir);
    else if (items[i] === "--review-store") result.storeDir = resolveUserPath(items[++i], result.storeDir);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (!args.artifactPath || !args.decisionPath) {
  console.error("Usage: node connector/import_review_decision.mjs --artifact review-artifact.json --decision completed-review-decision.json");
  process.exit(2);
}

try {
  const artifact = JSON.parse(await readFile(args.artifactPath, "utf8"));
  const decision = JSON.parse(await readFile(args.decisionPath, "utf8"));
  const sourceId = artifact?.source?.authority_id;
  if (!sourceId) throw new Error("The artifact has no source authority ID.");
  const cached = await loadCachedDocument(args.cacheDir, sourceId);
  const result = await importReviewDecision({
    artifact,
    decision,
    sourceId,
    document: cached.document,
    rawFile: cached.rawFile,
    storeDir: args.storeDir,
  });
  const output = { ...result, review_store: args.storeDir };
  const stream = result.status === "imported" ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(output, null, 2)}\n`);
  if (result.status !== "imported") process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: "rejected", errors: [error.message] }, null, 2));
  process.exitCode = 1;
}
