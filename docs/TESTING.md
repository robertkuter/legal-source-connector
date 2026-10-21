# Testing model

Keep three kinds of testing separate. They answer different questions and should not be
collapsed into one score.

## 1. Connector tests — automated code checks

Question: does the code retrieve, index, address, hash and compare sources correctly?

From a fresh clone, the no-cache core test can run immediately:

```bash
node tests/test_synthetic.mjs
node tests/test_locator_review_synthetic.mjs
```

This checks the parser, general lettered and chapterless addressing, structural review
states, timing markers, dated and indeterminate values, hashes, line offsets and staleness
logic using synthetic documents. It covers flat sources, unmarked locators in a layered
source, unique marked versions and paired outgoing/incoming versions. It is the portable
smoke test for a public checkout.

The core suite also checks that `--fresh` compares with the newest valid pin when a
newer cache file is broken, and that orientation does not save failed, wrong-identity
or textless JSON as a source snapshot. The plain cached lookup uses that same valid-pin
selection, reports skipped snapshots in `ignored_snapshots`, and keeps index reuse and
locator-review decisions bound to the selected snapshot.

## Pinned excerpts for dated source behaviour

A test about how a statute read on a particular date uses a pinned excerpt under
`tests/fixtures/riksdagen/<source-id>/<original-snapshot-stamp>/`. Each directory has
JSON, text and HTML excerpts in the normal Riksdagen payload shape, plus
`provenance.json`. The fixtures contain only the relevant provisions, adjacent
boundaries and publisher markup; the full Acts stay in the ignored local cache. Tests
verify excerpt hashes and identity, copy the fixture to an isolated temporary cache,
then use the normal connector commands. A fresh clone can run these cases without the
historical full source.

To add or refresh a fixture, retrieve the official JSON, text and HTML; verify its SFS
identity and record the timestamp and SHA-256 of **each complete original response**.
Copy the target provision and enough neighbors to reproduce its condition, ending at
the next anchor. Preserve all selected source text and markup verbatim. Record the
first and last locator, next anchor, and offsets in the original JSON document's
`text` and `html` fields in
`provenance.json`; the JSON envelope may contain only the fields needed by the
connector. Check the excerpt hashes, structural capability and packet outcome. Add a
new stamped directory when the publisher changes rather than overwriting an older
fixture, and rerun the synthetic and real-source suites. An excerpt establishes the
historical test condition; a live check establishes what the publisher serves now.

## Required checks before any release tag

1. Orient a fresh cache from the real Riksdagen sources, then run all six real-source
   suites below. Each suite prints its copyable `orient_riksdagen.mjs` command if a
   required source is missing. These are the only suites that test real Riksdagen text
   and markup; record their check counts and any failures in the release notes.

   ```bash
   node tests/test_connector.mjs
   node tests/test_locator_review_cached.mjs
   node tests/test_commercial_coverage.mjs
   node tests/test_source_manifest.mjs
   node tests/test_source_manifest_coverage.mjs
   node tests/test_cisg_annex.mjs
   node tests/test_heading_boundaries.mjs
   node tests/test_subdivisions_references.mjs
   ```

   `test_subdivisions_references` (added 2026-10-20, decision D014) checks the locator grammar
   for stycke and point addresses, then a synthetic Act through the index and the CLI: stycke
   and point packets (exact part, own hash, offsets into the packet text), refusals
   (`not_found`, `ambiguous`, `unknown` with the section shown), cross-references (internal,
   external, range, unresolved with a warning) and `last_amended_by`; with cached sources, ABL
   `13 kap. 6 § första stycket 4`, `13 kap. 7 § andra stycket`, LAS `7 § fjärde stycket` and the
   refused LAS `39 § andra stycket`.

   `test_heading_boundaries` (added 2026-10-20, finding C9, decision D011) always runs its
   synthetic cases. With cached sources it also checks named ABL and Köplag sections and scans
   every cached, supported Act: no section may end with a publisher heading, every heading
   between two sections must be matched in the text, and ÅRL `7 kap. 7 §`'s cross-reference
   list must stay inside the provision. Since index 0.8 (decision D012) it also checks section
   starts and the heading stop: synthetic reference lists stay statute text, while an
   unanchored section-like line, a repeal line or a reference before the first section holds
   the source; a section before an unmatched heading is returned `unknown` with its published
   text as an unverified observation; since index 0.9 (D013) a section printed inside another
   (synthetic, and ABL `15 kap. 29/30 §` and `40/41 §`) is held the same way; every
   cached Act is supported except Upphovsrättslagen (URL), and only ÅRL has in-text
   references; ÅRL `7 kap. 7 §` and `2 kap. 3 §` are found and URL `7 kap. 53 g §` stays
   held. Without a cache it reports the cached parts as skipped.

2. Make one live fresh check, then repeat the same locator from the cache. Record both
   packet statuses and the selected `source_snapshot` in the release notes. This checks
   that an ordinary lookup works immediately after `--fresh`; all other `--fresh` tests
   use a stubbed fetch.

   ```bash
   node connector/get_provision.mjs --fresh --source sfs-1972-207 --locator "1 kap. 1 §"
   node connector/get_provision.mjs --source sfs-1972-207 --locator "1 kap. 1 §"
   ```

