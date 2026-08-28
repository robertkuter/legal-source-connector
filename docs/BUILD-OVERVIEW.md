# Build overview

## Target

Build a small, inspectable source-grounding module that contract and compliance skills
can consume. The first useful result is not a legal answer. It is a reproducible source
packet:

```text
authority identity
  + complete retrieved source
  + provision address
  + version/currency signal
  + content hash
  + run receipt
```

## The reusable building-block pattern

This project is one implementation of a broader pattern:

```text
identify authoritative source
  → retrieve and preserve the complete representation
  → test whether its structure is safely addressable
  → return a small evidence packet
  → let a higher-level skill use the packet without hiding uncertainty
```

The Swedish SFS connector supplies the first concrete case. A contract-review module could
consume its packets to check citations. A compliance module could consume them to monitor
authorities. The shared pattern is the source/evidence boundary; the provider-specific parser
and legal or commercial meaning stay separate. Other data domains remain outside this public
pilot's scope.

## Readable build sequence

### Stage 0 — understand the source

- map the Riksdagen API;
- fetch a short and long statute;
- compare JSON, text and HTML responses;
- explain the source hierarchy in plain English.

### Stage 1 — retrieve and hold

- fetch the complete document;
- save it outside the agent context;
- calculate a content hash;
- preserve retrieval metadata;
- make a receipt.

### Stage 2 — address a provision

- recognise Swedish chapter and section headings;
- create offsets into the cached document;
- return one requested provision;
- fail visibly when addressing is not found or is ambiguous.

The first implementation is intentionally narrow: it supports locators of the form
`13 kap. 6 §` and, for chapterless Acts such as LAS, `7 §`. It uses the complete cached
SFS text. It is a structure index, not a semantic legal search engine. Offsets point
into the cached `document.text` snapshot; the receipt states the offset unit explicitly.

The parser also has to reject false headings inside running text and stop before a
standalone subheading immediately preceding the next section. The initial guardrails are
deliberately visible: a section heading must begin after a blank line, plural references
such as `19 §§` are excluded, and a single locator is not selected when the index finds
multiple plausible passages. These are testable rules, not hidden model judgment.

### Stage 3 — compare currency

- read the consolidation marker;
- compare a pinned receipt with a later retrieval;
- return `current`, `stale` or `unknown`;
- never silently update the pin.

The first comparison command treats the complete consolidated text hash as the primary
test. It also compares the publisher's “t.o.m. SFS ...” marker after removing the
presentation-only `Ändrad:` prefix used by the text endpoint. A changed marker or changed
complete-source hash is reported as `stale`; a failed retrieval is `unknown`.

### Stage 4 — consume from skills

- contract citation check;
- compliance authority check;
- lawyer-readable explanation;
- optional MCP interface only after the source contract is stable.

The compact index is the navigation layer for these consumers. It lets a higher-level
workflow locate a provision in the separately held source snapshot without placing the whole
Act in the assistant's context. See [INDEX-AND-REFERENCE-MODEL.md](INDEX-AND-REFERENCE-MODEL.md)
for the current boundary and the future graph-ready direction.

## Code, skill and explanation

| Layer | Owns | Does not own |
|---|---|---|
| Code | HTTP, caching, hashes, parsing, locators and receipts | Legal interpretation or advice |
| Skill | Workflow, judgment, uncertainty and escalation | HTTP, silent repairs or hidden source changes |
| Plain English | Concepts, maps, examples and teach-back questions | Duplicated parsing logic |

The maintained code-to-lawyer map is [CODE-EXPLAINER.md](CODE-EXPLAINER.md). The
[EXPLAINABILITY-LEDGER.md](EXPLAINABILITY-LEDGER.md) records how meaningful changes become
tests, plain-English explanations and possible presentation material. Update these when
the executable flow, source boundary or user-facing result changes.

## Release control

Before publishing a change, run the relevant tests and confirm that this overview and the
code map still describe the build. Keep local run receipts as working evidence, but do not
include them in the public package. The API map explains what the source provides; a receipt
records what happened in one run.
