# Changes

This page tracks changes a user would notice. The [README](README.md) explains how to
start; the [technical documentation guide](docs/README.md) holds the detailed evidence
and design notes.

## v0.2.0 (2026-10-21)

- **Provision text now stops before the next section's heading.** Earlier versions could
  include the following heading at the end of a provision, for example ABL 29 kap. 1 § ended
  with "Revisors, lekmannarevisors och särskild granskares skadeståndsansvar". The connector
  now uses Riksdagen's own HTML headings to find where a provision ends: two-line headings,
  chapter headings, runs of headings and heading version markers are no longer included.
  Statute text is never removed. Affected provisions get new `text`, `section_sha256` and
  offsets; older receipts for them keep their old hashes, and a comparison reports the change.
  In the cached test set this affected 281 provisions in 12 Acts (ABL 137).
- Seven provisions where Riksdagen prints the next heading as plain text right after the
  amendment marker (ABL 20 kap. 12 §, 20 kap. 36 §, 23 kap. 56 §, 24 kap. 61 §, 25 kap. 51 §,
  28 kap. 4 §; ÅRL 7 kap. 31 g §) now end at that marker; the heading belongs to the next
  provision, and stycke lookups work there too.
- The local index (version 0.7) records each provision's chapter title and the headings
  directly before it, and lists every heading with its position. This is groundwork for a
  map of a whole Act. Indexes rebuild automatically.
- The ABL example's packets P09 (29 kap. 1 §) and P12 (13 kap. 2 §) no longer carry the
  following heading.
- Skill text: a "Hard rules" block and a clearer trigger description.
- **Årsredovisningslagen (ÅRL) is now a supported source.** A provision now starts only where
  Riksdagen's HTML marks a paragraph. Lines such as "3 a § om väsentlighet," inside ÅRL
  7 kap. 7 § are a list of references, not new provisions, so they stay in 7 kap. 7 §, and
  ÅRL lookups return text instead of a held result. Text with no publisher mark that reads like
  a real provision still holds the source: Upphovsrättslagen 7 kap. 53 g § stays held. No other
  cached Act changed status. Packets show `in_text_reference_count` and, where it applies,
  a `method_note`.
- **A heading the connector cannot find now blocks.** If Riksdagen's HTML puts a heading
  before the next provision and the text lacks it, the provision before it is returned as
  `unknown` with a `boundary` note, instead of possibly running on into the next
  provision. No cached Act has such a case today.
- **A section printed inside another is held, with its text shown.** Riksdagen's published
  ABL prints `15 kap. 30 §` and `15 kap. 41 §` inside the section before them, without their
  own section mark. Earlier, 29 § and 40 § came back confirmed with the next section inside
  them, and 30 § and 41 § came back as not found. All four now come back `unknown` with the
  published text marked unverified and a note that explains the problem. The same applies to
  the heading stop above. Index version 0.9; indexes rebuild automatically.
- README, START-HERE, the review guide and the skill now explain lines such as
  "3 a § om väsentlighet," inside a provision: they are references, not separate
  provisions. The review guide's worked example is now Upphovsrättslagen `1 kap. 2 §`.
  The capability-review command no longer reports ÅRL's references as a mismatch. The ABL
  example is regenerated at index 0.9 (same text and hashes).
- **Stycke and punkt addresses.** Ask for `13 kap. 6 § andra stycket`, `… andra stycket 2`,
  `… 2 st. 2 p.` or `… 6 § punkt 2` and the packet carries exactly that part in a new
  `subdivision` object, with its own hash and its offsets in the section text. The rest of the
  packet is unchanged: `text` is still the whole section. The part is located only from
  Riksdagen's own stycke marks and point lines; when they do not line up with the text (LAS
  39 §, where the publisher wraps the second stycke's opening in a heading tag), the result is
  `unknown` with the section shown and a note. A stycke or point that does not exist is
  `not_found`; a point found in two stycken is `ambiguous`.
- **Cross-references and "last amended by".** Each found packet lists the references inside
  the section (`cross_references`), with the publisher anchor each internal one points to or
  the reason it could not be placed, and `last_amended_by`, the latest `Lag (YYYY:NNN).` marker
  printed in the section. The index lists every reference in the Act. Index version 0.10;
  indexes rebuild automatically. The packet schema stays 0.2.

