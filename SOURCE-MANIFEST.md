# Source manifest

The source manifest is a compact description of one official source snapshot and
the health of the local index built from it.

It is intended to make the connector easier to inspect, distribute and extend. A
new user can see which Act was used, which Riksdagen endpoints identify it, when the
snapshot was taken, which consolidation marker the publisher supplied, whether the
section index passed its structural and timing checks, and which sample locators were
tested.

It is metadata about the evidence layer. It is not the source text, a legal opinion,
or a substitute for a provision packet.

## Three different objects

```mermaid
flowchart LR
  A[Official Riksdagen response] --> B[Local complete snapshot]
  B --> C[Deterministic section index]
  C --> D[Provision packet]
  B --> E[Source manifest]
  C --> E
  D --> F[Assistant or lawyer review]
  E --> F
```

- The **complete snapshot** is held locally under `cache/riksdagen/`. It is the
  material from which the index and packets are derived.
- The **index** records the addressable sections, offsets and section hashes. It is
  the working map for deterministic lookup.
- A **provision packet** contains one requested provision and its provenance. It is
  the evidence object used for a specific claim.
- The **source manifest** is the small orientation and health record. It points to
  the official source and records hashes, timing, index status and test outcomes,
  but does not copy the Act or all indexed sections.

The manifest therefore helps explain what is wired without creating a second source
of truth.

## What the fields mean

| Manifest area | Plain-English question it answers |
| --- | --- |
| `authority_id`, `title`, `sfs_number` | Which official Act is this? |
| `official_source` | Where did the source come from? |
| `snapshot` | Which cached version was used, and when was it held? |
| `integrity` | How can the complete source be identified again? |
| `index` | Can this snapshot currently be addressed safely by the generic index? |
| `tested_locators` | Which example addresses were checked, and were any marked, ambiguous or refused? |
| `attribution` | What source credit and non-endorsement statement should travel with the record? |
| `note` | What should a user not infer from the manifest? |

`source_snapshot_at` and `manifest_generated_at` are intentionally separate. Rebuilding
the manifest does not mean that the official source was fetched again. The current
pilot uses `retrieval_mode: cached_snapshot`; a later live retrieval and comparison
belongs to the staleness workflow.

## Build one

From the connector project directory:

```bash
cd legal-source-connector
node connector/build_source_manifest.mjs \
  --source sfs-2005-551 \
  --locator "13 kap. 6 §" \
  --locator "13 kap. 7 §" \
  --locator "4 kap. 47 §"
```

The command writes a JSON manifest under `runs/` by default. Add `--output` when a
stable, reviewable copy is wanted, for example:

```bash
node connector/build_source_manifest.mjs \
  --source sfs-2005-551 \
  --locator "13 kap. 6 §" \
  --output examples/source-manifests/abl-source-manifest.v0.1.json
```

The command reuses the existing cached source and index. It does not make a network
call. The separate orientation and retrieval commands are still responsible for
obtaining a fresh official snapshot.

## How to read a result

- `found` means the sample address produced one unmarked indexed candidate in a source
  whose structural gate passed. Its `temporal` field says whether the Act is flat or the
  locator is merely unmarked within a layered Act. It does not decide what the provision
  means, when it first commenced, or whether it applies.
- `not_found` means the exact address was not present in the indexed snapshot.
- `ambiguous` means more than one structurally plausible candidate exists. The
  manifest keeps candidates and their timing markers visible rather than choosing one.
- `invalid` means the requested locator did not use a supported SFS address form.
- `unknown` means the structural gate did not permit lookup or the unique candidate carries
  a transition marker that the current connector cannot resolve for a date.

These are source and indexing results, not legal conclusions.

## Versioning and publication

`manifest_version` describes the manifest format. `index_version` describes the
parser/index version that produced the health result. They can change independently:

- a new manifest field can be added without changing how sections are indexed;
- an index parser change can alter capability or section counts while the manifest
  format remains stable;
- a new source snapshot changes source hashes and timing even when the code is
  unchanged.

For a public release, a small manifest example is useful documentation. It should be
labelled as a snapshot-derived example, not presented as a promise that every Act is
supported. The curated commercial-law coverage test and each contributor's own source
receipts remain the stronger evidence for what has actually been exercised.

The local coverage test can build the same metadata record across every cached source:

```bash
node tests/test_source_manifest_coverage.mjs
```

That test is intentionally broader than the single ABL example, but it still does not
claim that uncached Swedish legislation has been tested. A public user must orient and
cache a source before running source-profile tests against it.
