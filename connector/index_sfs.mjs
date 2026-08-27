#!/usr/bin/env node

import { writeIndex } from "./sfs_index.mjs";
import { defaultCacheDir } from "./runtime.mjs";

const args = process.argv.slice(2);
const sourcePosition = args.indexOf("--source");
const sourceId = sourcePosition >= 0 ? args[sourcePosition + 1] : null;
if (!sourceId) {
  console.error("Usage: node connector/index_sfs.mjs --source sfs-2005-551");
  process.exit(2);
}

try {
  const result = await writeIndex(defaultCacheDir(), sourceId);
  console.log(JSON.stringify({
    index_path: result.indexPath,
    source_id: result.index.source_id,
    source_text_length: result.index.source_text_length,
    section_count: result.index.section_count,
    consolidation_signal: result.index.consolidation_signal,
    capability: result.index.capability,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "unknown", error: error.message }, null, 2));
  process.exit(1);
}
