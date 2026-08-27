#!/usr/bin/env node

import { loadCachedDocument, buildIndex } from "./sfs_index.mjs";

const cacheDir = new URL("../cache/riksdagen/", import.meta.url).pathname;
const sourceId = process.argv[2] ?? "sfs-2005-551";

try {
  const cached = await loadCachedDocument(cacheDir, sourceId);
  const index = buildIndex({
    sourceId,
    document: cached.document,
    rawFile: cached.rawFile,
  });
  console.log(JSON.stringify({
    source_id: sourceId,
    title: cached.document.titel ?? null,
    source_snapshot: cached.rawFile,
    consolidation_signal: index.consolidation_signal,
    capability: index.capability,
    section_count: index.section_count,
    sample_locators: index.sections.slice(0, 5).map((section) => section.locator),
  }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    source_id: sourceId,
    capability: { status: "unknown", issues: [error.message] },
  }, null, 2));
  process.exitCode = 1;
}
