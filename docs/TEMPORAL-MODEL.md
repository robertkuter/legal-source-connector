# Timing in a source packet

**Date:** 2026-08-24
**Status:** Release safety gate implemented; date-aware version selection remains future work.

This note explains the timing information carried in a Riksdagen source, what the
connector can safely do with it now, and what a lawyer should and should not conclude.

## The short version

There are three different timing questions:

1. **Snapshot timing:** when did the connector obtain these source bytes?
2. **Version timing:** does the publisher mark this wording as entering or ceasing on a
   date, and which source version would a date-aware selector choose?
3. **Legal effect:** did that rule govern the transaction, reporting period or dispute?

The connector records the first, detects the publisher evidence needed for the second,
and deliberately does not answer the third. Packet contract 0.2 refuses a marked passage
instead of silently choosing a version. A tested `--as-of` selector is not yet implemented.

## What `I:` and `U:` mean

Riksdagen's consolidated text uses a small inline vocabulary:

| Source marker | Plain-language reading | Connector record |
|---|---|---|
| `Träder i kraft I:2026-12-05` | This displayed version enters into force on that date | `enters_on` |
| `Upphör att gälla U:2026-12-05` | This displayed version ceases on that date | `ceases_on` |
| `Rubriken träder i kraft I:...` | The heading enters into force | `heading_enters_on` |
| `Rubriken upphör att gälla U:...` | The heading ceases | `heading_ceases_on` |

`I:` abbreviates *ikraftträdande* and `U:` abbreviates *upphörande*. The connector keeps
the raw wording as evidence. If a date can be normalized, it also records the ISO date.
If the source says, for example, that commencement occurs on a date the Government will
determine, the marker is `indeterminate`; the connector must not invent a date.

A heading marker applies to the heading. It must not automatically be treated as an
entry-into-force date for every provision below it.

## The cases a lawyer will encounter

| Case | Packet result now | What it means in practice |
|---|---|---|
| Act has no detected timing markers | `found`, `temporal.resolution: not_applicable` | The requested wording is retrievable from this snapshot. No historic start date has been proved. |
| Act is layered, requested provision is unmarked | `found`, `unmarked_locator` | Other parts of the Act have transitions, but this locator does not. The returned wording is snapshot evidence, not a reconstructed legislative history. |
| Outgoing and incoming versions share a locator | `ambiguous`, `multiple_versions_unresolved` | Both candidates stay visible. A lawyer must supply the relevant date; the connector does not choose yet. |
| Only a future or ceasing marked version appears at the locator | `unknown`, `marked_version_unresolved` | The connector can see the passage and marker but will not present it as confirmed without date-aware selection. |
| Marker has no determinable date | `unknown`, `marked_version_unresolved` | The source timing is conditional or indeterminate. Human/source-chain work is required. |
| Only the heading carries a marker | Source reports `layered_unresolved`; an unmarked provision may still be `found` | The heading changed. Do not attribute that date to every underlying rule. |
| Question asks what applied years before the current snapshot | Outside the present connector evidence | The current consolidation does not reconstruct the full amendment chain. Retrieve the relevant historic SFS sources. |
| Snapshot is `current` against a fresh fetch | No conclusion about version timing | “Current” means our stored source matches the publisher, not that every displayed version is operative today. |

The refusal behavior is intentionally conservative. For example, the ABL snapshot has a
single future-marked `7 kap. 68 a §` (`I:2030-01-10`). Earlier code returned it as `found`.
Packet contract 0.2 returns `unknown` and omits the text. For `19 kap. 13 §`, the snapshot
contains outgoing and incoming candidates marked `U:` and `I:` for 2026-12-05, so the
packet returns `ambiguous`.

## How to read the receipt

Timing evidence appears at two levels:

