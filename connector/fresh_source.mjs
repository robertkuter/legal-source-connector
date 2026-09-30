import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  findTextSectionCandidates,
  loadCachedDocument,
  parseHtmlParagraphAnchors,
  sha256,
} from "./sfs_index.mjs";

function documentFromPayload(payload) {
  return payload?.dokumentstatus?.dokument ?? payload?.dokument?.dokument ?? payload?.dokument ?? null;
}

async function officialBody(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "user-agent": "legal-source-connector-pilot/0.1" },
    });
    if (!response.ok) throw new Error(`Official source returned HTTP ${response.status} for ${url}`);
    const body = await response.text();
    if (!body.trim()) throw new Error(`Official source returned an empty ${url} response`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function priorSnapshot(cacheDir, sourceId) {
  try {
    return await loadCachedDocument(cacheDir, sourceId);
  } catch (error) {
    if (error.message.startsWith("No cached source snapshot for ")) return null;
    throw error;
  }
}

async function priorFormatHash(prior, format) {
  if (!prior) return null;
  try {
    const body = await readFile(join(prior.sourceDir, prior.rawFile.replace(/\.json$/, `.${format}`)), "utf8");
    return sha256(body);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function fetchAndPinOfficialSource({
  sourceId,
  cacheDir,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const sourceMatch = String(sourceId ?? "").match(/^sfs-(\d{4})-(\d+)$/);
  if (!sourceMatch) throw new Error("A fresh lookup requires an exact SFS source ID such as sfs-1972-207.");
  const prior = await priorSnapshot(cacheDir, sourceId);
  const checkedAt = now().toISOString();
  const base = `https://data.riksdagen.se/dokument/${sourceId}`;
  const [jsonBody, textBody, htmlBody] = await Promise.all([
    officialBody(`${base}.json`, fetchImpl),
    officialBody(`${base}.text`, fetchImpl),
    officialBody(`${base}.html`, fetchImpl),
  ]);
  let payload;
  try {
    payload = JSON.parse(jsonBody);
  } catch {
    throw new Error("The fresh official JSON response could not be parsed.");
  }
  const document = documentFromPayload(payload);
  const expectedNumber = `${sourceMatch[1]}:${sourceMatch[2]}`;
  if (document?.beteckning !== expectedNumber) {
    throw new Error(`The fresh official source identity did not match ${expectedNumber}.`);
  }
  if (!document.text || !document.html) {
    throw new Error("The fresh official JSON response lacks consolidated text or HTML evidence.");
  }
  const anchors = (html) => parseHtmlParagraphAnchors(html).map((item) => item.name);
  const candidates = (text) => findTextSectionCandidates(text).candidates
    .map((item) => [item.chapter, item.section]);
  if (JSON.stringify(anchors(document.html)) !== JSON.stringify(anchors(htmlBody))
    || JSON.stringify(candidates(document.text)) !== JSON.stringify(candidates(textBody))) {
    throw new Error("The fresh JSON and direct text/HTML responses disagree on provision structure.");
  }

  const hashes = {
    source_text_sha256: sha256(document.text),
    source_html_sha256: sha256(document.html),
    response_text_sha256: sha256(textBody),
    response_html_sha256: sha256(htmlBody),
  };
  const previousHashes = prior ? {
    source_text_sha256: sha256(prior.document.text),
    source_html_sha256: prior.document.html ? sha256(prior.document.html) : null,
    response_text_sha256: await priorFormatHash(prior, "text"),
    response_html_sha256: await priorFormatHash(prior, "html"),
  } : null;
  const changedFields = previousHashes
    ? Object.keys(hashes).filter((key) => hashes[key] !== previousHashes[key])
    : [];
  if (prior && prior.document.subtitel !== document.subtitel) changedFields.push("consolidation_signal");
  if (prior && prior.document.titel !== document.titel) changedFields.push("title");
  if (previousHashes && changedFields.length === 0) {
    return {
      status: "verified_unchanged",
      checked_at: checkedAt,
      compared_snapshot: prior.rawFile,
      source_snapshot: prior.rawFile,
      changed_fields: [],
      hashes,
    };
  }

  const sourceDir = join(cacheDir, sourceId);
  await mkdir(sourceDir, { recursive: true });
  const stamp = `${checkedAt.replaceAll(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}`;
  // The JSON filename is the cache's commit point: an incomplete fetch never becomes latest.
  await writeFile(join(sourceDir, `${stamp}.text`), textBody, { encoding: "utf8", flag: "wx" });
  await writeFile(join(sourceDir, `${stamp}.html`), htmlBody, { encoding: "utf8", flag: "wx" });
  await writeFile(join(sourceDir, `${stamp}.json`), jsonBody, { encoding: "utf8", flag: "wx" });
  return {
    status: prior ? "changed" : "first_snapshot",
    checked_at: checkedAt,
    compared_snapshot: prior?.rawFile ?? null,
    source_snapshot: `${stamp}.json`,
    changed_fields: changedFields,
    hashes,
  };
}
