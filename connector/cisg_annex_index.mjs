import { createHash } from "node:crypto";
import { join } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { splitLinesWithOffsets } from "./text_lines.mjs";

const INDEX_VERSION = "0.2";

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function parseArticleLocator(locator) {
  const value = String(locator).trim();
  const match = value.match(/^(?:Artikel\s+)?(\d{1,3})$/i);
  if (!match) throw new Error(`Unsupported CISG article locator: ${locator}`);
  const article = Number(match[1]);
  if (article < 1 || article > 101) {
    throw new Error(`CISG article is outside the indexed range 1-101: ${article}`);
  }
  return { article, requested: locator };
}

export function listedInSwedishAct(article) {
  return article >= 1 && article <= 88 || article === 100;
}

function findAnnexLine(lines) {
  const line = lines.findIndex((value) => value.trim() === "Bilaga");
  if (line < 0) throw new Error("The consolidated source has no standalone Bilaga marker.");
  return line;
}

function findArticleCandidates(text, annexLine) {
  const { lines, offsets } = splitLinesWithOffsets(text);
  const candidates = [];
  for (let i = annexLine + 1; i < lines.length; i += 1) {
    const previousLine = lines[i - 1] ?? "";
    const match = previousLine.trim() === ""
      ? lines[i].trim().match(/^Artikel\s+(\d{1,3})$/i)
      : null;
    if (!match) continue;
    candidates.push({
      article: Number(match[1]),
      heading_text: lines[i].trim(),
      start_line: i,
      start_offset: offsets[i],
    });
  }
  return { lines, offsets, candidates };
}

function htmlArticleHeadings(html) {
  return [...String(html ?? "").matchAll(/<h4\s+name=["']Artikel\s+(\d+)["']/gi)]
    .map((match) => Number(match[1]));
}

function capabilityAssessment(document, textCandidates, annexLine) {
  const expected = Array.from({ length: 101 }, (_, index) => index + 1);
  const actual = textCandidates.map((candidate) => candidate.article);
  const issues = [];
  if (actual.length !== expected.length) {
    issues.push(`Expected 101 standalone article headings after Bilaga; found ${actual.length}.`);
  }
  if (new Set(actual).size !== actual.length) {
    issues.push("Duplicate CISG article headings were found in the annex.");
  }
  if (actual.some((article, index) => article !== expected[index])) {
    issues.push("CISG article headings are not in the expected 1-101 order.");
  }
  if (annexLine < 0) issues.push("The annex marker could not be located.");
  const htmlArticles = htmlArticleHeadings(document.html);
  return {
    status: issues.length === 0 ? "supported" : "review_required",
    method: "standalone_article_headings_after_bilaga_marker",
    text_article_count: actual.length,
    html_article_heading_count: htmlArticles.length,
    html_article_heading_numbers: htmlArticles,
    html_crosscheck_note: "The publisher HTML exposes only a subset of article headings; it is diagnostic evidence, not the sole article boundary signal.",
    issues,
  };
}

export function buildCisgAnnexIndex({ sourceId, document, rawFile }) {
  const text = String(document.text ?? "");
  const { lines, offsets } = splitLinesWithOffsets(text);
  let annexLine = -1;
  try {
    annexLine = findAnnexLine(lines);
  } catch {
    annexLine = -1;
  }
  const found = annexLine >= 0
    ? findArticleCandidates(text, annexLine)
    : { lines, offsets, candidates: [] };
  const capability = capabilityAssessment(document, found.candidates, annexLine);
  const articles = [];
  if (capability.status === "supported") {
    for (let i = 0; i < found.candidates.length; i += 1) {
      const candidate = found.candidates[i];
      const next = found.candidates[i + 1];
      const endOffset = next?.start_offset ?? text.length;
      const articleText = text
        .slice(candidate.start_offset, endOffset)
        .replace(/\r\n|\r/g, "\n")
        .trim();
      articles.push({
        locator: `Artikel ${candidate.article}`,
        article: candidate.article,
        listed_in_swedish_act_1_section: listedInSwedishAct(candidate.article),
        heading_text: candidate.heading_text,
        start_line: candidate.start_line + 1,
        end_line_exclusive: next?.start_line + 1 ?? found.lines.length + 1,
        start_offset: candidate.start_offset,
        end_offset_exclusive: endOffset,
        section_sha256: sha256(articleText),
      });
    }
  }
  return {
    index_version: INDEX_VERSION,
    index_family: "cisg-swedish-annex-article",
    source_id: sourceId,
    title: document.titel ?? null,
    sfs_number: document.beteckning ?? null,
    consolidation_signal: document.subtitel ?? null,
    raw_file: rawFile,
    source_text_sha256: sha256(text),
    source_html_sha256: document.html ? sha256(document.html) : null,
    source_text_length: text.length,
    offset_unit: "UTF-16 code units in document.text",
    annex_marker: "Bilaga",
    annex_start_line: annexLine >= 0 ? annexLine + 1 : null,
    annex_start_offset: annexLine >= 0 ? offsets[annexLine] : null,
    capability,
    article_count: articles.length,
    articles,
  };
}

async function latestRawJson(sourceDir, sourceId) {
  let directoryEntries;
  try {
    directoryEntries = await readdir(sourceDir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw new Error(`No cached source snapshot for ${sourceId}. Run node connector/orient_riksdagen.mjs --source ${sourceId}, then retry.`);
  }
  const files = directoryEntries
    .filter((file) => file.endsWith(".json") && file !== "index.json" && file !== "cisg-annex-index.json")
    .sort();
  if (!files.length) {
    throw new Error(`No cached source snapshot for ${sourceId}. Run node connector/orient_riksdagen.mjs --source ${sourceId}, then retry.`);
  }
  return files.at(-1);
}

export async function loadCachedCisgDocument(cacheDir, sourceId) {
  const sourceDir = join(cacheDir, sourceId);
  const rawFile = await latestRawJson(sourceDir, sourceId);
  const rawPath = join(sourceDir, rawFile);
  const payload = JSON.parse(await readFile(rawPath, "utf8"));
  const document = payload?.dokumentstatus?.dokument ?? payload?.dokument?.dokument ?? payload?.dokument;
  if (!document?.text) throw new Error(`Cached response has no consolidated text: ${rawPath}`);
  return { sourceDir, rawFile, rawPath, document };
}

export async function writeCisgAnnexIndex(cacheDir, sourceId) {
  const cached = await loadCachedCisgDocument(cacheDir, sourceId);
  const indexPath = join(cached.sourceDir, "cisg-annex-index.json");
  try {
    const existing = JSON.parse(await readFile(indexPath, "utf8"));
    if (existing.index_version === INDEX_VERSION
      && existing.source_id === sourceId
      && existing.raw_file === cached.rawFile
      && existing.source_text_sha256 === sha256(String(cached.document.text ?? ""))) {
      return { ...cached, index: existing, indexPath, reused: true };
    }
  } catch {
    // No reusable index; build it below.
  }
  const index = buildCisgAnnexIndex({ sourceId, document: cached.document, rawFile: cached.rawFile });
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return { ...cached, index, indexPath, reused: false };
}
