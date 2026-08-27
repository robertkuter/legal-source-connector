# Code explainer — Swedish legal-source connector

This is the plain-English map of the executable build. It is kept beside the code so a
future change can update both the behaviour and the explanation.

## The one-minute explanation

The connector does not ask an AI model to remember a statute or search for a plausible
answer. It:

1. obtains the official Riksdagen source;
2. keeps the complete long document separately;
3. checks whether the HTML structure and text structure agree;
4. detects publisher timing markers separately from structural health;
5. builds an addressable index;
6. returns only a safe requested provision with a receipt, or refuses to choose;
7. compares a later source with an earlier pinned receipt when asked about staleness.

The assistant skill is a separate layer. It explains the packet and tells the assistant
when to stop. It does not contain the retrieval code.

For longer reader outputs, the preferred pattern is two-stage: the assistant writes plain-
English claims linked to packet IDs, and deterministic code adds the exact source text and
provenance. This prevents a fluent answer from becoming an unverified source record.

An open API solves access, not trustworthy reuse. Repeatedly calling an endpoint does not
by itself solve long-document boundaries, version identity, caching, reproducibility or
the question “which exact passage did we use?”. Those are the connector's responsibilities.

## Code map

| File | Plain-English job | Lawyer-facing analogy |
|---|---|---|
| `connector/orient_riksdagen.mjs` | Fetches JSON, text and HTML and records the source snapshot | Bringing home the official binder and logging when it arrived |
| `connector/sfs_index.mjs` | Finds statutory headings, compares publisher anchors with text candidates, detects `I:`/`U:` timing markers and records offsets | Building a table of contents, checking it against the publisher's contents page and flagging replacement pages dated for later use |
| `connector/index_sfs.mjs` | Runs the index builder for one cached Act and saves the checked map | Filing the checked table of contents beside the binder |
| `connector/get_provision.mjs` | Resolves one chapter/section address and creates or refuses a packet | Pulling out one cited paragraph with its page trail, but not choosing between dated versions without instructions |
| `connector/compare_source.mjs` | Compares a fresh source with a pinned receipt | Checking whether the book on the shelf changed since the last review |
| `connector/staleness_logic.mjs` | Applies the fixed current, stale or unknown comparison rules | Using the same change-checking checklist every time |
| `connector/cisg_annex_index.mjs` and `connector/get_cisg_article.mjs` | Index and retrieve the CISG translation annex as a separate structure | Using a separate index for an appendix with a different numbering system |
| `connector/audit_html_boundaries.mjs` and `connector/review_source_capability.mjs` | Diagnose whether the publisher's HTML anchors and text candidates agree | Comparing two contents pages and showing the first mismatch for review |
| `connector/source_manifest.mjs` and `connector/build_source_manifest.mjs` | Summarise one cached source, its checked map and representative lookup results without copying the Act | Preparing a cover sheet for the binder rather than duplicating every page |
| `connector/runtime.mjs` | Makes commands work from any current folder and creates output folders | Using a known filing cabinet instead of assuming where the user is standing |
| `connector/text_lines.mjs` | Splits long source text once while preserving offsets | Numbering every line without repeatedly rescanning the whole document |
| `connector/render_grounded_claims.mjs` | Adds exact packet evidence to a model reader draft by packet ID | Attaching the verified page and citation trail to a lawyer's explanation without asking the writer to retype it |
| `examples/abl-primer/build_grounded_artifact.mjs` | Adapts the ABL reader draft and builds the inspectable artifact | Separating the explanatory memo from its source file |
| `tests/test_grounded_claims.mjs` | Rejects unknown packet IDs and checks deterministic evidence enrichment | Checking that every footnote points to a real file and that the copy has not changed |
| `tests/test_synthetic.mjs` | Runs the core parser and receipt logic without a source cache | The portable smoke test a new public checkout can run immediately |
| `tests/*.mjs` | Exercises source profiles, success, ambiguity, missing sections and structural failures | A checklist of things that must continue to work after a change |

## What happens during one lookup

```text
get_provision
  → load the latest cached official source
  → reuse a matching index, or build a new one
  → check capability status
  → normalise the requested address
  → find zero, one or several matches
  → inspect any publisher timing markers
  → return not_found, found, ambiguous or unknown
  → write a JSON receipt
```

The important safety decisions are before extraction. If the source structure is not
supported, the connector returns `unknown` and does not pretend that a text-shaped match is
confirmed. If a unique provision has an unresolved publisher transition marker, it also
returns `unknown`; if outgoing and incoming candidates share a locator, it returns
`ambiguous`. An unmarked provision can remain usable inside a temporally layered Act.

## When is the API called, and what is “memory” here?

These are separate events and should not be blurred together.

### In the current pilot

`get_provision` is cache-backed. It reads the complete Riksdagen snapshot already stored in
`cache/riksdagen/<source-id>/`, reuses or builds the local index, extracts the requested
provision and writes a packet under `runs/`. That lookup does **not** make a live API call.

