# Changes

This page tracks changes a user would notice. The [README](README.md) explains how to
start; the [technical documentation guide](docs/README.md) holds the detailed evidence
and design notes.

## Available in the current source (not in v0.1.7)

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
The v0.1.7 release downloads do not include these changes. Download the
[current connector source](https://github.com/robertkuter/legal-source-connector/archive/refs/heads/main.zip)
to try the updated connector.

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

The [existing public prerelease](https://github.com/robertkuter/legal-source-connector/releases/tag/v0.1.7)
contains the connector, portable skill, source packets, tests and dated ABL example.
Its downloads do not include the changes above.
