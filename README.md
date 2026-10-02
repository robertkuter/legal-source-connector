# Swedish legislation source connector

Status: explainability alpha; not production legal software.

**Start here:** [choose the right download or route](#choose-what-you-want-to-do), or
[read the concrete example](#a-concrete-example).

**Why this exists:** An AI assistant can cite Swedish legislation and still give a lawyer
the wrong wording. A reliable answer must connect the requested provision to an identified
Riksdagen source and make clear what the assistant could verify.

Several things can break that link. Riksdagen may publish outgoing and incoming wording
together. Software may mistake references *inside* a provision for the start of new
provisions. A copy saved on your computer may no longer match what Riksdagen publishes.
Our Årsredovisningslagen test found the second problem: the section finder counted five
references inside `7 kap. 7 §` as separate sections, so the connector flagged a mismatch.

**How this helps:** The connector retrieves an identified Act from Riksdagen, checks its
structure, and returns the requested provision with source evidence when it can confirm it.
You can ask it to check Riksdagen again against its local copy. When the connector cannot
confirm a provision, it says why and may show the source text with an **unverified** label.
The companion skill tells an AI assistant how to present that result and its limits.

The connector handles legislation published through Riksdagen. Another authority needs
its own connector and tests. The connector checks source text; it does not decide what
the law means or whether it applies.

**Try the new review flow:**
[Download the current connector source](https://github.com/robertkuter/legal-source-connector/archive/refs/heads/main.zip).
It includes fresh source checks (`--fresh`) and a local page for cases where the connector
can propose a provision's boundaries but cannot confirm them automatically. A person
checks the proposed text and can save a decision for that locator in that saved source. The
[review guide](docs/LOCATOR-REVIEW-GUIDE.md) explains the steps; the
[change summary](CHANGELOG.md) lists the update. The v0.1.7 release downloads below
contain the earlier version.

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

Six pieces keep retrieval, evidence, human review, assistant behaviour, and presentation
separate:

| Piece | Job | What it is not |
|---|---|---|
| **Connector** (`connector/`) | Retrieves one Act, stores it locally, checks its structure, and returns a requested provision. | An AI model or legal-analysis engine. |
| **Provision packet** | Records the result and source evidence for one cited chapter and section. | A conclusion that the provision applies. |
| **Local review page and decision** | Shows why a lookup stopped and, when possible, lets a person check one provision's boundaries and save a decision for that provision in the saved source. | Approval of the whole Act or a decision about legal meaning. |
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
| Run the current connector and local review | [Download the current connector source](https://github.com/robertkuter/legal-source-connector/archive/refs/heads/main.zip) | The connector, review commands, examples, tests and updated skill files. You run the connector with Node.js; this download has no ready-to-install skill ZIP. |
| Add an earlier assistant skill | [Claude or another compatible assistant (v0.1.7)](https://github.com/robertkuter/legal-source-connector/releases/download/v0.1.7/sv-legal-source-grounding-v0.1.7-portable.zip) · [Codex (v0.1.7)](https://github.com/robertkuter/legal-source-connector/releases/download/v0.1.7/sv-legal-source-grounding-v0.1.7-codex.zip) | These skill ZIPs guide an assistant through supplied packets. They do not include the connector or the new review flow. |

The current source download includes the updated skill files in
`skill/sv-legal-source-grounding/`. Ready-to-install skill ZIPs for this update are not
available yet. To reproduce the earlier version, download the
[complete v0.1.7 source](https://github.com/robertkuter/legal-source-connector/archive/refs/tags/v0.1.7.zip).
To understand the results before downloading, read the
[four provision results](#four-provision-results-a-lawyer-may-see) or the
[technical documentation guide](docs/README.md).

The green **Code** button is another way to download or clone the complete source
repository. It does not install the skill and does not contain downloaded legislation.

When you run a review, the connector creates the live page and stores any decision you
save on the machine running it. Downloads do not contain those generated files.

Provision packets and complete Acts are later outputs, not installation downloads. The
connector creates a packet for each request and keeps downloaded Acts in the local cache.

## Four provision results a lawyer may see

Riksdagen provides an Act as HTML and plain text. Before confirming a provision, the
connector compares their chapter and section maps and flags differences in section
identity, order or boundaries. Riksdagen may also publish outgoing and incoming wording
together, marked `U:` (cessation) and `I:` (commencement). The connector treats those
markers as a separate timing question and reports one of four results:

| What happened | Packet result |
|---|---|
| The automatic checks find one provision, or the connector validates a person's decision for one exact locator | `found`; the packet says whether a human decision supported it |
| The checked source has no exact match for the requested address | `not_found` |
| Several plausible passages match the address, such as outgoing and incoming versions | `ambiguous`; the connector shows the candidates without selecting one |
| The connector cannot confirm the source structure or timing, or a fresh source check fails | `unknown`; it may show source wording as unverified when available |

**Where the review page fits:** Some `unknown` results include a proposed provision and
enough boundary evidence for a person to review it. If that person saves a confirming
decision, the connector validates it against the downloaded source and retries the same
locator. That result can become `found` with `basis: human_reviewed_snapshot`; the Act's
automatic `review_required` status and other locators stay as they were. Unresolved
timing and unsupported structures remain explanation-only.

An `unknown` or `ambiguous` packet may also show official wording as an **unverified source
observation**. A lawyer can read it, but the connector has not confirmed that provision.
The connector does not yet select a version for a requested date or reconstruct historic
law. See the
[local review guide](docs/LOCATOR-REVIEW-GUIDE.md) for a worked example and
[timing in a source packet](docs/TEMPORAL-MODEL.md) for the current-law limits.

## Current alpha scope

The current alpha can:

- retrieve one identified SFS Act through Riksdagen's open-data API and keep the full
  response locally;
- map chaptered, chapterless, lettered and separately numbered source structures;
- return or refuse provision packets after structural and timing checks;
- prepare, display, validate and locally store a locator-scoped human decision for a
  `review_required` snapshot without promoting the source; and
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

For the review step, open the [synthetic locator-review page](https://robertkuter.github.io/legal-source-connector/examples/locator-review/)
or read its [GitHub-friendly guide](examples/locator-review/README.md).
After downloading the repository, you can also open `examples/locator-review/index.html` in a browser.
It shows the stop reason, proposed text, boundary evidence and review questions in the
local page's layout. The example uses invented text and disabled controls; it cannot save
a decision. The [local review guide](docs/LOCATOR-REVIEW-GUIDE.md) explains how to run a
real review.

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

The second command checks the stored Act's structure and writes a packet and receipt in
`runs/`. It uses a saved snapshot, so it does not claim a live check. If it cannot
confirm the structure or timing, it explains why. Replace the SFS identity and citation
to try another Act.

When you need wording from the official source now, run a fresh lookup instead:

```bash
node connector/get_provision.mjs --fresh \
  --source sfs-2005-551 \
  --locator "13 kap. 6 §"
```

The connector checks Riksdagen again and reports whether the source changed. If the
check fails, it returns `unknown` instead of calling the saved text current. The same
Node commands work in an AI workspace that can run them; the
[distribution guide](docs/DISTRIBUTION.md) explains that setup and the review-page
fallback. See [Testing](docs/TESTING.md) for the full test path and timing example.

## Why the connector checks each Act

Swedish Acts use different layouts: chapters or no chapters, lettered provisions,
separately numbered annexes, and references that resemble section headings. Outgoing and
incoming wording adds a separate timing question. The connector checks each Act's source
structure rather than assuming that a map that worked for one Act will work for another.
The project calls this structural check a **capability audit**.

The current examples each test a different source shape:

- **Aktiebolagslagen (ABL)** has a large chapter-and-section structure. The connector can
  map it, but its consolidated text also contains future and outgoing versions. The
  connector refuses to choose a marked version automatically.
- **CISG** appears as an annex with its own article numbering. The connector therefore uses
  a separate article index for that annex.
- **Årsredovisningslagen (ÅRL)** contains a cross-reference list that looks like five extra
  section headings in the text version. The HTML and text maps disagree, so the connector
  reports `review_required`. A valid review can confirm one locator; the other locators
  keep their own blocked result.

The repository records tests and known limits for these examples. They are not an
allowlist. Give the connector another exact SFS identity with `--fresh` and it will check
that Act's structure and timing. It returns a provision if it can confirm the locator;
otherwise it explains the blocker. We add an Act to the maintained set only with
repeatable tests and a documented source shape.

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

1. **See the examples** — open the [ABL reader](https://robertkuter.github.io/legal-source-connector/examples/abl-primer/)
   or the [synthetic review page](https://robertkuter.github.io/legal-source-connector/examples/locator-review/).
2. **Run and test it** — follow the [testing guide](docs/TESTING.md).
3. **Review a held provision** — use the [local review guide](docs/LOCATOR-REVIEW-GUIDE.md).
4. **Understand the code** — use the [plain-English code map](docs/CODE-EXPLAINER.md).
5. **Build on it** — start with the [modular extension roadmap](docs/MODULE-ROADMAP.md).
6. **Look up technical detail** — use the [technical documentation index](docs/README.md).

## License and legal boundary

Copyright 2026 Robert Kuter. Licensed under the [Apache License 2.0](LICENSE). Kuter
Advisory AB is listed only as Robert Kuter's professional affiliation, not as the copyright
owner. See [NOTICE.md](NOTICE.md) for source attribution and non-endorsement.

This project provides source-grounding infrastructure and examples. It is not legal advice.