A Riksdagen API call is made by `orient_riksdagen` when a source is first brought into the
local build, or when a deliberate refresh is run. The response is then stored as a new
timestamped snapshot. A future connector bridge may perform this refresh automatically when
the cache is missing or stale, but that is a deployment decision—not something the skill
does invisibly.

### Three different kinds of memory

| Layer | What it holds | How it is used |
|---|---|---|
| Connector cache | Complete JSON/text/HTML source snapshots and indexes | Persistent local evidence for extraction, hashing, offsets and later comparison |
| Assistant context | The small packet returned for the current question | Lets the assistant explain the retrieved provision and its limits |
| Assistant learned knowledge or long-term memory | General model knowledge, or any separately configured memory feature | Must not be treated as evidence of current statutory wording; a pinned receipt must be supplied explicitly for staleness comparison |

The assistant skill is a rulebook for handling evidence. It is not a hidden database and it
does not install the connector. A source claim is grounded only when the relevant packet or
official retrieval result is visible and its status permits the claim.

For a reader draft, the assistant's English claim is not itself the evidence. The claim's
packet ID is the joining key. The renderer looks up that ID and supplies the exact packet
text, hash, locator and provenance; the validator rejects an unknown ID or a changed hash.

### Why this matters in a demo

Every result should disclose at least:

```text
source_path: connector packet | packet-only | direct official fetch | no source
retrieval_mode: live fetch | cached snapshot | unknown
cache_action: fetched | reused | rebuilt | not used
assistant_memory_used_as_evidence: no
```

This makes it possible to distinguish “the assistant remembered something,” “the connector
read a pinned snapshot,” and “the connector made a fresh official retrieval.”

## What high-volume benchmarking would mean

The current tests check correctness and representative source structures. A later benchmark
would run many lookups across many cached Acts and measure:

- time for a first fetch and index build;
- time for a repeated lookup with index reuse;
- throughput for batches of citations;
- peak memory while holding or indexing a long Act;
- behaviour when sources are missing, stale or structurally unsupported.

That would support an operational statement such as “this batch of 1,000 cached citations
completed in X seconds on this machine.” It would not prove that the legal answers are
correct, that every Act is supported or that a provision applies to a user's facts.

## Why the code holds the whole Act separately

The full Act is needed for hashing, offsets, boundary checks and future staleness comparison.
The assistant normally receives only the targeted provision. This keeps the assistant's
working context small while preserving the ability to re-derive the answer.

The index is a second, separate problem. The API gives us a document representation; it
does not guarantee that every representation exposes safe section boundaries in the same
way. That is why the connector compares HTML anchors with text candidates and can return
`review_required` or `unknown`. An EU source adapter may have a different structural model;
that is a hypothesis to test, not something this Swedish index should assume.

## Current hardening changes

This iteration:

- anchors default cache and receipt paths to the project rather than the current shell folder;
- creates missing receipt directories;
- rejects locators with unexpected trailing text;
- tracks chapter identity in text candidates and compares full locators, not only section numbers;
- reuses an index when its source snapshot, hash and index version match;
- scans line offsets once rather than repeatedly slicing the remaining document;
- adds regression tests for chapter mismatch, index reuse and trailing locator text.
- adds a grounded reader-draft harness so the model supplies explanations and packet IDs
  while code supplies exact source evidence;
- parses Riksdagen provision and heading `I:`/`U:` markers into a separate temporal
  capability and refuses marked passages until date-aware selection exists;
- supports general lettered chapters such as `6 b kap.` rather than only `a` chapters;
- derives capability explanations from the observed mismatch evidence;
- carries Riksdagen attribution and the non-endorsement statement through packets,
  manifests and rendered artifacts.

The SFS index version is now `0.6`. An index version change forces old cached indexes to be
rebuilt instead of silently reusing an index made by different code.

## What the tests prove — and do not prove

The automated tests prove that the current implementation behaves as expected for the cached
source profiles and synthetic failure cases. They do not prove that every Swedish Act has the
same structure, that the source is legally applicable, or that a document's legal explanation
is correct.

## Updating this explainer when code changes

For each meaningful code change, update four things together:

1. the relevant test or fixture;
2. the code map or workflow above;
3. the plain-English reason for the change;
4. the status or release note with the new evidence receipt.

If the code becomes harder to explain, that is a design signal. Prefer a small named helper,
a visible packet field or a focused test over hidden cleverness.

## A lawyer-friendly presentation

> The connector is a careful research assistant for the source layer. It finds the official
> document, checks that its structure is safe to use, retrieves the address you gave it and
> shows its work. It does not decide what the rule means or whether it applies to your facts.

The most useful demonstrations are:

- ABL: one exact provision and its evidence packet;
- ABL: an unmarked provision beside a refused future-only version and an ambiguous
  outgoing/incoming pair;
- CISG: a long appendix that needs a different index;
- ÅRL: a source that is deliberately held for review because plain text creates a boundary risk.
