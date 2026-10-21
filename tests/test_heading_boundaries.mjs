#!/usr/bin/env node

// Finding C9 / decision D011: a section stops before the publisher's headings, and headings are
// recorded as structure. Synthetic cases always run; cached cases run for the Acts present in
// cache/riksdagen/ and are skipped (not failed) when a source is missing.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, decodeHtml, loadCachedDocument, sha256 } from "../connector/sfs_index.mjs";

const results = [];
function check(name, passed, details = {}) {
  results.push({ name, status: passed ? "pass" : "fail", ...details });
}
const norm = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const sectionText = (document, section) => (section ? String(document.text)
  .slice(section.start_offset, section.end_offset_exclusive)
  .replace(/\r\n|\r/g, "\n")
  .trim() : "");

// --- Synthetic -------------------------------------------------------------------------------

const synthetic = {
  titel: "Synthetic Act",
  beteckning: "synthetic:2",
  text: [
    "1 kap. Allmänt",
    "",
    "Inledande bestämmelser",
    "",
    "1 § First rule.",
    "",
    "En rubrik som är så lång att",
    "den bryts över två rader",
    "",
    "2 § Second rule.",
    "",
    "Undantag",
    "",
    "Avslutande del",
    "",
    "Undergrupp",
    "",
    "3 § Third rule.",
    "",
    "2 kap. Särskilt",
    "",
    "1 § Special rule.",
  ].join("\r\n"),
  html: [
    '<h3 name="K1"><a name="K1">1 kap. Allmänt</a></h3>',
    '<h4 name="Inledande bestämmelser"><a name="Inledande bestämmelser">Inledande bestämmelser</a></h4>',
    '<a class="paragraf" name="K1P1"><b>1 §</b></a> First rule.',
    '<h4 name="x">En rubrik som är så lång att  den bryts över två rader</h4>',
    '<a class="paragraf" name="K1P2"><b>2 §</b></a> Second rule. <p></p>Undantag',
    '<h4 name="Avslutande del">Avslutande del</h4><h4 name="Undergrupp">Undergrupp</h4>',
    '<a class="paragraf" name="K1P3"><b>3 §</b></a> Third rule.',
    '<h3 name="K2"><a name="K2">2 kap. Särskilt</a></h3>',
    '<a class="paragraf" name="K2P1"><b>1 §</b></a> Special rule.',
  ].join(""),
};
const index = buildIndex({ sourceId: "synthetic:2", document: synthetic, rawFile: "synthetic.json" });
const byLocator = Object.fromEntries(index.sections.map((section) => [section.locator, section]));

check("Synthetic heading source is supported", index.capability.status === "supported", { capability: index.capability });
check("A wrapped two-line heading is cut from the previous section",
  sectionText(synthetic, byLocator["1 kap. 1 §"]) === "1 § First rule.",
  { text: sectionText(synthetic, byLocator["1 kap. 1 §"]) });
check("A run of two headings is cut, while a heading-like statute paragraph stays",
  sectionText(synthetic, byLocator["1 kap. 2 §"]) === "2 § Second rule.\n\nUndantag",
  { text: sectionText(synthetic, byLocator["1 kap. 2 §"]) });
check("A chapter heading is cut from the last section of the previous chapter",
  sectionText(synthetic, byLocator["1 kap. 3 §"]) === "3 § Third rule.",
  { text: sectionText(synthetic, byLocator["1 kap. 3 §"]) });
check("Section hashes still match their offsets",
  index.sections.every((section) => sha256(sectionText(synthetic, section)) === section.section_sha256));
check("Each section records the headings immediately before it, in order",
  JSON.stringify(byLocator["1 kap. 1 §"].headings_before) === JSON.stringify(["1 kap. Allmänt", "Inledande bestämmelser"])
    && JSON.stringify(byLocator["1 kap. 3 §"].headings_before) === JSON.stringify(["Avslutande del", "Undergrupp"])
    && JSON.stringify(byLocator["2 kap. 1 §"].headings_before) === JSON.stringify(["2 kap. Särskilt"]),
  { headings_before: index.sections.map((section) => [section.locator, section.headings_before]) });