## v0.1.8

- `--fresh` checks the official Riksdagen source again and reports whether its text or
  HTML changed. A failed check returns `unknown` rather than presenting cached text as
  current.
- Plain cached lookup now skips malformed, textless and wrong-identity snapshots,
  reports their filenames in `ignored_snapshots`, and uses the newest valid snapshot.
- CISG annex article lookup now applies the same valid-snapshot selection and reports
  skipped cached files.
- Dated URL and ABL timing cases now run from small pinned source excerpts with
  original-snapshot provenance, so they remain testable after the live text changes.
- Blocked results can show identifiable official text as an **unverified source
  observation**, separate from confirmed provision text.
- A local page lets a person inspect and record the boundaries of one provision.
  A valid decision releases only that locator in the reviewed snapshot; timing and
  unsupported cases remain explanation-only.
- The same commands and decision file work across local AI assistants. A remote
  workspace may need the HTML-and-JSON handoff instead of a browser link.

See the [local review guide](docs/LOCATOR-REVIEW-GUIDE.md) for a short walkthrough.
The [synthetic HTML example](examples/locator-review/README.md) shows the review layout
without offering a live decision.
Download the [v0.1.8 connector source](https://github.com/robertkuter/legal-source-connector/archive/refs/tags/v0.1.8.zip)
or the [portable](https://github.com/robertkuter/legal-source-connector/releases/download/v0.1.8/sv-legal-source-grounding-v0.1.8-portable.zip)
or [Codex](https://github.com/robertkuter/legal-source-connector/releases/download/v0.1.8/sv-legal-source-grounding-v0.1.8-codex.zip)
skill ZIP for this release.

### In plain terms

The connector keeps dated copies of Swedish laws downloaded from Riksdagen. Two things
changed.

**A damaged copy no longer blocks lookups.** If a download failed and left a broken or
wrong file behind, the connector used to stop. It now skips that file, uses the most
recent good copy, and says which file it skipped.

**Tests no longer break when the law changes.** Some tests check how the connector
handles a provision printed in two versions: the old wording and the new wording that
takes effect on a set date. Once the new wording is in force, Riksdagen publishes only
that version, and the test has nothing left to check. Short, exact passages from the
dated copies are now kept with the tests, each with a record of where it came from and
a fingerprint that proves it has not been altered. Those tests keep working whatever
Riksdagen publishes today.

One test expectation changed because the law itself changed: Skadeståndslagen
3 kap. 5 §, amended by SFS 2026:1207. A person checked the new wording against the
official page before the test was updated. The tests never quietly accept a change in
the law.

### Pre-release check on 2026-10-08

Fresh orientation retrieved all 16 required Riksdagen sources. The current
[Skadeståndslagen source](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/skadestandslag-1972207_sfs-1972-207/)
is consolidated through SFS 2026:1207 and now presents one unmarked `3 kap. 5 §`.
The current indexed snapshot has 38 sections. Commercial coverage checks the section
count against structural evidence and confirms the unique locator; the ambiguity case
at Konkurrenslagen `4 kap. 16 a §` remains tested.

The dated URL and ABL cases use bundled excerpts from the original 2026-08-24 and
2026-10-08 snapshots. Their full-source hashes, source URLs and extraction boundaries
are recorded with each fixture. The fixture tests cover the URL reviewed-locator and
I:/U: cases, ABL's `4 kap. 47 §` pair, and future-only `7 kap. 68 a §`.
On the freshly oriented cache, all nine suites pass with no skips: synthetic core
41/41, locator-review synthetic 50/50, staleness 9/9, connector 41/41,
cached locator review 18/18, commercial coverage 105/105, source manifest 15/15,
manifest coverage 163/163 and CISG annex 19/19.

The live `sfs-1972-207`, `1 kap. 1 §` check returned packet status `found` with
`source_check.status: verified_unchanged`. The immediately following plain lookup
returned packet status `found`. Both selected
`2026-10-08T13-19-30-386Z.json`.

## v0.1.7

The [previous public prerelease](https://github.com/robertkuter/legal-source-connector/releases/tag/v0.1.7)
contains the connector, portable skill, source packets, tests and dated ABL example.
Its downloads do not include the changes above.
