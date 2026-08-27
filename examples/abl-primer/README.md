# ABL primer: reader view plus source grounding

This example is a presentation layer built on top of the Swedish legal-source connector.
It is not the connector and it is not a legal-advice tool.

The same ten source-grounded cards produce two views:

- **Reader view** — plain-English orientation for founders and directors.
- **Evidence view** — expandable source text and provenance for lawyers, reviewers and builders.

The evidence is deliberately separate from the prose. The reader can hide it, but the
reference, quoted Swedish text, status and provenance remain available for checking.

## Build

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

The example uses a refreshed cached Riksdagen snapshot dated 2026-08-21 with consolidation marker
`t.o.m. SFS 2026:783`. It is not a live currentness check. Refresh the source and regenerate
the evidence before treating the example as current.

The source cards are a small teaching set, not a complete map of Aktiebolagslag
`(2005:551)`.