check("Each section records its chapter title",
  byLocator["1 kap. 2 §"].chapter_title === "Allmänt" && byLocator["2 kap. 1 §"].chapter_title === "Särskilt",
  { chapter_titles: index.sections.map((section) => [section.locator, section.chapter_title]) });
check("The index lists every heading with its span and the section it introduces",
  index.headings?.length === 6
    && index.headings.every((heading) => norm(String(synthetic.text).slice(heading.start_offset, heading.end_offset_exclusive)) === norm(heading.text))
    && index.headings.find((heading) => heading.text === "Undergrupp")?.before_locator === "1 kap. 3 §",
  { headings: index.headings });
check("All HTML headings were matched in the text", index.heading_alignment?.unmatched_count === 0
  && index.heading_alignment?.unmatched_between_sections_count === 0,
  { heading_alignment: index.heading_alignment });

const unmatchedDocument = {
  ...synthetic,
  html: synthetic.html.replace("Avslutande del</h4>", "Avslutande del</h4><h4>Rubrik som saknas i texten</h4>"),
};
const unmatched = buildIndex({ sourceId: "synthetic:3", document: unmatchedDocument, rawFile: "synthetic.json" });
check("An HTML heading missing from the text is reported, and no statute text is cut for it",
  unmatched.heading_alignment?.unmatched_count >= 1
    && sectionText(unmatchedDocument, unmatched.sections.find((s) => s.locator === "1 kap. 2 §")).includes("Undantag"),
  { heading_alignment: unmatched.heading_alignment });

const markerDocument = {
  titel: "Synthetic Act", beteckning: "synthetic:4",
  text: ["1 § Första.", "", "Närmare föreskrifter finns i förordningen om avgifter m.m.", "",
    "/Rubriken träder i kraft I:2030-01-10/", "", "Bemyndigande", "", "2 § Andra."].join("\n"),
  html: ['<a class="paragraf" name="P1"><b>1 §</b></a> Första.<p><a name="P1S2"></a></p>',
    'Närmare föreskrifter finns i förordningen om avgifter m.m.<p><a name="P1S3"></a></p>',
    '<h4>Särskilt</h4><p><a name="P1S4"></a></p>Närmare föreskrifter finns i förordningen om avgifter m.m.',
    '<i>/Rubriken träder i kraft I:2030-01-10/</i><h4>Bemyndigande</h4>',
    '<a class="paragraf" name="P2"><b>2 §</b></a> Andra.'].join(""),
};
const markerIndex = buildIndex({ sourceId: "synthetic:4", document: markerDocument, rawFile: "synthetic.json" });
check("A heading marker in its own paragraph is cut with its heading; a statute sentence ending m.m. stays",
  sectionText(markerDocument, markerIndex.sections[0]) === "1 § Första.\n\nNärmare föreskrifter finns i förordningen om avgifter m.m.",
  { text: sectionText(markerDocument, markerIndex.sections[0]) });

