# A GitHub-readable ABL example

This example shows how the connector's source evidence can support a readable work product.
It uses ten selected provisions from Aktiebolagslag (2005:551), usually called ABL. It is
not the connector, a complete guide to ABL or a legal-advice tool.

## One card in plain English

### The board has an active organisational role

The board is responsible for how the company is organised and run. It must keep an eye on
the company's financial position and make sure that bookkeeping and financial controls are
reliable. If it delegates work, it still needs to supervise that arrangement.

- **Source address:** ABL 8 kap. 4 §
- **Evidence status:** `found` in packet P02
- **What still needs legal review:** This does not answer how responsibility is divided in
  a particular company or whether a specific board process was adequate.

That separation is intentional: the readable explanation does not replace the provision
packet. The packet retains the Swedish text, source URL, retrieval time and digital
fingerprints used to check the result.

## What the complete example covers

| Topic | Source address |
|---|---|
| Shareholders and company debts | 1 kap. 3 § |
| The board's organisational role | 8 kap. 4 § |
| Equal rights and different share classes | 4 kap. 1 § and 4 kap. 3 § |
| Majority requirements for changes to the articles | 7 kap. 42 § |
| Directors' conflicts | 8 kap. 23 § |
| A route to damages liability | 29 kap. 1 § |
| Preferential rights in a new share issue | 13 kap. 1 § and 13 kap. 2 § |
| The control-balance-sheet signal | 25 kap. 13 § |

The same ten source-grounded cards produce two full views:

- **Reader view** — plain-English orientation for founders and directors.
- **Evidence view** — expandable source text and source records for lawyers, reviewers and
  builders.

The evidence is deliberately separate from the prose. The reader can hide it, but the
reference, quoted Swedish text, status and provenance remain available for checking.

## View the complete reader

GitHub does not run `index.html` as a webpage inside the repository. To use the complete
reader and its expandable evidence view:

1. Download the complete source repository.
2. Unzip it.
3. Open `examples/abl-primer/index.html` in a web browser.

Builders can inspect the same material directly in
[`grounded-artifact.json`](grounded-artifact.json).

## Rebuild it

From the project root:

```bash
node examples/abl-primer/render_primer.mjs
```

Then open `examples/abl-primer/index.html` in a browser.

## Validate

```bash
node tests/test_primer_example.mjs
```

The test checks that each card has a found packet, that the displayed packet text
reproduces its section hash, that locators do not drift, that the known ambiguous
`7 kap. 40 §` remains excluded, and that both HTML views render.

## Source boundary

The example uses a refreshed cached Riksdagen snapshot dated 2026-08-21 with consolidation
marker `t.o.m. SFS 2026:783`. It is not a live currentness check. Refresh the source and
regenerate the evidence before treating the example as current.

The source cards are a small teaching set, not a complete map of Aktiebolagslag
`(2005:551)`.
