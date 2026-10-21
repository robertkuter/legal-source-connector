#!/usr/bin/env node

// Decision D014: stycke and punkt addresses, resolved cross-references and the amendment marker
// ("Lag (YYYY:NNN).") per section. Synthetic cases always run; cached cases run for the Acts
// present in cache/riksdagen/ and are skipped (not failed) when a source is missing.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, loadCachedDocument, parseLocator, sha256 } from "../connector/sfs_index.mjs";
import { lastAmendedBy } from "../connector/subdivisions.mjs";

const results = [];
function check(name, passed, details = {}) {
  results.push({ name, ...details, status: passed ? "pass" : "fail" });
}
const root = new URL("..", import.meta.url).pathname;
const skipped = [];

// --- Locator grammar ---------------------------------------------------------------------------

const grammar = [
  ["13 kap. 6 §", { stycke: null, point: null }],
  ["13 kap. 6 § andra stycket", { stycke: 2, point: null }],
  ["13 kap. 6 § andra stycket 2", { stycke: 2, point: "2" }],
  ["13 kap. 6 § 2 st.", { stycke: 2, point: null }],
  ["13 kap. 6 § 2 st. 2", { stycke: 2, point: "2" }],
  ["13 kap. 6 § 2 st. 2 p.", { stycke: 2, point: "2" }],
  ["13 kap. 6 § första stycket 3 a", { stycke: 1, point: "3 a" }],
  ["13 kap. 6 § 2 p.", { stycke: null, point: "2" }],
  ["13 kap. 6 § punkt 2", { stycke: null, point: "2" }],
  ["7 § tredje stycket", { stycke: 3, point: null }],
];
for (const [locator, expected] of grammar) {
  let parsed = null;
  try { parsed = parseLocator(locator); } catch { /* reported below */ }
  check(`Locator grammar: ${locator}`, parsed?.stycke === expected.stycke && parsed?.point === expected.point,
    { parsed });
}
for (const invalid of ["13 kap. 6 § 2", "13 kap. 6 § andra", "13 kap. 6 § trettonde stycket", "13 kap. 6 § extra"]) {
  let threw = false;
  try { parseLocator(invalid); } catch { threw = true; }
  check(`Locator grammar rejects: ${invalid}`, threw);
}

// --- Synthetic -------------------------------------------------------------------------------

const syntheticText = [
  "1 kap. Allmänt",
  "",
  "1 § Första stycket hänvisar till 2 § och 2 kap. 1 § andra",
  "stycket.",
  "",
  "Andra stycket inleds så:",
  "",
  "1. första punkten,",
  "",
  "2. andra punkten enligt 3 kap. 4 § lagen (1999:1078) om x, och",
  "",
  "3. tredje punkten. Lag (2020:100).",
  "",
  "Rubrik före två",
  "",
  "2 § Detta gäller enligt 1–2 §§ och 9 §. Lag (2021:5).",
  "",
  "2 kap. Särskilt",
  "",
  "1 § Ensamt stycke.",
  "",
  "Andra stycket här.",
  "",
  "2 § Först:",
  "",
  "1. a,",
  "",
  "2. b.",
  "",
  "Sedan:",
  "",
  "1. c,",
  "",
  "2. d,",
  "",
  "vilket gäller.",
  "",
  "3 § Rubrikstycke enligt 1 kap. 1 § femte stycket.",
  "",
  "Inklämd rubrik",
  "",
  "Text efter rubriken.",
].join("\r\n");
const syntheticHtml = [
  '<h3 name="K1"><a name="K1">1 kap. Allmänt</a></h3>',
  '<a class="paragraf" name="K1P1"><b>1 §</b></a>   Första stycket hänvisar till 2 § och 2 kap. 1 § andra stycket.<p><a name="K1P1S2"></a></p>',
  "Andra stycket inleds så:<br />   1. första punkten,<br />   2. andra punkten enligt 3 kap. 4 § lagen (1999:1078) om x, och<br />   3. tredje punkten. <i>Lag (2020:100)</i>.<p><a name=\"K1P1S3\"></a></p>",
  '<h4 name="Rubrik före två"><a name="Rubrik före två">Rubrik före två</a></h4><p><a name="K1P1S4"></a></p>',
  '<a class="paragraf" name="K1P2"><b>2 §</b></a>   Detta gäller enligt 1–2 §§ och 9 §. <i>Lag (2021:5)</i>.<p><a name="K1P2S2"></a></p>',
  '<h3 name="K2"><a name="K2">2 kap. Särskilt</a></h3>',
  '<a class="paragraf" name="K2P1"><b>1 §</b></a>   Ensamt stycke.<p><a name="K2P1S2"></a></p>Andra stycket här.<p><a name="K2P1S3"></a></p>',
  '<a class="paragraf" name="K2P2"><b>2 §</b></a>   Först:<br />   1. a,<br />   2. b.<p><a name="K2P2S2"></a></p>Sedan:<br />   1. c,<br />   2. d,<br />vilket gäller.<p><a name="K2P2S3"></a></p>',
  '<a class="paragraf" name="K2P3"><b>3 §</b></a>   Rubrikstycke enligt 1 kap. 1 § femte stycket.<p><a name="K2P3S2"></a></p><h4 name="x">Inklämd rubrik</h4><p><a name="K2P3S3"></a></p>Text efter rubriken.<p><a name="K2P3S4"></a></p>',
].join("\n");
const synthetic = { titel: "Synthetic Act", beteckning: "2099:5", text: syntheticText, html: syntheticHtml };

