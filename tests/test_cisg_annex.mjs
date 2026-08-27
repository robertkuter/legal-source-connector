#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadCachedCisgDocument,
  listedInSwedishAct,
  parseArticleLocator,
  sha256,
  writeCisgAnnexIndex,
} from "../connector/cisg_annex_index.mjs";
import { requireCachedSources } from "./cache_requirements.mjs";

const cacheDir = "cache/riksdagen";
const runDir = "runs";
const generatedAt = new Date().toISOString();
const results = [];

if (!await requireCachedSources(cacheDir, ["sfs-1987-822"])) process.exit(2);

function check(name, condition, details = {}) {
  results.push({ name, status: condition ? "pass" : "fail", ...details });
}

const indexed = await writeCisgAnnexIndex(cacheDir, "sfs-1987-822");
const { document } = indexed;
const { index } = indexed;

check("CISG annex capability is supported", index.capability.status === "supported", {
  capability: index.capability,
});
check("CISG annex contains 101 article headings", index.article_count === 101, {
  article_count: index.article_count,
});
check("CISG articles are numbered 1 through 101", index.articles.every((article, position) => article.article === position + 1));
check("CISG annex begins after the statutory Act section", index.annex_start_offset > 0
  && document.text.slice(0, index.annex_start_offset).includes("2 §")
  && document.text.slice(index.annex_start_offset).startsWith("Bilaga"));
check("CISG HTML heading cross-check is recorded as partial", index.capability.html_article_heading_count === 48
  && index.capability.html_article_heading_numbers.includes(2)
  && !index.capability.html_article_heading_numbers.includes(1));

const offsetsIncrease = index.articles.every((article, position) => {
  const previous = index.articles[position - 1];
  return article.start_offset < article.end_offset_exclusive
    && (!previous || previous.start_offset < article.start_offset);
});
check("CISG article offsets increase", offsetsIncrease);

let hashFailures = 0;
for (const article of index.articles) {
  const text = document.text
    .slice(article.start_offset, article.end_offset_exclusive)
    .replace(/\r\n|\r/g, "\n")
    .trim();
  if (sha256(text) !== article.section_sha256) hashFailures += 1;
}
check("Every CISG article hash matches its offsets", hashFailures === 0, {
  checked: index.articles.length,
  failures: hashFailures,
});

for (const articleNumber of [1, 19, 60, 88, 100, 101]) {
  const matches = index.articles.filter((article) => article.article === articleNumber);
  check(`CISG article locator is unique: Artikel ${articleNumber}`, matches.length === 1, {
    match_count: matches.length,
  });
}

check("CISG Act scope includes Articles 1-88 and 100", listedInSwedishAct(1)
  && listedInSwedishAct(88)
  && listedInSwedishAct(100)
  && !listedInSwedishAct(89)
  && !listedInSwedishAct(101));

for (const articleNumber of [1, 100, 101]) {
  const article = index.articles.find((candidate) => candidate.article === articleNumber);
  const text = document.text.slice(article.start_offset, article.end_offset_exclusive).trim();
  check(`CISG article ${articleNumber} begins with its article heading`, text.startsWith(`Artikel ${articleNumber}`));
}

let invalidRejected = false;
try {
  parseArticleLocator("Artikel 102");
} catch {
  invalidRejected = true;
}
check("CISG article outside 1-101 is rejected", invalidRejected);

const receipt = {
  test_suite: "cisg-annex-index-v0.1",
  generated_at: generatedAt,
  total: results.length,
  passed: results.filter((result) => result.status === "pass").length,
  failed: results.filter((result) => result.status === "fail").length,
  results,
};
const receiptPath = join(runDir, `cisg-annex-tests-${generatedAt.replaceAll(/[:.]/g, "-")}.json`);
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receipt: receiptPath, ...receipt }, null, 2));
if (receipt.failed > 0) process.exitCode = 1;
