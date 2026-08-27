import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

async function directoryExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function requireCachedSources(cacheDir, sourceIds) {
  const missing = [];
  for (const sourceId of sourceIds) {
    if (!await directoryExists(join(cacheDir, sourceId))) missing.push(sourceId);
  }
  if (!missing.length) return true;

  console.error("This source-profile test needs local Riksdagen snapshots that are not bundled with the public repository.");
  console.error(`Missing: ${missing.join(", ")}`);
  console.error("Orient them first, then rerun the test:");
  console.error(`node connector/orient_riksdagen.mjs ${missing.map((sourceId) => `--source ${sourceId}`).join(" ")}`);
  return false;
}

export async function requireAnyCachedSource(cacheDir) {
  try {
    const entries = await readdir(cacheDir, { withFileTypes: true });
    if (entries.some((entry) => entry.isDirectory())) return true;
  } catch {
    // The guidance below covers a missing or unreadable cache directory.
  }

  console.error("This coverage test needs at least one locally oriented Riksdagen source.");
  console.error("The public repository does not bundle complete Acts. Run an orientation command first, for example:");
  console.error("node connector/orient_riksdagen.mjs --source sfs-2005-551");
  return false;
}
