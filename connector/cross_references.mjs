// D014: in-text section references inside each section ("enligt 30 §", "7 kap. 28 § tredje stycket",
// "2–5 §§"), resolved to the publisher's anchors. References to other Acts are external and not
// resolved; an internal reference that cannot be placed is listed as a warning, never dropped.

import { canonicalLocator } from "./text_lines.mjs";
import { ORDINALS, canonicalSubdivisionLocator, normalizeWithMap } from "./subdivisions.mjs";

const SEC = String.raw`\d+(?: [a-z](?![\p{L}]))?`;
const LIST_SEPARATOR = String.raw`(?:, | och | eller | samt | ?[-–] ?)`;
const REFERENCE = new RegExp(
  String.raw`(?<![\p{L}\d:(./§-])(?:(${SEC}) kap\. )?(${SEC}(?:${LIST_SEPARATOR}${SEC})*) §§?(?![\p{L}\d§])`, "gu");
const ORDINAL = `(?:${ORDINALS.join("|")})`;
const POINT = String.raw`\d+(?: ?[a-z](?![\p{L}]))?`;
const QUALIFIER = new RegExp(String.raw`^ (?:(${ORDINAL}(?:(?:, | och | ?[-–] ?)${ORDINAL})*) (?:stycket|styckena)|(\d+) st\.?)`
  + String.raw`((?: ${POINT}(?:(?:, | och | ?[-–] ?)${POINT})*)(?! ?(?:kap\.|§|st\b)))?`, "iu");
// The name of another Act right after a reference: "lagen (1995:1554)", "aktiebolagslagen",
// "offentlighets- och sekretesslagen", "regeringsformen", "samma lag".
const ACT_NAME = String.raw`(?:(?:den |samma |nämnda )?(?:(?:äldre|nya|upphävda) )?(?:lag|lagen|förordningen|balken)\b|(?:\p{Ll}+- och )?\p{L}+(?:lagen|balken|förordningen|ordningen|formen)\b|\(\d{4}:\d+\))`;
const EXTERNAL_TRAILER = new RegExp(String.raw`^,? (?:i |och i )?${ACT_NAME}`, "u");
// An Act named before a colon that introduces a list: "följande bestämmelser i årsredovisningslagen (1995:1554) tillämpas: 2 kap. 2 § om …".
const EXTERNAL_LEAD = new RegExp(String.raw`${ACT_NAME}(?: \(\d{4}:\d+\))?[^.:;§]{0,60}: (?:- )?$`, "u");
const OWN_ACT_TRAILER = /^,? (?:i )?lagen \((\d{4}:\d+)\)/;
// A point list directly after "§" ("12 kap. 1 § 2 lagen …", "21 kap. 1 § 3, 4 eller 5 aktiebolagslagen").
const BARE_POINTS = /^ \d+(?: [a-z](?!\p{L}))?(?:(?:, | och | eller | ?[-–] ?)\d+(?: [a-z](?!\p{L}))?)*/u;
// What may stand between two members of one list: a separator, a dash item, or an "om …" description.
const CHAIN_GAP = /^(?: (?:första|andra|tredje|sista) meningen)?(?: om (?:[^.;:§]|m\.m\.|m\.fl\.)*?)?(?:,| och| eller| samt| respektive|, och|, eller)? ?(?:- )?(?:i )?$/;

function expandOrdinals(value) {
  const numbers = [];
  for (const piece of value.toLowerCase().split(/, | och /)) {
    const [from, to] = piece.split(/ ?[-–] ?/).map((word) => ORDINALS.indexOf(word) + 1);
    for (let number = from; number <= (to || from); number += 1) numbers.push(number);
  }
  return numbers;
}

// Items of "7 och 9", "2–5", "3, 4 och 6 a": single sections and ranges.
function listItems(value) {
  const items = [];
  const tokens = value.split(/(, | och | eller | samt | ?[-–] ?)/);
  for (let i = 0; i < tokens.length; i += 2) {
    const separator = tokens[i - 1];
    if (separator && /[-–]/.test(separator)) items.at(-1).to = tokens[i];
    else items.push({ from: tokens[i] });
  }
  return items;
}