The locator-review synthetic suite is also cache-free. It models both an unanchored
section-like line (the URL `7 kap. 53 g §` shape; the ÅRL lower-case reference shape until
index 0.8, which D012 now reads as statute text) and the URL timing/version shape, then tests complete import plus
rejection of incomplete, unresolved, wrong-source, wrong-locator, changed-hash,
changed-index/schema, inconsistent-boundary, tampered-hash and scope-leaking records. It
also proves that structural review cannot select an `I:`/`U:` passage. Its local-viewer
check opens an ephemeral `127.0.0.1` port, verifies the token route and security headers,
and makes no internet request. It also verifies the versioned blocked-case report,
strict public-field allowlist, GitHub Markdown draft, stable-case/snapshot-occurrence IDs,
local deduplication and rejection of an attempted source-text field.

The source-profile tests require an explicit orientation step because the public package
does not bundle complete cached Acts. From a fresh terminal, first move into the project
directory:

```bash
cd legal-source-connector
```

The main connector suite uses four maintained source profiles. Orient all four in one
command:

```bash
node connector/orient_riksdagen.mjs \
  --source sfs-2005-551 \
  --source sfs-1982-80 \
  --source sfs-1915-218 \
  --source sfs-2008-567
```

After the source snapshot exists locally, run:

```bash
node tests/test_connector.mjs
```

This checks the full cached ABL index, every indexed section hash and offset, ABL and LAS
locators, missing addresses, chapterless statutes and malformed locators. Live temporal
counts are checked against the markers actually indexed. The pinned 2026-10-08 ABL
excerpt checks the `4 kap. 47 §` U:/I: pair and invokes the real packet command to
confirm that future-only `7 kap. 68 a §` returns `unknown` without text.
It does not require a model or internet access.

The live API should be tested separately because network availability and source changes
are external conditions. Keep live receipts as evidence, not as the only regression test.
A narrow live current-source smoke test is:

```bash
node connector/get_provision.mjs --fresh --source sfs-1972-207 --locator "1 kap. 1 §"
```

Inspect `source_check.checked_at`, `source_check.status`, `retrieval_mode`, source hashes,
structural capability and temporal resolution. Repeat once to check that unchanged bytes
reuse the same snapshot. The synthetic core suite covers changed text, changed HTML,
failed fetch and source-identity mismatch without depending on the live API.
A source-profile test run before orientation exits with a missing-source list and a
copyable orientation command. That means “local source evidence absent”, not “parser
failed”.

The curated commercial-law extension has its own cached-snapshot suite:

```bash
node tests/test_commercial_coverage.mjs
node tests/test_locator_review_cached.mjs
```

It checks the curated commercial extension sources, including Köplag, the two statutory
sections of Lag (1987:822) om internationella köp, Arbitration Act, Commercial Agency
Act, Räntelag, Skadeståndslag, Marknadsföringslag, Konkurrenslag, MBL, Bokföringslag and
Årsredovisningslag. It includes lettered-section locators, transition-bearing endings
and explicit ambiguous transition locators. Årsredovisningslag is supported since index 0.8
(D012): the cross-reference list inside `7 kap. 7 §` stays statute text, and `4 kap. 16 §`
stays ambiguous because of publisher `U:`/`I:` versions.

The cached locator-review suite uses local URL, Skadeståndslagen and Konkurrenslagen
snapshots without copying them or its temporary store into Git. It confirms URL
`7 kap. 53 f §` (the intervening `53 g §` has no publisher anchor; ÅRL `7 kap. 7 §` until
index 0.8) through an isolated acceptance decision that tests the mechanism only, calls the normal provision
command, checks `human_reviewed_snapshot` plus retained automatic `review_required`,
and proves that another locator remains blocked. On the current Skadeståndslagen
snapshot, `3 kap. 5 §` is a unique unmarked provision, so the suite confirms ordinary
lookup and that no review surface is needed. Konkurrenslagen `4 kap. 16 a §` still has
a duplicate publisher identity and editorial renumbering notice. Its page must be
`explanation_only`, display the classified blocking signals and expose no confirmation
or decision-download control. Generated decisions are automated fixtures in an
operating-system temporary directory, not real human legal review records. The shared
paired reading component is also checked by the synthetic locator-review suite.

The bundled URL excerpt is pinned to `2026-08-24T13-02-29-802Z`. It tests
`6 b kap. 52 i §` through an isolated locator decision and `2 a kap. 26 n §` as an
unresolved timing/source-map surface. Both cases run in a fresh clone without a
historical full-Act cache.

The unresolved Konkurrenslagen lookup writes its capability need into an isolated
temporary case register and exposes its case identifier through `review_action`; no
cached source, case record or receipt is checked into Git.

The Swedish CISG translation annex is tested separately because it is a second structure
inside the official source, not an ordinary SFS section sequence:

```bash
node tests/test_cisg_annex.mjs
node connector/get_cisg_article.mjs --article "Artikel 1"
```