const index = buildIndex({ sourceId: "sfs-2099-5", document: synthetic, rawFile: "synthetic.json" });
const section = (locator) => index.sections.find((item) => item.locator === locator);
check("Synthetic source is supported", index.capability.status === "supported", { capability: index.capability });
check("Index version is 0.11", index.index_version === "0.11", { index_version: index.index_version });
check("Stycke layer: 1 kap. 1 § has 2 confirmed stycken (trailing heading block dropped)",
  section("1 kap. 1 §")?.stycken?.status === "confirmed" && section("1 kap. 1 §")?.stycken?.count === 2,
  { stycken: section("1 kap. 1 §")?.stycken });
check("Stycke layer: 2 kap. 1 § has 2 confirmed stycken", section("2 kap. 1 §")?.stycken?.count === 2,
  { stycken: section("2 kap. 1 §")?.stycken });
check("Stycke layer: a heading inside 2 kap. 3 § leaves its stycken unconfirmed",
  section("2 kap. 3 §")?.stycken?.status === "unconfirmed" && Boolean(section("2 kap. 3 §")?.stycken?.reason),
  { stycken: section("2 kap. 3 §")?.stycken });
check("Last amended: 1 kap. 1 § is Lag (2020:100), 1 kap. 2 § Lag (2021:5), 2 kap. 1 § none",
  section("1 kap. 1 §")?.last_amended_by?.sfs === "2020:100"
    && section("1 kap. 1 §")?.last_amended_by?.marker === "Lag (2020:100)."
    && !section("1 kap. 1 §")?.last_amended_by?.text_follows
    && section("1 kap. 2 §")?.last_amended_by?.sfs === "2021:5"
    && section("2 kap. 1 §")?.last_amended_by === null,
  { a: section("1 kap. 1 §")?.last_amended_by, b: section("1 kap. 2 §")?.last_amended_by });

const refs = index.cross_references?.references ?? [];
const refIn = (locator, textStart) => refs.find((ref) => ref.within_locator === locator && ref.text.startsWith(textStart));
check("Cross-reference: '2 §' in 1 kap. 1 § resolves to K1P2",
  refIn("1 kap. 1 §", "2 §")?.kind === "internal" && refIn("1 kap. 1 §", "2 §")?.targets?.[0]?.anchor_name === "K1P2"
    && refIn("1 kap. 1 §", "2 §")?.targets?.[0]?.status === "resolved",
  { ref: refIn("1 kap. 1 §", "2 §") });