// References in one section's text, with offsets in the raw document text.
export function extractSectionReferences(text, section, ownSfs, normalizedSection = null) {
  const { normalized, map } = normalizedSection ?? normalizeWithMap(text, section.start_offset, section.end_offset_exclusive);
  const found = [];
  for (const match of normalized.matchAll(REFERENCE)) {
    if (match.index === 0) continue; // the section's own number
    let end = match.index + match[0].length;
    const qualifier = normalized.slice(end).match(QUALIFIER);
    if (qualifier) end += qualifier[0].length;
    const rest = normalized.slice(end).replace(BARE_POINTS, "");
    const ownAct = rest.match(OWN_ACT_TRAILER)?.[1] === ownSfs;
    found.push({
      start: match.index,
      end,
      text: normalized.slice(match.index, end),
      chapter: match[1] ?? null,
      items: listItems(match[2]),
      stycken: qualifier ? (qualifier[1] ? expandOrdinals(qualifier[1]) : [Number(qualifier[2])]) : [],
      points: qualifier?.[3]?.trim() ?? null,
      external: !ownAct && EXTERNAL_TRAILER.test(rest),
    });
  }
  // Members of one list ("5 kap. 25-28 och 31-37 §§, 38 § första stycket", "4 kap. 1 § och 5 kap. 2 §
  // lagen (…)") share the list's Act: a trailer after the last member or a lead before the first.
  // A member without "kap." takes the chapter of the member before it.
  const linked = (i) => i > 0 && CHAIN_GAP.test(normalized.slice(found[i - 1].end, found[i].start));
  for (let i = found.length - 2; i >= 0; i -= 1) {
    if (found[i + 1].external && linked(i + 1)) found[i].external = true;
  }
  found.forEach((reference, i) => {
    if (linked(i)) {
      reference.external ||= found[i - 1].external;
      if (!reference.chapter && found[i - 1].chapter) {
        reference.chapter = found[i - 1].chapter;
        reference.chapter_from_list = true;
      }
    } else if (EXTERNAL_LEAD.test(normalized.slice(Math.max(0, reference.start - 200), reference.start))) {
      reference.external = true;
    }
  });
  return found.map((reference) => ({
    ...reference,
    source_offsets: { start: map[reference.start], end_exclusive: map[reference.end - 1] + 1 },
  }));
}

// Resolve every section's references against the index. `structures[i]` is the stycke structure
// of sections[i] (styckeStructure), used to confirm stycke targets.
export function buildCrossReferences({ text, sections, structures, normalizedSections, hiddenSections, ownSfs, lineOf }) {
  const byKey = new Map();
  sections.forEach((section, position) => {
    const key = canonicalLocator(section);
    byKey.set(key, [...(byKey.get(key) ?? []), position]);
  });
  const hidden = new Set(hiddenSections.map((item) => item.locator));
  const resolveSection = (locator) => {
    const positions = byKey.get(locator) ?? [];
    if (positions.length === 1) return { position: positions[0] };
    if (positions.length > 1) return { reason: "several_sections_or_versions" };
    return { reason: hidden.has(locator) ? "printed_inside_another_section" : "no_such_section" };
  };
  const targetsFor = (chapter, sectionNumber, stycken) => {
    const locator = canonicalLocator({ chapter, section: sectionNumber });
    const resolved = resolveSection(locator);
    if (resolved.reason) return [{ locator, anchor_name: null, status: "unresolved", reason: resolved.reason }];
    const section = sections[resolved.position];
    if (!stycken.length) return [{ locator, anchor_name: section.anchor_name, status: "resolved" }];
    const structure = structures[resolved.position];
    return stycken.map((number) => {
      const stycke = structure.status === "confirmed" ? structure.stycken[number - 1] : null;
      const name = canonicalSubdivisionLocator({ chapter, section: sectionNumber, stycke: number });
      if (stycke) return { locator: name, anchor_name: stycke.anchor_name, status: "resolved" };
      return { locator: name, anchor_name: null, status: "unresolved",
        reason: structure.status === "confirmed" ? "no_such_stycke" : "stycke_structure_unconfirmed" };
    });
  };
  const rangeTargets = (chapter, from, to, stycken) => {
    const start = resolveSection(canonicalLocator({ chapter, section: from }));
    const end = resolveSection(canonicalLocator({ chapter, section: to }));
    if (start.reason || end.reason || start.position > end.position) {
      return [...targetsFor(chapter, from, []), ...targetsFor(chapter, to, [])].map((target) => (target.status === "resolved"
        ? { ...target, status: "unresolved", reason: "range_not_resolved" } : target));
    }
    return sections.slice(start.position, end.position + 1)
      .filter((section) => section.chapter === chapter)
      .flatMap((section) => targetsFor(chapter, section.section, stycken));
  };

  const references = [];
  sections.forEach((section, position) => {
    for (const found of extractSectionReferences(text, section, ownSfs, normalizedSections[position])) {
      const chapter = found.chapter ?? section.chapter;
      const targets = found.external ? [] : found.items.flatMap((item) => (item.to
        ? rangeTargets(chapter, item.from, item.to, found.stycken)
        : targetsFor(chapter, item.from, found.stycken)));
      references.push({
        text: found.text,
        kind: found.external ? "external" : "internal",
        within_locator: section.locator,
        ...(found.chapter_from_list ? { chapter_from_list: true } : {}),
        line: lineOf(found.source_offsets.start),
        source_offsets: found.source_offsets,
        ...(found.points ? { points: found.points } : {}),
        targets,
      });
    }
  });
  const unresolved = references.filter((reference) => reference.targets.some((target) => target.status === "unresolved"))
    .map((reference) => ({
      within_locator: reference.within_locator,
      text: reference.text,
      line: reference.line,
      reasons: [...new Set(reference.targets.filter((target) => target.reason).map((target) => target.reason))],
    }));
  return {
    method: "in_text_section_references_resolved_to_publisher_anchors",
    count: references.length,
    internal_count: references.filter((reference) => reference.kind === "internal").length,
    external_count: references.filter((reference) => reference.kind === "external").length,
    unresolved_count: unresolved.length,
    unresolved,
    references,
  };
}
