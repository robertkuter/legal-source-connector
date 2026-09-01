# Swedish legislation source connector

Status: explainability alpha; not production legal software.

**Start here:** [choose the right download or route](#choose-what-you-want-to-do), or
[read the concrete example](#a-concrete-example).

This repository contains a small software connector and an assistant skill. The connector
retrieves an identified Swedish Act from Riksdagen and keeps a working copy on the user's
computer. It checks the Act's structure, then creates a small evidence packet for the
requested provision. The skill tells an AI assistant how to use that packet, explain its
source and know when to stop.

The current connector handles legislation published through Riksdagen. Another authority
would need its own connector and tests. For each citation, this connector returns one
provision, no exact match, more than one possible version, or a clear statement that it
cannot confirm the source safely. It confirms source text, not meaning, applicability, or
legal advice.

## A concrete example

Suppose you ask for `13 kap. 6 § aktiebolagslagen (2005:551)`. The software follows this
path:

```text
legal citation
  → official SFS identity: 2005:551
  → downloaded copy from Riksdagen
  → checked map of its chapters and sections
  → requested provision
  → small evidence record
```

The resulting evidence record says when the connector downloaded the source and whether
Riksdagen marked a change of version. It includes a digital fingerprint of the text (a
**hash**), the provision's position in the source (**offsets**), and a saved JSON record of
the operation (a **receipt**).

The complete Act stays in a **local cache**, a working folder on the user's computer. This
avoids repeated downloads and gives later checks a stable reference. The assistant normally
receives only the provision and its evidence record.

## How the pieces fit

Five objects keep retrieval, evidence, assistant behaviour, and presentation separate:

| Object | Job | What it is not |
|---|---|---|
| **Connector** (`connector/`) | Retrieves one Act, stores it locally, checks its structure, and returns a requested provision. | An AI model or legal-analysis engine. |
| **Provision packet** | Records the result and source evidence for one cited chapter and section. | A conclusion that the provision applies. |
| **Skill** (`skill/`) | Tells a compatible assistant how to use a packet and report uncertainty. | The connector or a source download. |
| **Source manifest** | Summarises one downloaded Act and whether its chapter-and-section map passed. | The Act or a provision packet. |
| **Grounded artifact** | Presents readable claims linked to exact packets by ID. | A replacement for the packets or legal review. |

The skill follows the [Agent Skills open standard](https://agentskills.io/): a `SKILL.md`
file with optional resources. Skills-compatible products can use the same core; Codex
display metadata stays separate in `agents/openai.yaml`.

## Choose what you want to do

GitHub is designed primarily for code projects, so its controls do not distinguish the
connector from the assistant skill. Use the direct route that matches your task:

| Your aim | Start here | What you receive |
|---|---|---|
| Use the skill with Claude or another compatible assistant | [Download for Claude or another compatible assistant](https://github.com/robertkuter/legal-source-connector/releases/download/v0.1.7/sv-legal-source-grounding-v0.1.7-portable.zip) | The portable v0.1.7 skill: `SKILL.md` instructions, packet reference, licence and notice; not the connector. |
| Use the skill with Codex | [Download the Codex skill v0.1.7](https://github.com/robertkuter/legal-source-connector/releases/download/v0.1.7/sv-legal-source-grounding-v0.1.7-codex.zip) | The portable skill plus Codex display metadata. |
| Run or inspect the connector | [Download the complete v0.1.7 source](https://github.com/robertkuter/legal-source-connector/archive/refs/tags/v0.1.7.zip) | The connector, tests, examples, skill source and documentation; not downloaded Acts. |
| Understand it before downloading | [Continue with the provision-result guide](#four-provision-results-a-lawyer-may-see) | Nothing is downloaded. |
| Find a technical explanation | [Open the rendered documentation guide](docs/README.md) | A guided index, not the long alphabetical folder listing. |

The green **Code** button is another way to download or clone the complete source
repository. It does not install the skill and does not contain downloaded legislation.

The skill-only downloads can inspect packets you supply, but they cannot retrieve a new
provision. That requires the connector and a downloaded source.

Provision packets and complete Acts are later outputs, not installation downloads. The
connector creates a packet for each request and keeps downloaded Acts in the local cache.

## Four provision results a lawyer may see

Before returning confirmed provision text, the connector checks the source map. If the
source-level result is `review_required`, an affected provision request returns `unknown`,
explains why and supplies no confirmed text.

Manual inspection can explain the mismatch, but it does not override the gate. The source
becomes `supported` only after the indexing logic resolves the mismatch and the complete
audit passes.

Riksdagen's consolidated text can show outgoing and incoming versions together. It marks
commencement with `I:` (*ikraftträdande*) and cessation with `U:` (*upphörande*).

| Source situation | Current packet result |
|---|---|
| One provision is found and the source map passes its checks | `found` |
| No exact chapter and section is found | `not_found` |
| Outgoing and incoming versions share the address | `ambiguous`; both remain visible |
| A unique passage carries an unresolved `I:` or `U:` marker | `unknown`; text is withheld |

The connector refuses unresolved timing layers. It does not yet select a version for a
requested date (`as_of` in the code) or reconstruct historic law. You should consider
three questions separately: how old the download is, what Riksdagen's version markers
say, and which rule applies to the facts. See [Timing in a source packet](docs/TEMPORAL-MODEL.md).

## Current alpha scope

The current alpha can:

- retrieve one identified SFS Act through Riksdagen's open-data API and keep the full
  response locally;
- map chaptered, chapterless, lettered and separately numbered source structures;
- return or refuse provision packets after structural and timing checks; and
- create manifests and receipts, compare a saved source with a fresh download, and run
  both no-cache and maintained-profile tests.

The maintained source set will change as the project develops. [Source coverage](docs/COMMERCIAL-LAW-COVERAGE.md)
records Acts with committed tests and known limits, including ABL, CISG and ÅRL. It is
evidence of repeatable testing, not an allowlist.

## What is not included

- legal interpretation, applicability analysis or advice;
- a complete Swedish statute corpus;
- historic amendment-chain reconstruction or automatic date-aware version selection;
- EUR-Lex or other provider adapters;
- a general-purpose search engine, MCP server or hosted service;
- a Word or whole-document review integration;
- cached Acts, private contracts, workbooks or local run receipts.

## See an example without installing anything

Open the [interactive ABL reader](https://robertkuter.github.io/legal-source-connector/examples/abl-primer/)
or start with the [GitHub-readable ABL example](examples/abl-primer/README.md). They show what a
reader-facing claim, its source address and its legal-review boundary look like. After
downloading the repository, open `examples/abl-primer/index.html` in a browser for the full
reader and evidence views. GitHub displays the HTML file as source code rather than as a
webpage. The reader is a static, dated teaching set: it does not run the connector, download
legislation, create packets or receipts, or check the current source. It is not a complete
ABL guide.

## Quick start: run the connector on your computer

These commands run the connector; they do not install the skill. You need
[Node.js 20 or later](https://nodejs.org/en/download), but no npm packages.

Download and unzip the repository, open a terminal in its folder, and run the synthetic
test:

```bash
cd legal-source-connector
node tests/test_synthetic.mjs
```

This uses made-up source material and needs neither the internet nor a source cache.

For one real request, first download ABL through Riksdagen's open-data API—the official
machine-readable route to the document:

```bash
node connector/orient_riksdagen.mjs \
  --source sfs-2005-551
```

Then request one provision from the stored copy:

```bash
node connector/get_provision.mjs \
  --source sfs-2005-551 \
  --locator "13 kap. 6 §"
```

The second command checks the Act's structure and writes a packet and receipt in `runs/`.
If it cannot confirm the structure or timing, it reports the limitation instead of
confirmed text. Replace the SFS identity and citation to audit another Act. See
[Testing](docs/TESTING.md) for the full test path and timing example.

## Why the connector checks each Act

Before returning a provision, the connector compares the chapter-and-section maps in
Riksdagen's HTML and text versions. If they agree, it can use the structure. If they differ,
it reports the problem instead of selecting text that merely looks right. The project calls
this a **capability audit**.

Swedish Acts present different source shapes: chapters or no chapters, lettered provisions,
separately numbered annexes, and outgoing and incoming versions. Lists and cross-references
can also resemble section headings. These differences affect safe retrieval.

The current examples each test a different source shape:

- **Aktiebolagslagen (ABL)** has a large chapter-and-section structure. The connector can
  map it, but its consolidated text also contains future and outgoing versions. The
  connector refuses to choose a marked version automatically.
- **CISG** appears as an annex with its own article numbering. The connector therefore uses
  a separate article index for that annex.
- **Årsredovisningslagen (ÅRL)** contains a cross-reference list that looks like five extra
  section headings in the text version. The HTML and text maps disagree, so the connector
  reports `review_required` and does not present a general provision result as confirmed.

The repository records tests and known limits for these maintained examples. For another
identified Act, the connector downloads the source and runs the same audit. It creates
local packets if the structure passes; otherwise it returns `review_required` or `unknown`
and explains why. We add an Act to the maintained set only with repeatable tests and a
documented source shape.

## What the receipt lets you check

Each download or provision request creates a receipt. It identifies the source and
citation, records the time, checks, and result, and carries the text's digital fingerprint.
A reviewer can trace the answer to the exact downloaded copy.

To check for a later change, the connector downloads the official document again. Matching
fingerprints and version notes mean the stored copy still matches; a difference means it
changed. A failed download or source mismatch returns `unknown`.

This comparison answers a narrow question: has the official text changed since the saved
copy? It does not decide which version governs particular facts or whether a provision is
legally in force for the matter under review.

An assistant should also say whether it used a connector packet, a user-supplied packet, a
direct Riksdagen webpage, or no source. Consistent labels let reviewers compare runs and
keep a webpage visit distinct from a checked packet. See [Wiring and modes](docs/WIRING-AND-MODES.md).

## Source data and attribution

Every output that uses Riksdagen data carries:

> Källa: Sveriges riksdag

Riksdagen provides the source data. It does not produce, endorse, or sponsor this
connector.

The connector retrieves one identified Act at a time. The complete response stays in the
user's local `cache/` folder. The project's
[`.gitignore`](https://github.com/robertkuter/legal-source-connector/blob/main/.gitignore)
tells Git not to add routine caches, run receipts, temporary files or generated ZIPs by
default. This reduces accidental publication; it does not secure those files or replace a
release review.

The public repository contains software, tests and selected examples, not complete Acts
or a bulk statute collection.

The [source and attribution notice](NOTICE.md) records the formal credit and independence
wording. Review it and [Riksdagen's usage terms](https://www.riksdagen.se/sv/dokument-och-lagar/riksdagens-oppna-data/anvandarstod/anvandningsvillkor/)
before redistributing source data or operating a service based on it.

## Where to go next

Choose the route that matches what you want to do:

1. **See the result** — open the [interactive ABL reader](https://robertkuter.github.io/legal-source-connector/examples/abl-primer/)
   or its [GitHub-readable version](examples/abl-primer/README.md).
2. **Run and test it** — follow the [testing guide](docs/TESTING.md).
3. **Understand the code** — use the [plain-English code map](docs/CODE-EXPLAINER.md).
4. **Build on it** — start with the [modular extension roadmap](docs/MODULE-ROADMAP.md).
5. **Look up technical detail** — use the [technical documentation index](docs/README.md).

## License and legal boundary

Copyright 2026 Robert Kuter. Licensed under the [Apache License 2.0](LICENSE). Kuter
Advisory AB is listed only as Robert Kuter's professional affiliation, not as the copyright
owner. See [NOTICE.md](NOTICE.md) for source attribution and non-endorsement.

This project provides source-grounding infrastructure and examples. It is not legal advice.