check("Cross-reference: '2 kap. 1 § andra stycket' (wrapped over a line) resolves to the stycke anchor K2P1S2",
  refIn("1 kap. 1 §", "2 kap. 1 §")?.targets?.[0]?.anchor_name === "K2P1S2"
    && refIn("1 kap. 1 §", "2 kap. 1 §")?.text === "2 kap. 1 § andra stycket",
  { ref: refIn("1 kap. 1 §", "2 kap. 1 §") });
check("Cross-reference: '3 kap. 4 § lagen (1999:1078)' is external and not resolved",
  refIn("1 kap. 1 §", "3 kap. 4 §")?.kind === "external" && !refIn("1 kap. 1 §", "3 kap. 4 §")?.targets?.length,
  { ref: refIn("1 kap. 1 §", "3 kap. 4 §") });
const range = refIn("1 kap. 2 §", "1–2 §§");
check("Cross-reference: '1–2 §§' expands to 1 kap. 1 § and 1 kap. 2 §, both resolved",
  range?.kind === "internal" && range.targets?.map((target) => target.locator).join("|") === "1 kap. 1 §|1 kap. 2 §"
    && range.targets.every((target) => target.status === "resolved"),
  { ref: range });
const missing = refIn("1 kap. 2 §", "9 §");
check("Cross-reference: '9 §' (no such section) is unresolved and reported as a warning",
  missing?.targets?.[0]?.status === "unresolved"
    && index.cross_references.unresolved.some((item) => item.within_locator === "1 kap. 2 §" && item.text === "9 §"),
  { ref: missing, unresolved: index.cross_references?.unresolved });
check("Cross-reference: '1 kap. 1 § femte stycket' (no such stycke) is unresolved",
  refIn("2 kap. 3 §", "1 kap. 1 §")?.targets?.[0]?.status === "unresolved",
  { ref: refIn("2 kap. 3 §", "1 kap. 1 §") });