// C11 (2026-10-21): a heading the publisher left untagged directly after the amendment marker.
const c11Document = {
  titel: "Synthetic Act", beteckning: "synthetic:c11",
  text: ["1 § Första. Lag (2020:1).", "", "Uppgifter om särskilda villkor m.m.", "",
    "2 § Andra. Lag (2021:2).", "", "Bolaget ska anmäla detta", "", "3 § Tredje. Lag (2022:3).",
    "", "Övergångsbestämmelser"].join("\n"),
  html: ['<a class="paragraf" name="P1"><b>1 §</b></a> Första. <i>Lag (2020:1)</i>.<p><a name="P1S2"></a></p>',
    'Uppgifter om särskilda villkor m.m.<p><a name="P1S3"></a></p>',
    '<a class="paragraf" name="P2"><b>2 §</b></a> Andra. <i>Lag (2021:2)</i>.<p><a name="P2S2"></a></p>',
    'Bolaget ska anmäla detta<p><a name="P2S3"></a></p>',
    '<a class="paragraf" name="P3"><b>3 §</b></a> Tredje. <i>Lag (2022:3)</i>.<p><a name="P3S2"></a></p>',
    'Övergångsbestämmelser'].join(""),
};
const c11 = buildIndex({ sourceId: "synthetic:c11", document: c11Document, rawFile: "synthetic.json" });
check("C11: an untagged heading after the amendment marker is cut and recorded for the next section",
  sectionText(c11Document, c11.sections[0]) === "1 § Första. Lag (2020:1)."
    && JSON.stringify(c11.sections[1].headings_before) === JSON.stringify(["Uppgifter om särskilda villkor m.m."]),
  { text: sectionText(c11Document, c11.sections[0]), headings_before: c11.sections[1].headings_before });
check("C11: a statute sentence after the marker (has a verb) stays",
  sectionText(c11Document, c11.sections[1]).endsWith("Bolaget ska anmäla detta"),
  { text: sectionText(c11Document, c11.sections[1]) });
check("C11: the Act's last section is not cut after its marker",
  sectionText(c11Document, c11.sections[2]).endsWith("Övergångsbestämmelser"),
  { text: sectionText(c11Document, c11.sections[2]) });

// --- Cached Acts -----------------------------------------------------------------------------

const cacheDir = new URL("../cache/riksdagen/", import.meta.url).pathname;
async function cachedIndex(sourceId) {
  try {
    const cached = await loadCachedDocument(cacheDir, sourceId);
    return { document: cached.document, index: buildIndex({ sourceId, document: cached.document, rawFile: cached.rawFile }) };
  } catch {
    return null;
  }
}
const skipped = [];
const cases = [
  ["sfs-2005-551", "29 kap. 1 §", "Lag (2019:418).", "Revisors, lekmannarevisors"],
  ["sfs-2005-551", "1 kap. 14 §", "motsvarade 500 000 kr.", "2 kap. Bildande av aktiebolag"],
  ["sfs-2005-551", "4 kap. 2 §", "aktier av ett visst slag.", "Föreskrifter om företrädesrätt"],
  ["sfs-2005-551", "13 kap. 6 §", null, null],
  ["sfs-1990-931", "5 §", "köp är tillämplig.", "Varans avlämnande"],
];
for (const [sourceId, locator, ending, heading] of cases) {
  const loaded = await cachedIndex(sourceId);
  if (!loaded) { skipped.push(`${sourceId} ${locator}`); continue; }
  const section = loaded.index.sections.find((item) => item.locator === locator);
  const text = section ? sectionText(loaded.document, section) : "";
  if (ending) {
    check(`${sourceId} ${locator} stops at its own last sentence, before "${heading}"`,
      text.endsWith(ending) && !text.includes(heading), { tail: text.slice(-120) });
  } else {
    check(`${sourceId} ${locator} keeps its numbered sub-items (earlier regression)`,
      /\n1\. /.test(text) && text.endsWith("."), { tail: text.slice(-120) });
  }
}
const abl = await cachedIndex("sfs-2005-551");
if (abl) {
  const c11Cases = [["20 kap. 12 §", "Lag (2007:317)."], ["20 kap. 36 §", "Lag (2020:985)."], ["23 kap. 56 §", "Lag (2022:1647)."],
    ["24 kap. 61 §", "Lag (2022:1647)."], ["25 kap. 51 §", "Lag (2025:804)."], ["28 kap. 4 §", "Lag (2018:1682)."]];
  const wrong = c11Cases.filter(([locator, ending]) => {
    const section = abl.index.sections.find((item) => item.locator === locator);
    return !section || !sectionText(abl.document, section).endsWith(ending);
  }).map(([locator]) => locator);
  check("C11: the six ABL sections end at their amendment marker", wrong.length === 0, { wrong });
}
const arl = await cachedIndex("sfs-1995-1554");
if (arl) {
  const section = arl.index.sections.find((item) => item.locator === "7 kap. 31 g §");
  check("C11: ÅRL 7 kap. 31 g § ends at its amendment marker",
    Boolean(section) && sectionText(arl.document, section).endsWith("Lag (2024:347)."),
    { tail: section ? sectionText(arl.document, section).slice(-80) : null });
}
if (abl) {
  const next = abl.index.sections.find((item) => item.locator === "29 kap. 2 §");
  check("ABL 29 kap. 2 § records the heading that introduces it",
    next?.headings_before?.some((text) => text.startsWith("Revisors, lekmannarevisors")), { headings_before: next?.headings_before });
}