The 19-check suite verifies all 101 article headings, offsets, hashes, representative
article packets and the Act's own scope signal. It also records the partial HTML
cross-check: 48 article headings have publisher HTML anchors, while the text contains
101 standalone article headings. It checks recovery from newer invalid cache files.
This is evidence for the separate index design, not a claim that the translation layer
has independent legal authority.

To understand why Upphovsrättslagen is held at `review_required`, produce the
capability-review packet (Årsredovisningslag was the example until index 0.8):

```bash
node connector/review_source_capability.mjs --source sfs-1960-729
```

The packet reports the first alignment mismatch, the exact false-positive candidates and
the surrounding source lines. It is intentionally a review artifact, not a provision
retrieval packet.

### Live source assertions still needing a fixture decision

The dated URL and ABL timing outcomes above are pinned. Other source-specific live
expectations remain in these suites and could change when the publisher consolidates
new amendments:

- `test_connector`: the named ABL and LAS locators, the LAS `7 §` wording phrase, and
  ABL chapter reach and heading boundaries.
- `test_commercial_coverage`: curated exact locators, ÅRL's supported profile (since 0.8),
  Konkurrenslagen `4 kap. 16 a §` ambiguity and editorial notice, and the CISG annex
  length assertion. Exact whole-Act section counts have been replaced with structural
  invariants.
- `test_locator_review_cached`: the live URL `7 kap. 53 f §` review surface, current Skadeståndslagen
  `3 kap. 5 §` uniqueness, and Konkurrenslagen's renumbering surface.
- `test_source_manifest`: the live ABL `13 kap. 6 §` found sample.
- `test_cisg_annex`: the publisher's partial HTML cross-check count of 48.

Decide whether to pin more excerpts for those specific behaviours or narrow those
tests to structural invariants. Do not silently update a dated expectation when a
live source changes.

The compact source-manifest layer has its own deterministic test:

```bash
node tests/test_source_manifest.mjs
```

This checks that a manifest preserves source identity, snapshot timing, publisher
currency metadata, hashes, attribution and structural/temporal capability without
embedding the complete Act. It also checks four important lookup boundaries: a found
unmarked locator, a missing locator, an ambiguous transition locator and a uniquely
future-marked locator refused as `unknown`. To create one for inspection, use:

```bash
node connector/build_source_manifest.mjs \
  --source sfs-2005-551 \
  --locator "13 kap. 6 §" \
  --locator "4 kap. 47 §"
```

The manifest is derived from the existing cache and does not itself make a network
request. A live source retrieval and a staleness comparison remain separate tests.

For a broader local source-profile pass, run:

```bash
node tests/test_source_manifest_coverage.mjs
```

This builds manifests across every cached Riksdagen source, including the curated
commercial set and the Acts deliberately left at `review_required`. It checks the
metadata boundary, representative found/missing/ambiguous/invalid locator outcomes,
the tracked ABL example and the documented CLI command.

## 2. Skill evaluations — assistant behavior checks

Question: does an assistant follow the source workflow and report uncertainty correctly?

Use [`evals/skill-test-cases.md`](../evals/skill-test-cases.md) in Claude and Codex. Record
invocation, tool-use, status handling, evidence display and the boundary between source
retrieval and legal interpretation.

These tests can initially be run by Robert. Later they can be automated through a model
harness that sends the same prompts, captures the response and checks for required fields
or forbidden behavior. The automated score should support human review, not replace it.

The v0.2 grounded-reader harness narrows the model task. The assistant produces a reader
draft with packet IDs; `connector/render_grounded_claims.mjs` deterministically adds the
source evidence. Its focused tests check that reader drafts contain no authoritative source
fields, unknown packet IDs are rejected, hashes reproduce the packet text, and explicitly
ungrounded claims remain visible:

```bash
node tests/test_grounded_claims.mjs
node tests/test_primer_example.mjs
```

## 3. Teaching and explanation checks

Question: can a lawyer understand what happened and explain it to another person?

Use the API map, build overview, distribution diagram and packet examples. Ask for a
teach-back in plain English:

> Where is the complete Act held? What did the index do? What proves which version was
> returned? What remains undecided?

For timing, add:

> Is this receipt telling us when the source was fetched, which displayed version the
> publisher marked, or whether the rule legally governed the facts? Which of those has
> the connector actually established?

This is not a software correctness test. It is a usability and explainability test.

## Artifact boundaries

| Artifact | Purpose | Should contain |
|---|---|---|
| Connector code | Deterministic operation | HTTP, cache, index, hashes, receipts |
| Packet contract | Stable interface | Fields, status values, timing/refusal rules, provenance and attribution |
| Skill | Agent behavior | When to call, how to report, when to stop |
| Evaluation set | Regression | Prompts, fixtures, expected behavior |
| API map/tutorial | Education | Diagrams, examples, explanations |
| Runtime cache | Evidence | Full local source snapshots; excluded from Git by default |
| Run receipt | Audit trail | Retrieval/comparison facts |

Fuse these in the public repository, but keep their responsibilities separate. A reader
should be able to learn from the documentation without importing it into an assistant's
runtime context.