check("Cross-reference: a section's own number and the amendment marker are not references",
  !refs.some((ref) => ref.text === "1 §" && ref.within_locator === "1 kap. 1 §" && ref.source_offsets.start === section("1 kap. 1 §").start_offset)
    && !refs.some((ref) => /Lag \(/.test(ref.text)),
  { refs: refs.map((ref) => `${ref.within_locator}: ${ref.text}`) });
check("Cross-reference counts add up and are reported",
  index.cross_references.count === refs.length
    && index.cross_references.unresolved_count === index.cross_references.unresolved.length
    && index.cross_references.unresolved_count === 2
    && index.cross_references.external_count === 1,
  { counts: { count: index.cross_references?.count, unresolved: index.cross_references?.unresolved_count, external: index.cross_references?.external_count } });
check("Cross-reference offsets point at the reference in the raw text",
  refs.every((ref) => synthetic.text.slice(ref.source_offsets.start, ref.source_offsets.end_exclusive).replace(/\s+/g, " ") === ref.text),
  { bad: refs.filter((ref) => synthetic.text.slice(ref.source_offsets.start, ref.source_offsets.end_exclusive).replace(/\s+/g, " ") !== ref.text) });

check("Last amended: a prose citation 'Lag (2018:672) om …' is not a marker; a marker at a line end without a full stop is",
  lastAmendedBy("1 § Lag (2018:672) om ekonomiska föreningar gäller.") === null
    && lastAmendedBy("1 § Text. Lag (2022:836)\r\n\r\n")?.sfs === "2022:836"
    && lastAmendedBy("1 § Text. Lag (2020:613).\r\nLag (2024:1117).")?.sfs === "2024:1117");

// Packets through the CLI.
const cache = await mkdtemp(join(tmpdir(), "subdivisions-"));
async function cacheDocument(sourceId, document) {
  await mkdir(join(cache, "cache", sourceId), { recursive: true });
  await writeFile(join(cache, "cache", sourceId, "2026-10-20T00-00-00-000Z.json"),
    JSON.stringify({ dokumentstatus: { dokument: document } }), "utf8");
}
await cacheDocument("sfs-2099-5", synthetic);
const provision = (locator, sourceId = "sfs-2099-5", cacheDir = join(cache, "cache")) => JSON.parse(execFileSync("node", [
  "connector/get_provision.mjs", "--source", sourceId, "--locator", locator,
  ...(cacheDir ? ["--cache-dir", cacheDir] : []), "--run-dir", join(cache, "runs"), "--case-dir", join(cache, "cases")],
{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const partOf = (packet) => packet.text?.slice(packet.subdivision?.offsets_in_text?.start, packet.subdivision?.offsets_in_text?.end_exclusive);
const rawOf = (document, packet) => document.text.slice(packet.subdivision.source_offsets.start, packet.subdivision.source_offsets.end_exclusive)
  .replace(/\r\n|\r/g, "\n").trim();

const whole = provision("1 kap. 1 §");
check("Section packet: unchanged shape, plus last_amended_by and cross_references, no subdivision",
  whole.status === "found" && !("subdivision" in whole) && whole.canonical_locator === "1 kap. 1 §"
    && whole.last_amended_by?.sfs === "2020:100" && whole.cross_references?.count === 3
    && whole.packet_version === "0.2",
  { status: whole.status, last_amended_by: whole.last_amended_by, cross_references: whole.cross_references });
check("Section packet: cross-reference offsets point into packet text",
  whole.cross_references.references.every((ref) => whole.text.slice(ref.offsets_in_text.start, ref.offsets_in_text.end_exclusive).replace(/\s+/g, " ") === ref.text),
  { references: whole.cross_references.references });

const second = provision("1 kap. 1 § andra stycket");
const secondExpected = "Andra stycket inleds så:\n\n1. första punkten,\n\n2. andra punkten enligt 3 kap. 4 § lagen (1999:1078) om x, och\n\n3. tredje punkten. Lag (2020:100).";
check("Stycke packet: found, whole section kept in text, the stycke in subdivision with its own hash and offsets",
  second.status === "found" && second.canonical_locator === "1 kap. 1 §" && second.text === whole.text
    && second.section_sha256 === whole.section_sha256
    && second.subdivision?.canonical_locator === "1 kap. 1 § andra stycket"
    && second.subdivision.kind === "stycke" && second.subdivision.stycke === 2 && second.subdivision.point === null
    && second.subdivision.anchor_name === "K1P1S2"
    && second.subdivision.text === secondExpected && second.subdivision.text_sha256 === sha256(secondExpected)
    && partOf(second) === secondExpected && rawOf(synthetic, second) === secondExpected,
  { subdivision: second.subdivision, status: second.status });
const first = provision("1 kap. 1 § första stycket");
check("Stycke packet: första stycket uses the paragraph anchor and stops before the next stycke",
  first.subdivision?.anchor_name === "K1P1" && first.subdivision?.text === "Första stycket hänvisar till 2 § och 2 kap. 1 § andra\nstycket.",
  { subdivision: first.subdivision });
const point2 = provision("1 kap. 1 § andra stycket 2");
check("Point packet: andra stycket 2 is exactly that point",
  point2.status === "found" && point2.subdivision?.kind === "point" && point2.subdivision.point === "2"
    && point2.subdivision.text === "2. andra punkten enligt 3 kap. 4 § lagen (1999:1078) om x, och" && partOf(point2) === point2.subdivision.text,
  { subdivision: point2.subdivision });
const point3 = provision("1 kap. 1 § 2 st. 3 p.");
check("Point packet: the last point runs to the end of its stycke ('2 st. 3 p.' form)",
  point3.status === "found" && point3.subdivision?.text === "3. tredje punkten. Lag (2020:100)."
    && point3.subdivision.canonical_locator === "1 kap. 1 § andra stycket 3",
  { subdivision: point3.subdivision });
const bare = provision("1 kap. 1 § punkt 2");
check("Point without stycke: found when only one stycke has that point; canonical names the stycke",
  bare.status === "found" && bare.subdivision?.canonical_locator === "1 kap. 1 § andra stycket 2",
  { subdivision: bare.subdivision, status: bare.status });
const notStycke = provision("1 kap. 1 § tredje stycket");
check("Refusal: a stycke the publisher does not have is not_found, with the section count",
  notStycke.status === "not_found" && !notStycke.text && notStycke.subdivision?.status === "not_found"
    && notStycke.subdivision?.stycke_count === 2,
  { status: notStycke.status, subdivision: notStycke.subdivision, warning: notStycke.warning });
const notPoint = provision("1 kap. 1 § andra stycket 4");
check("Refusal: a point the stycke does not have is not_found", notPoint.status === "not_found" && !notPoint.text,
  { status: notPoint.status, subdivision: notPoint.subdivision });
const ambiguousPoint = provision("2 kap. 2 § punkt 1");
check("Refusal: a point without stycke present in two stycken is ambiguous",
  ambiguousPoint.status === "ambiguous" && !ambiguousPoint.text
    && ambiguousPoint.subdivision?.candidates?.join("|") === "2 kap. 2 § första stycket 1|2 kap. 2 § andra stycket 1",
  { status: ambiguousPoint.status, subdivision: ambiguousPoint.subdivision });
const pointOk = provision("2 kap. 2 § andra stycket 1");
check("Point packet: a point followed by another point is found", pointOk.status === "found" && pointOk.subdivision?.text === "1. c,",
  { subdivision: pointOk.subdivision });
const pointUnclear = provision("2 kap. 2 § andra stycket 2");
check("Refusal: a point followed by a non-point line has no confirmed end: unknown, text shown with a note",
  pointUnclear.status === "unknown" && !pointUnclear.text
    && pointUnclear.review_action?.source_observation?.candidates?.[0]?.excerpt?.includes("2. d,")
    && /end/i.test(pointUnclear.review_action?.source_observation?.note ?? ""),
  { status: pointUnclear.status, review_action: pointUnclear.review_action });
const unclear = provision("2 kap. 3 § andra stycket");
check("Refusal: unconfirmed stycke structure is unknown; the whole confirmed section is shown with a note",
  unclear.status === "unknown" && !unclear.text && unclear.subdivision?.status === "unknown"
    && unclear.review_action?.source_observation?.candidates?.[0]?.excerpt?.startsWith("3 § Rubrikstycke")
    && Boolean(unclear.review_action?.source_observation?.note),
  { status: unclear.status, subdivision: unclear.subdivision, review_action: unclear.review_action });
const sectionMissing = provision("1 kap. 7 § andra stycket");
check("Refusal: a stycke of a missing section is not_found like the section",
  sectionMissing.status === "not_found" && sectionMissing.subdivision?.requested_locator === "1 kap. 7 § andra stycket",
  { status: sectionMissing.status, subdivision: sectionMissing.subdivision });

// Variant: the HTML stycke differs from the plain text.
const differs = { ...synthetic, beteckning: "2099:6", html: synthetic.html.replace("Andra stycket här.", "Annan lydelse här.") };
await cacheDocument("sfs-2099-6", differs);
const differsIndex = buildIndex({ sourceId: "sfs-2099-6", document: differs, rawFile: "x.json" });
check("Variant: HTML stycke text differs from the plain text: stycken unconfirmed",
  differsIndex.sections.find((item) => item.locator === "2 kap. 1 §")?.stycken?.status === "unconfirmed",
  { stycken: differsIndex.sections.find((item) => item.locator === "2 kap. 1 §")?.stycken });
check("Variant: lookup refuses with unknown", provision("2 kap. 1 § första stycket", "sfs-2099-6").status === "unknown");

// Variant: the publisher prints the next heading untagged after the amendment marker (ABL 20 kap. 36 §).
const untagged = {
  ...synthetic,
  beteckning: "2099:7",
  text: synthetic.text.replace("9 §. Lag (2021:5).", "9 §. Lag (2021:5).\r\nOinmärkt rubrik"),
  html: synthetic.html.replace("<i>Lag (2021:5)</i>.", "<i>Lag (2021:5)</i>.<br />Oinmärkt rubrik"),
};
const untaggedIndex = buildIndex({ sourceId: "sfs-2099-7", document: untagged, rawFile: "x.json" });
const untaggedSection = untaggedIndex.sections.find((item) => item.locator === "1 kap. 2 §");
// C11 (Robert, 2026-10-21) replaced D014's refusal: the section ends at the marker, the heading moves
// to the next section, and the stycken are confirmed.
const nextAfterUntagged = untaggedIndex.sections[untaggedIndex.sections.indexOf(untaggedSection) + 1];
check("Variant: untagged heading after the amendment marker is cut (C11): stycken confirmed, no text_follows, heading on the next section",
  untaggedSection?.stycken?.status === "confirmed" && untaggedSection?.last_amended_by?.sfs === "2021:5"
    && !untaggedSection.last_amended_by.text_follows
    && (nextAfterUntagged?.headings_before ?? []).includes("Oinmärkt rubrik"),
  { stycken: untaggedSection?.stycken, last_amended_by: untaggedSection?.last_amended_by,
    next_headings_before: nextAfterUntagged?.headings_before });

// --- Cached ABL and LAS ----------------------------------------------------------------------

const cacheDir = join(root, "cache", "riksdagen");
async function cached(sourceId) {
  try { return await loadCachedDocument(cacheDir, sourceId); } catch { skipped.push(`${sourceId} (not cached)`); return null; }
}
const abl = await cached("sfs-2005-551");
if (abl) {
  const ablIndex = buildIndex({ sourceId: "sfs-2005-551", document: abl.document, rawFile: abl.rawFile });
  const p = provision("13 kap. 6 § första stycket 4", "sfs-2005-551", null);
  check("ABL 13 kap. 6 § första stycket 4: the fourth point, exactly",
    p.status === "found" && p.subdivision?.text === "4. ett yttrande över den redogörelse som avses i 3,\nundertecknat av bolagets revisor."
      && partOf(p) === p.subdivision.text && rawOf(abl.document, p) === p.subdivision.text,
    { status: p.status, subdivision: p.subdivision });
  const s = provision("13 kap. 7 § andra stycket", "sfs-2005-551", null);
  check("ABL 13 kap. 7 § andra stycket: the sentence after the list, anchor K13P7S2",
    s.status === "found" && s.subdivision?.anchor_name === "K13P7S2"
      && s.subdivision.text === "Redogörelsen skall ha det innehåll som anges i 2 kap. 7 och\n9 §§.",
    { status: s.status, subdivision: s.subdivision });
  check("ABL 13 kap. 6 § andra stycket: not_found (one stycke; the next block is a heading)",
    provision("13 kap. 6 § andra stycket", "sfs-2005-551", null).status === "not_found");
  const s19 = ablIndex.sections.find((item) => item.locator === "2 kap. 19 §");
  const arlLast = await cached("sfs-1995-1554");
  if (arlLast) {
    const arlIndex = buildIndex({ sourceId: "sfs-1995-1554", document: arlLast.document, rawFile: arlLast.rawFile });
    const last = arlIndex.sections.at(-1);
    check("ÅRL 10 kap. 1 §: stycken end at Övergångsbestämmelser; the amendment marker is read from the section, not the annexes",
      last?.stycken?.appended_after_heading === "Övergångsbestämmelser" && last?.last_amended_by?.sfs === "2024:1115" && !last.last_amended_by.text_follows,
      { stycken: last?.stycken, last_amended_by: last?.last_amended_by });
  }
  const { execFileSync: run } = await import("node:child_process");
  const manifest = JSON.parse(run("node", ["connector/build_source_manifest.mjs", "--source", "sfs-2005-551", "--locator", "13 kap. 6 § tredje stycket",
    "--run-dir", join(cache, "runs")], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) || "{}");
  const locatorCheck = JSON.stringify(manifest).includes("13 kap. 6 § tredje stycket") ? JSON.stringify(manifest) : "";
  check("Source manifest: a stycke locator is not reported with the section's status", /located per lookup by get_provision/.test(locatorCheck),
    { excerpt: locatorCheck.slice(0, 300) });
  check("ABL 2 kap. 19 §: 4 stycken, last amended by Lag (2011:1046)",
    s19?.stycken?.count === 4 && s19?.last_amended_by?.sfs === "2011:1046", { stycken: s19?.stycken, last: s19?.last_amended_by });
  const r = ablIndex.cross_references.references.filter((ref) => ref.within_locator === "13 kap. 7 §");
  check("ABL 13 kap. 7 §: '3 §' resolves to K13P3; '2 kap. 7 och 9 §§' to K2P7 and K2P9; '2 kap. 5 § andra stycket 1-3 och 5' to K2P5S2",
    r.some((ref) => ref.text === "3 §" && ref.targets[0]?.anchor_name === "K13P3")
      && r.some((ref) => ref.text === "2 kap. 7 och 9 §§" && ref.targets.map((t) => t.anchor_name).join("|") === "K2P7|K2P9")
      && r.some((ref) => ref.text.startsWith("2 kap. 5 § andra stycket") && ref.targets[0]?.anchor_name === "K2P5S2"),
    { refs: r });
  // C11 (2026-10-21): the six ABL sections now end at their marker and their stycken are confirmed.
  const c11Stycken = ["20 kap. 12 §", "20 kap. 36 §", "23 kap. 56 §", "24 kap. 61 §", "25 kap. 51 §", "28 kap. 4 §"]
    .map((locator) => [locator, ablIndex.sections.find((item) => item.locator === locator)?.stycken?.status]);
  check("ABL: the C11 sections have confirmed stycken and no text after their marker",
    c11Stycken.every(([, status]) => status === "confirmed")
      && ["20 kap. 12 §", "20 kap. 36 §"].every((locator) => !ablIndex.sections.find((item) => item.locator === locator)?.last_amended_by?.text_follows),
    { c11Stycken });
  check("ABL: every cross-reference is internal-resolved, internal-unresolved (listed) or external",
    ablIndex.cross_references.references.every((ref) => ref.kind === "external"
      || ref.targets.every((t) => t.status === "resolved") || ablIndex.cross_references.unresolved.some((u) => u.text === ref.text && u.within_locator === ref.within_locator)),
    { counts: { count: ablIndex.cross_references.count, unresolved: ablIndex.cross_references.unresolved_count } });
}
const las = await cached("sfs-1982-80");
if (las) {
  const lasIndex = buildIndex({ sourceId: "sfs-1982-80", document: las.document, rawFile: las.rawFile });
  const p = provision("7 § fjärde stycket", "sfs-1982-80", null);
  check("LAS 7 § fjärde stycket: found, anchor P7S4, ends with Lag (2022:835).",
    p.status === "found" && p.subdivision?.anchor_name === "P7S4" && p.subdivision.text.endsWith("Lag (2022:835).")
      && p.last_amended_by?.sfs === "2022:835",
    { status: p.status, subdivision: p.subdivision });
  const ref30 = lasIndex.cross_references.references.find((ref) => ref.within_locator === "7 §" && ref.text === "30 §");
  check("LAS 7 §: 'enligt 30 §' resolves to P30 (chapterless Act)", ref30?.targets?.[0]?.anchor_name === "P30", { ref: ref30 });
  const p39 = provision("39 § andra stycket", "sfs-1982-80", null);
  check("LAS 39 § andra stycket: unknown, because the publisher wraps the stycke's opening in a heading tag",
    p39.status === "unknown" && lasIndex.sections.find((item) => item.locator === "39 §")?.stycken?.status === "unconfirmed",
    { status: p39.status, subdivision: p39.subdivision });
}

const summary = {
  test_suite: "subdivisions-references-v0.1",
  generated_at: new Date().toISOString(),
  total: results.length,
  passed: results.filter((result) => result.status === "pass").length,
  failed: results.filter((result) => result.status === "fail").length,
  skipped,
  results,
};
const runsDir = new URL("../runs/", import.meta.url).pathname;
await mkdir(runsDir, { recursive: true });
const receiptPath = join(runsDir, `subdivisions-references-${summary.generated_at.replaceAll(/[:.]/g, "-")}.json`);
await writeFile(receiptPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ receipt: receiptPath, ...summary, results: results.filter((r) => r.status === "fail") }, null, 2));
if (summary.failed > 0) process.exitCode = 1;