```jsonc
{
  "capability": {
    "status": "supported",
    "temporal": {
      "status": "layered_unresolved",
      "section_marker_count": 28,
      "heading_marker_count": 7,
      "marker_counts": {
        "enters_on": 16,
        "ceases_on": 12,
        "heading_enters_on": 5,
        "heading_ceases_on": 2
      }
    }
  },
  "temporal": {
    "capability_status": "layered_unresolved",
    "resolution": "multiple_versions_unresolved",
    "markers": [
      {
        "kind": "ceases_on",
        "marker_code": "U",
        "target": "provision",
        "raw": "/Upphör att gälla U:2026-12-05/",
        "value": "2026-12-05",
        "date": "2026-12-05",
        "date_status": "dated"
      }
    ]
  }
}
```

- `capability.status` answers whether the source structure is safe to address.
- `capability.temporal.status` answers whether the Act contains unresolved publisher
  timing layers.
- `temporal.resolution` answers what happened at this requested locator.
- `markers` preserve the publisher evidence; they do not make the legal conclusion.
- `source_snapshot_at` says when the source bytes were captured.
- `packet_generated_at` says when the receipt was produced from those bytes.
- `consolidation_signal` is the publisher's amendment ceiling, not a provision-specific
  commencement date.
- `attribution` tells a renderer how to identify Sveriges riksdag and preserve the
  project's non-endorsement statement. It is not part of either source hash.

## What is implemented

- The four supported `I:`/`U:` marker forms are parsed at index time.
- Dated and indeterminate marker values are distinguished.
- Structural and temporal capability are separate dimensions.
- A marked unique provision is refused as `unknown`.
- Multiple versions remain `ambiguous`; candidates retain their markers and offsets.
- Unmarked provisions remain usable even when another part of the Act is layered.
- The source manifest and grounded artifacts carry timing capability and attribution.
- Capability diagnostics describe the first observed mismatch from evidence instead of
  using ÅRL-specific prose for every Act.

## What is not implemented

- No `--as-of` query date or automatic current/outgoing/incoming selection.
- No reconstruction of historic versions from amendment chains.
- No rule for deciding legal applicability to facts.
- No temporal model for CISG or non-SFS providers.

The future selector should record at least the query date, selected version and all visible
alternatives. These must remain separate from a lawyer's applicability analysis. It should
also define what “today” means (date, time zone and source snapshot) rather than relying on
the machine clock implicitly.

## Corpus evidence and corrected findings

The 2026-08-24 scan covered **44 cached `.text` snapshots representing five distinct
Acts**, not 14 distinct sources. Across those snapshots it found:

| Marker kind | Occurrences |
|---|---:|
| provision `I:` | 151 |
| provision `U:` | 108 |
| heading `I:` | 40 |
| heading `U:` | 18 |

ABL (`SFS 2005:551`) has 28 section markers: 12 locator pairs plus four unique
future-marked provisions. Its 1,025 HTML anchors and 1,025 text candidates agree, so its
structural capability is `supported`; its temporal capability is
`layered_unresolved`. The ten locators used by the ABL primer are all unmarked.

Upphovsrättslagen (`SFS 1960:729`), abbreviated here as URL, remains `review_required` in
an exploratory audit outside the maintained source set. Its first mismatch is a pending
`I:` provision; other mismatches include text parsed under `6 a kap.` where the HTML anchors
say `6 b kap.`, plus a separate `53 g §` discrepancy. General lettered chapters are now
parsed, but the Act must pass a complete fresh audit before promotion.

Årsredovisningslag (`SFS 1995:1554`) stays visible as the canonical
`review_required` example. Its cross-reference list exposes a structural limitation that
is different from temporal layering and should not be explained away as a timing case.

## Release position

The public pilot can accurately say that it detects and refuses unresolved timing layers.
It must not say that it answers “what was the law on date D.” That is the next useful
capability, particularly for signing dates, breach dates, closings and reporting periods,
but it needs a separately tested selection contract and, for older dates, additional
official source history.
