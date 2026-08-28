# Testing model

Keep three kinds of testing separate. They answer different questions and should not be
collapsed into one score.

## 1. Connector tests — automated code checks

Question: does the code retrieve, index, address, hash and compare sources correctly?

From a fresh clone, the no-cache core test can run immediately:

```bash
node tests/test_synthetic.mjs
```

This checks the parser, general lettered and chapterless addressing, structural review
states, timing markers, dated and indeterminate values, hashes, line offsets and staleness
logic using synthetic documents. It covers flat sources, unmarked locators in a layered
source, unique marked versions and paired outgoing/incoming versions. It is the portable
smoke test for a public checkout.

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
locators, missing and ambiguous addresses, chapterless statutes and malformed locators.
It also verifies ABL's 28 section and seven heading timing markers and invokes the real
packet command to confirm that future-only `7 kap. 68 a §` returns `unknown` without text.
It does not require a model or internet access.

The live API should be tested separately because network availability and source changes
are external conditions. Keep live receipts as evidence, not as the only regression test.
A source-profile test run before orientation exits with a missing-source list and a
copyable orientation command. That means “local source evidence absent”, not “parser
failed”.

The curated commercial-law extension has its own cached-snapshot suite:

```bash
node tests/test_commercial_coverage.mjs
```

It checks the curated commercial extension sources, including Köplag, the two statutory
sections of Lag (1987:822) om internationella köp, Arbitration Act, Commercial Agency
Act, Räntelag, Skadeståndslag, Marknadsföringslag, Konkurrenslag, MBL, Bokföringslag and
Årsredovisningslag. It includes lettered-section locators, transition-bearing endings
and explicit ambiguous transition locators. Årsredovisningslag is deliberately retained
as `review_required` because its text contains a cross-reference list that the current
candidate parser mistakes for section headings.

The Swedish CISG translation annex is tested separately because it is a second structure
inside the official source, not an ordinary SFS section sequence:

```bash
node tests/test_cisg_annex.mjs
node connector/get_cisg_article.mjs --article "Artikel 1"
```

The 18-check suite verifies all 101 article headings, offsets, hashes, representative
article packets and the Act's own scope signal. It also records the partial HTML
cross-check: 48 article headings have publisher HTML anchors, while the text contains
101 standalone article headings. This is evidence for the separate index design, not a
claim that the translation layer has independent legal authority.

To understand why Årsredovisningslag is not yet promoted, produce the capability-review
packet:

```bash
node connector/review_source_capability.mjs --source sfs-1995-1554
```

The packet reports the first alignment mismatch, the exact false-positive candidates and
the surrounding source lines. It is intentionally a review artifact, not a provision
retrieval packet.

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
