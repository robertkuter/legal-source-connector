#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildIndex, loadCachedDocument, parseLocator, sha256 } from "../connector/sfs_index.mjs";
import { requireCachedSources } from "./cache_requirements.mjs";

const cacheDir = "cache/riksdagen";
const runDir = "runs";
const runAt = new Date().toISOString();

const sources = [
  {
    sourceId: "sfs-1990-931",
    expectedTitle: "Köplag (1990:931)",
    expectedSectionCount: 82,
    exactLocators: ["1 §", "17 §", "40 §", "82 §"],
    missingLocator: "83 §",
  },
  {
    sourceId: "sfs-1987-822",
    expectedTitleIncludes: "1987:822",
    expectedSectionCount: 2,
    exactLocators: ["1 §", "2 §"],
    missingLocator: "3 §",
  },
  {
    sourceId: "sfs-1999-116",
    expectedTitle: "Lag (1999:116) om skiljeförfarande",
    expectedSectionCount: 64,
    exactLocators: ["1 §", "4 a §", "27 a §", "60 §"],
    missingLocator: "61 §",
  },
  {
    sourceId: "sfs-1991-351",
    expectedTitleIncludes: "1991:351",
    expectedSectionCount: 36,
    exactLocators: ["1 §", "13 §", "36 §"],
    missingLocator: "37 §",
  },
  {
    sourceId: "sfs-1975-635",
    expectedTitleIncludes: "1975:635",
    expectedSectionCount: 13,
    exactLocators: ["1 §", "2 a §", "4 §", "9 §"],
    missingLocator: "10 §",
  },
  {
    sourceId: "sfs-1972-207",
    expectedTitle: "Skadeståndslag (1972:207)",
    expectedSectionCount: 39,
    exactLocators: ["1 kap. 1 §", "2 kap. 3 a §", "6 kap. 7 §"],
    ambiguousLocators: ["3 kap. 5 §"],
    missingLocator: "7 kap. 1 §",
  },
  {
    sourceId: "sfs-2008-486",
    expectedTitle: "Marknadsföringslag (2008:486)",
    expectedSectionCount: 79,
    exactLocators: ["1 §", "7 a §", "22 a §", "66 §"],
    missingLocator: "67 §",
  },
  {
    sourceId: "sfs-2008-579",
    expectedTitle: "Konkurrenslag (2008:579)",
    expectedSectionCount: 151,
    exactLocators: ["1 kap. 1 §", "3 kap. 1 a §", "8 kap. 18 §"],
    ambiguousLocators: ["4 kap. 16 a §"],
    missingLocator: "9 kap. 1 §",
  },
  {
    sourceId: "sfs-1976-580",
    expectedTitle: "Lag (1976:580) om medbestämmande i arbetslivet",
    expectedSectionCount: 83,
    exactLocators: ["1 §", "19 a §", "41 d §", "70 §"],
    missingLocator: "71 §",
  },
  {
    sourceId: "sfs-1999-1078",
    expectedTitle: "Bokföringslag (1999:1078)",
    expectedSectionCount: 66,
    exactLocators: ["1 kap. 1 §", "6 kap. 3 a §", "9 kap. 1 §"],
    missingLocator: "10 kap. 1 §",
  },
  {
    sourceId: "sfs-1995-1554",
    expectedTitle: "Årsredovisningslag (1995:1554)",
    expectedCapability: "review_required",
    expectedSectionCount: 0,
    exactLocators: [],
  },
];

if (!await requireCachedSources(cacheDir, sources.map((source) => source.sourceId))) process.exit(2);

const results = [];
let passed = 0;
let failed = 0;

function check(name, condition, details = {}) {
  const result = { name, status: condition ? "pass" : "fail", ...details };
  results.push(result);
  if (condition) passed += 1;
  else failed += 1;
}

function matchesFor(index, locator) {
  const parsed = parseLocator(locator);
  return index.sections.filter(
    (section) => section.chapter === parsed.chapter && section.section === parsed.section,
  );
}

