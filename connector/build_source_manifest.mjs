#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeIndex } from "./sfs_index.mjs";
import { buildSourceManifest } from "./source_manifest.mjs";
import {
  defaultCacheDir,
  defaultRunDir,
  ensureDirectory,
  resolveUserPath,
  safeFileSegment,
} from "./runtime.mjs";

function parseArgs(items) {
  const result = {
    cacheDir: defaultCacheDir(),
    runDir: defaultRunDir(),
    testedLocators: [],
  };
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] === "--source") result.sourceId = items[++i];
    else if (items[i] === "--locator") result.testedLocators.push(items[++i]);
    else if (items[i] === "--cache-dir") result.cacheDir = resolveUserPath(items[++i], result.cacheDir);
    else if (items[i] === "--run-dir") result.runDir = resolveUserPath(items[++i], result.runDir);
    else if (items[i] === "--output") result.output = resolveUserPath(items[++i]);
    else if (items[i] === "--help") result.help = true;
  }
  return result;
}

function printHelp() {
  console.log(`Usage: node connector/build_source_manifest.mjs [options]

Options:
  --source <id>       Required, e.g. sfs-2005-551
  --locator <text>    Repeatable sample locator to record as tested
  --cache-dir <path>  Default: cache/riksdagen
  --run-dir <path>    Default: runs
  --output <path>     Optional explicit output path
`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) process.exit(0);
if (!args.sourceId) {
  printHelp();
  process.exit(2);
}

const generatedAt = new Date().toISOString();
const indexed = await writeIndex(args.cacheDir, args.sourceId);
const manifest = buildSourceManifest({
  indexed,
  sourceId: args.sourceId,
  testedLocators: args.testedLocators,
  generatedAt,
});
const outputPath = args.output ?? join(
  args.runDir,
  `source-manifest-${safeFileSegment(args.sourceId, "source")}-${generatedAt.replaceAll(/[:.]/g, "-")}.json`,
);
await ensureDirectory(outputPath.substring(0, outputPath.lastIndexOf("/")) || ".");
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ manifest: outputPath, ...manifest }, null, 2));