// Every cached, structurally supported Act: no section ends with one of the HTML headings that
// lie between its anchor and the next one, and every HTML heading is matched in the text.
const scan = [];
for (const sourceId of (await readdir(cacheDir).catch(() => [])).sort()) {
  const loaded = await cachedIndex(sourceId);
  if (!loaded || loaded.index.capability.status !== "supported") continue;
  // Headings read straight from the publisher's HTML, independently of the index under test.
  const headingTexts = new Set([...String(loaded.document.html ?? "").matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
    .map((match) => norm(decodeHtml(match[1].replace(/<[^>]+>/g, " "))))
    .filter(Boolean));
  const trailing = loaded.index.sections.filter((section) => {
    const last = sectionText(loaded.document, section).split(/\n\s*\n/).at(-1);
    return headingTexts.has(norm(last));
  }).map((section) => section.locator);
  scan.push({ sourceId, sections: loaded.index.section_count, trailing_headings: trailing.length,
    examples: trailing.slice(0, 3), unmatched_headings: loaded.index.heading_alignment?.unmatched_between_sections_count ?? null,
    toc_in_headings: loaded.index.sections.some((section) => (section.headings_before ?? []).includes("Innehåll:")) });
}
if (scan.length === 0) {
  skipped.push("cached-Act scan (no supported Act in cache/riksdagen/)");
} else {
  check("No cached Act has a section ending in a publisher heading",
    scan.every((row) => row.trailing_headings === 0), { scan });
  check("Every HTML heading between two sections of a cached Act is matched in the text",
    scan.every((row) => row.unmatched_headings === 0), { scan });
  check("No section's own headings include a heading that was not found in the text (TOC entries)",
    scan.every((row) => !row.toc_in_headings), { scan });
}

// --- D012: a section starts only at a publisher anchor; an unmatched heading blocks ----------

const root = new URL("..", import.meta.url).pathname;
const startsDocument = (extraText = [], extraHtml = "") => ({
  titel: "Synthetic Act", beteckning: "2099:1",
  text: ["1 § För koncernredovisningen tillämpas följande bestämmelser:", "", "3 § om väsentlighet,", "",
    "4 § om form m.m., och", "", "5 § om undertecknande och datering.", "", "2 § Andra regel.", "",
    ...extraText, "3 § Tredje regel."].join("\n"),
  html: ['<a class="paragraf" name="P1"><b>1 §</b></a> För koncernredovisningen tillämpas följande bestämmelser:',
    '<p></p>3 § om väsentlighet,<p></p>4 § om form m.m., och<p></p>5 § om undertecknande och datering.',
    '<a class="paragraf" name="P2"><b>2 §</b></a> Andra regel.', extraHtml,
    '<a class="paragraf" name="P3"><b>3 §</b></a> Tredje regel.'].join(""),
});
const starts = startsDocument();
const startsIndex = buildIndex({ sourceId: "sfs-2099-1", document: starts, rawFile: "synthetic.json" });
check("D012: an in-text reference list inside an anchored section does not start sections",
  startsIndex.capability.status === "supported"
    && startsIndex.capability.method === "html_paragraph_anchors_guide_text_section_starts"
    && startsIndex.section_count === 3
    && startsIndex.capability.text_candidate_count === 3
    && startsIndex.capability.in_text_reference_count === 3
    && startsIndex.in_text_references?.every((reference) => reference.within_locator === "1 §"),
  { capability: startsIndex.capability, in_text_references: startsIndex.in_text_references });
check("D012: the reference lines stay statute text of the section they sit in",
  sectionText(starts, startsIndex.sections[0]).endsWith("5 § om undertecknande och datering.")
    && sectionText(starts, startsIndex.sections[1]) === "2 § Andra regel.",
  { first: sectionText(starts, startsIndex.sections[0]) });
const genuine = startsDocument(["2 a § Utöver det som anges i 1 § gäller detta.", ""]);
const genuineIndex = buildIndex({ sourceId: "sfs-2099-1", document: genuine, rawFile: "synthetic.json" });
check("D012: an unanchored text section that reads as a section (URL 53 g § shape) stays held",
  genuineIndex.capability.status === "review_required" && genuineIndex.section_count === 0
    && genuineIndex.capability.issues.some((issue) => issue.includes("Locator order differs")),
  { capability: genuineIndex.capability });
const repealed = startsDocument(["2 a § har upphävts genom lag (2000:1).", ""]);
check("D012: an unanchored repeal line is not absorbed as a reference",
  buildIndex({ sourceId: "sfs-2099-1", document: repealed, rawFile: "synthetic.json" }).capability.status === "review_required");
const leadingReference = {
  ...starts,
  text: ["9 § om väsentlighet,", "", starts.text].join("\n"),
};
check("D012: a reference-shaped line before the first anchored section is not absorbed",
  buildIndex({ sourceId: "sfs-2099-1", document: leadingReference, rawFile: "synthetic.json" }).capability.status === "review_required");

// Heading stop: the synthetic document above whose HTML heading is missing from the text.
const blockedSection = unmatched.sections.find((section) => section.locator === "1 kap. 2 §");
check("Heading stop: the section before an unmatched between-sections heading is marked, others are not",
  blockedSection?.boundary_check?.status === "heading_unmatched"
    && blockedSection.boundary_check.unmatched_headings?.includes("Rubrik som saknas i texten")
    && unmatched.sections.filter((section) => section.boundary_check).length === 1
    && index.sections.every((section) => !section.boundary_check),
  { boundary_check: blockedSection?.boundary_check });
const stopCache = await mkdtemp(join(tmpdir(), "heading-stop-"));
await mkdir(join(stopCache, "cache", "sfs-2099-2"), { recursive: true });
await writeFile(join(stopCache, "cache", "sfs-2099-2", "2026-10-20T00-00-00-000Z.json"),
  JSON.stringify({ dokumentstatus: { dokument: { ...unmatchedDocument, beteckning: "2099:2" } } }), "utf8");
const provision = (locator) => JSON.parse(execFileSync("node", ["connector/get_provision.mjs", "--source", "sfs-2099-2",
  "--locator", locator, "--cache-dir", join(stopCache, "cache"), "--run-dir", join(stopCache, "runs")],
{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const stopped = provision("1 kap. 2 §");
check("Heading stop: get_provision blocks the section with a warning and returns no text",
  stopped.status === "unknown" && stopped.text === undefined
    && stopped.boundary?.status === "heading_unmatched"
    && /heading/i.test(stopped.warning ?? ""),
  { packet_status: stopped.status, boundary: stopped.boundary, warning: stopped.warning });
check("Heading stop: a neighbouring section is still found", provision("1 kap. 1 §").status === "found");
check("D013: the heading-stopped packet still shows the published text as unverified, with an explanation",
  stopped.review_action?.source_observation?.status === "unverified_text_candidate"
    && stopped.review_action?.source_observation.use === "reading_only"
    && stopped.review_action?.source_observation.candidates?.[0]?.excerpt?.startsWith("2 § Second rule.")
    && /heading/i.test(stopped.review_action?.source_observation.note ?? ""),
  { source_observation: stopped.review_action?.source_observation });

// D013: a section the publisher prints inside the previous one (ABL 15 kap. 41 § shape).
const hiddenDocument = {
  titel: "Synthetic Act", beteckning: "2099:3",
  text: ["1 § Första regeln.", "", "Rubrik som inte är märkt", "2 § Andra regeln står här.", "", "3 § Tredje regeln."].join("\n"),
  html: ['<a class="paragraf" name="P1"><b>1 §</b></a> Första regeln.<p><a name="P1S2"></a></p>',
    'Rubrik som inte är märkt 2 § Andra regeln står här.',
    '<a class="paragraf" name="P3"><b>3 §</b></a> Tredje regeln.'].join(""),
};
const hiddenIndex = buildIndex({ sourceId: "sfs-2099-3", document: hiddenDocument, rawFile: "synthetic.json" });
check("D013: a section printed inside the previous one marks that section and is listed as hidden",
  hiddenIndex.capability.status === "supported"
    && hiddenIndex.sections[0]?.boundary_check?.status === "unmarked_section_inside"
    && hiddenIndex.hidden_sections?.length === 1
    && hiddenIndex.hidden_sections[0].locator === "2 §"
    && hiddenIndex.hidden_sections[0].within_locator === "1 §"
    && !hiddenIndex.sections[1]?.boundary_check,
  { sections: hiddenIndex.sections.map((section) => [section.locator, section.boundary_check]), hidden: hiddenIndex.hidden_sections });
await mkdir(join(stopCache, "cache", "sfs-2099-3"), { recursive: true });
await writeFile(join(stopCache, "cache", "sfs-2099-3", "2026-10-20T00-00-00-000Z.json"),
  JSON.stringify({ dokumentstatus: { dokument: hiddenDocument } }), "utf8");
const hiddenProvision = (locator) => JSON.parse(execFileSync("node", ["connector/get_provision.mjs", "--source", "sfs-2099-3",
  "--locator", locator, "--cache-dir", join(stopCache, "cache"), "--run-dir", join(stopCache, "runs")],
{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const container = hiddenProvision("1 §");
check("D013: the containing section is unknown, with its published text and an explanation",
  container.status === "unknown" && container.text === undefined
    && container.boundary?.status === "unmarked_section_inside"
    && container.review_action?.source_observation?.candidates?.[0]?.excerpt?.includes("2 § Andra regeln står här.")
    && /2 §/.test(container.review_action?.source_observation?.note ?? ""),
  { packet_status: container.status, boundary: container.boundary, source_observation: container.review_action?.source_observation });
const hidden = hiddenProvision("2 §");
check("D013: the hidden section is unknown (not not_found), with its own published text and an explanation",
  hidden.status === "unknown" && hidden.text === undefined
    && hidden.boundary?.status === "printed_inside_another_section"
    && hidden.boundary?.within_locator === "1 §"
    && hidden.review_action?.source_observation?.candidates?.[0]?.excerpt === "2 § Andra regeln står här."
    && /1 §/.test(hidden.review_action?.source_observation?.note ?? ""),
  { packet_status: hidden.status, boundary: hidden.boundary, source_observation: hidden.review_action?.source_observation });
check("D013: a later section after the hidden one is still found", hiddenProvision("3 §").status === "found");

// Cached: ÅRL is supported; its 7 kap. 7 § keeps the reference list; URL stays held.
const expectedHeld = new Set(["sfs-1960-729"]);
const capabilityRows = [];
for (const sourceId of (await readdir(cacheDir).catch(() => [])).sort()) {
  const loaded = await cachedIndex(sourceId);
  if (loaded) capabilityRows.push([sourceId, loaded.index.capability.status, loaded.index.capability.in_text_reference_count]);
}
if (capabilityRows.length) {
  check("D012: every cached Act is supported except URL (genuine publisher disagreement); only ÅRL has in-text references",
    capabilityRows.every(([sourceId, status, references]) => status === (expectedHeld.has(sourceId) ? "review_required" : "supported")
      && references === (sourceId === "sfs-1995-1554" ? 5 : 0)),
    { capabilityRows });
}
const getCached = (sourceId, locator) => JSON.parse(execFileSync("node", ["connector/get_provision.mjs", "--source", sourceId,
  "--locator", locator, "--run-dir", join(stopCache, "runs")], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
if (await cachedIndex("sfs-1995-1554")) {
  const arl77 = getCached("sfs-1995-1554", "7 kap. 7 §");
  check("ÅRL 7 kap. 7 § is found with its five cross-reference lines inside it and its own last sentence",
    arl77.status === "found" && arl77.capability?.status === "supported"
      && ["3 a § om väsentlighet,", "4 § om andra grundläggande redovisningsprinciper,", "5 § om form m.m.,",
        "6 § om valuta, och", "7 § om undertecknande och datering."].every((line) => arl77.text.includes(line))
      && arl77.text.trim().endsWith("Lag (2024:347)."),
    { packet_status: arl77.status, tail: arl77.text?.slice(-200) });
  const arlReview = JSON.parse(execFileSync("node", ["connector/review_source_capability.mjs", "--source", "sfs-1995-1554",
    "--run-dir", join(stopCache, "runs")], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  check("ÅRL capability review reports no mismatch for its in-text references",
    arlReview.status === "supported" && !arlReview.mismatch_evidence, { packet_status: arlReview.status });
  const arl23 = getCached("sfs-1995-1554", "2 kap. 3 §");
  for (const [locator, expectedBoundary, startsWith] of [
    ["15 kap. 40 §", "unmarked_section_inside", "40 §"],
    ["15 kap. 41 §", "printed_inside_another_section", "41 § I ett publikt aktiebolag"],
    ["15 kap. 29 §", "unmarked_section_inside", "29 §"],
    ["15 kap. 30 §", "printed_inside_another_section", "30 § I bolag som inte är avstämningsbolag"],
  ]) {
    if (!(await cachedIndex("sfs-2005-551"))) break;
    const packet = getCached("sfs-2005-551", locator);
    check(`D013: ABL ${locator} is held with its published text and an explanation`,
      packet.status === "unknown" && packet.text === undefined && packet.boundary?.status === expectedBoundary
        && packet.review_action?.source_observation?.candidates?.[0]?.excerpt?.startsWith(startsWith),
      { packet_status: packet.status, boundary: packet.boundary });
  }
  check("ÅRL 2 kap. 3 § is found", arl23.status === "found" && arl23.text?.startsWith("3 §"), { packet_status: arl23.status });
} else {
  skipped.push("sfs-1995-1554 (not cached)");
}
if (await cachedIndex("sfs-1960-729")) {
  const url53g = getCached("sfs-1960-729", "7 kap. 53 g §");
  check("URL 7 kap. 53 g § stays held (text without a publisher anchor)",
    url53g.status !== "found" && url53g.capability?.status === "review_required" && url53g.text === undefined,
    { packet_status: url53g.status });
} else {
  skipped.push("sfs-1960-729 (not cached)");
}

const summary = {
  test_suite: "heading-boundaries-v0.1",
  generated_at: new Date().toISOString(),
  total: results.length,
  passed: results.filter((result) => result.status === "pass").length,
  failed: results.filter((result) => result.status === "fail").length,
  skipped,
  results,
};
const runsDir = new URL("../runs/", import.meta.url).pathname;
await mkdir(runsDir, { recursive: true });
const receiptPath = join(runsDir, `heading-boundaries-${summary.generated_at.replaceAll(/[:.]/g, "-")}.json`);
await writeFile(receiptPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receipt: receiptPath, ...summary }, null, 2));
if (summary.failed > 0) process.exitCode = 1;