for (const expected of sources) {
  const cached = await loadCachedDocument(cacheDir, expected.sourceId);
  const index = buildIndex({
    sourceId: expected.sourceId,
    document: cached.document,
    rawFile: cached.rawFile,
  });

  const expectedCapability = expected.expectedCapability ?? "supported";
  check(`${expected.sourceId} capability gate is ${expectedCapability}`, index.capability.status === expectedCapability, {
    capability: index.capability,
  });
  check(`${expected.sourceId} title is present`, expected.expectedTitle
    ? cached.document.titel === expected.expectedTitle
    : String(cached.document.titel ?? "").includes(expected.expectedTitleIncludes));
  check(`${expected.sourceId} section count is stable for this snapshot`, index.section_count === expected.expectedSectionCount, {
    section_count: index.section_count,
  });

  if (expectedCapability !== "supported") {
    check(`${expected.sourceId} records structural issues for follow-up`, index.capability.issues.length > 0, {
      issues: index.capability.issues,
    });
    continue;
  }

  const allOffsetsIncrease = index.sections.every((section, position) => {
    const previous = index.sections[position - 1];
    return section.start_offset < section.end_offset_exclusive
      && (!previous || previous.start_offset < section.start_offset);
  });
  check(`${expected.sourceId} indexed offsets increase`, allOffsetsIncrease);

  const allHashesMatch = index.sections.every((section) => {
    const extracted = cached.document.text
      .slice(section.start_offset, section.end_offset_exclusive)
      .replace(/\r\n|\r/g, "\n")
      .trim();
    return sha256(extracted) === section.section_sha256;
  });
  check(`${expected.sourceId} indexed section hashes match offsets`, allHashesMatch);

  for (const locator of expected.exactLocators) {
    const matches = matchesFor(index, locator);
    check(`${expected.sourceId} exact locator is unique: ${locator}`, matches.length === 1, {
      match_count: matches.length,
    });
  }

  for (const locator of expected.ambiguousLocators ?? []) {
    const matches = matchesFor(index, locator);
    check(`${expected.sourceId} transition locator remains ambiguous: ${locator}`, matches.length > 1, {
      match_count: matches.length,
      headings: matches.map((match) => match.heading_text),
    });
  }

  const missingMatches = matchesFor(index, expected.missingLocator);
  check(`${expected.sourceId} missing locator is not returned`, missingMatches.length === 0, {
    locator: expected.missingLocator,
    match_count: missingMatches.length,
  });

  if (expected.sourceId === "sfs-1987-822") {
    const text = cached.document.text;
    const annexMatch = matchesFor(index, "2 §")[0];
    const annexText = text.slice(annexMatch.start_offset, annexMatch.end_offset_exclusive);
    check("1987:822 source retains the Swedish CISG annex", annexText.includes("Bilaga") && annexText.includes("Artikel 1"));
    check("1987:822 annex is visibly long-document sized", annexText.length > 50000, {
      annex_text_length: annexText.length,
    });
    check("1987:822 current index does not claim article-level locators", !index.sections.some((section) => section.locator === "Artikel 1"));
  }

  if (expected.sourceId === "sfs-1972-207") {
    const ambiguous = matchesFor(index, "3 kap. 5 §");
    check("1972:207 ambiguous candidates expose transition headings",
      ambiguous.some((match) => match.heading_text.includes("Upphör"))
      && ambiguous.some((match) => match.heading_text.includes("Träder")));
  }

  if (expected.sourceId === "sfs-2008-579") {
    const finalSection = matchesFor(index, "8 kap. 18 §")[0];
    const finalText = cached.document.text.slice(finalSection.start_offset, finalSection.end_offset_exclusive);
    check("2008:579 final provision retains transition material", finalText.length > 5000 && finalText.includes("Övergångsbestämmelser"), {
      final_text_length: finalText.length,
    });
    const ambiguous = matchesFor(index, "4 kap. 16 a §");
    check("2008:579 ambiguous candidates retain the publisher headings", ambiguous.length === 2 && ambiguous[0].heading_text && ambiguous[1].heading_text);
  }
}

const receipt = {
  test_suite: "commercial-law-coverage-v0.1",
  generated_at: runAt,
  total: results.length,
  passed,
  failed,
  results,
};
const receiptPath = join(runDir, `commercial-coverage-${runAt.replaceAll(/[:.]/g, "-")}.json`);
await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ receipt: receiptPath, ...receipt }, null, 2));
if (failed > 0) process.exitCode = 1;
