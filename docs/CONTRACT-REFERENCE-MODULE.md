# Contract-reference module — next layer

## Purpose

This module would use the source connector to check legal references found in contracts.
It is a consumer of the source packet contract, not a replacement for the connector.

## What works today

The foundation can verify an explicitly supplied citation, for example:

```text
authority: Aktiebolagslag (2005:551)
locator: 13 kap. 6 §
```

It can return a source-grounded result such as `found`, `not_found`, `ambiguous` or
`unknown`, with the provision text, source URL, consolidation marker, hashes, offsets
and retrieval timing.

## What is not built yet

The pilot does not yet reliably extract every legal reference from an arbitrary contract.
That is a separate problem involving:

- recognising Act names, abbreviations and SFS numbers;
- recognising chaptered and chapterless locators;
- distinguishing legal citations from ordinary numbers;
- handling several citations in one sentence;
- identifying whether a reference is Swedish, EU, translated or historical;
- preserving the contract wording and location for human review.

## Proposed incremental build

### Step 1 — explicit-reference check

The user supplies the citation. The module calls the connector and returns the packet.
This is the smallest useful contract use case and should be the first public example.

### Step 2 — candidate extraction

The assistant marks possible references in contract text but does not treat them as
confirmed citations. Each candidate includes:

```text
contract_location
raw_reference
proposed_authority
proposed_locator
confidence_or_review_note
```

The lawyer confirms or edits the candidate before retrieval.

### Step 3 — batch checking

Confirmed candidates are sent to the connector one by one. The output preserves the
mapping between contract location and source packet.

### Step 4 — staleness review

Where the contract review has a pinned source receipt, the module compares a fresh
retrieval against that pin. It reports `current`, `stale` or `unknown`; it never silently
creates a new baseline.

## Example output shape

```text
Contract reference: section 4.2, “13 kap. 6 § ABL”
Source result: found
Source identity: Aktiebolagslag (2005:551), SFS 2005:551
Canonical locator: 13 kap. 6 §
Currency: current against pinned receipt / unverified without a comparison
Evidence: source URL, consolidation marker, section hash and receipt
Boundary: source confirmation only; applicability and interpretation remain open
```

## Acceptance tests

The first module should be tested with:

1. an exact ABL reference;
2. a chapterless reference such as `7 § LAS`;
3. a lettered section such as `3 a §`;
4. a missing or malformed locator;
5. an ambiguous transition reference;
6. a CISG article reference;
7. an Act held at `review_required`;
8. two references in one contract paragraph.

These tests should be separate from the connector's source-structure tests. A passing
source index does not prove that reference extraction or legal citation normalisation is
correct.

## Design rule

The module may propose a citation. Only the source connector can confirm the source
address, and only a lawyer can decide legal applicability or meaning.
