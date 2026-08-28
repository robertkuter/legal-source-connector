# Swedish commercial-law coverage pack

## Purpose

This is a curated first-principles test set for a practical Swedish commercial-law
starter pack. It is not a claim about the statistically most-used Acts and it is not a
complete Swedish legislation corpus.

The purpose is to test whether the source connector can safely retrieve, index and
package legislation that commercial lawyers commonly encounter across contracts,
companies, employment, disputes, competition and accounting.

The Swedish source remains the foundation. English translations are a later bridge and
are deliberately outside this first coverage pass.

## Tested coverage, not permitted coverage

This table is evidence of repeatable project testing, not an allowlist enforced by the
connector. A user may identify and orient another Riksdagen SFS source, run the same
capability audit and use provision packets from a snapshot that passes. If the audit finds
an unresolved structure or timing layer, the connector should expose that limitation and
refuse a false confirmation.

In this document, **validated** means that the repository maintains a known snapshot
profile, representative locator cases and regression tests. It does not mean that unlisted
Acts are prohibited, nor that every future snapshot of a listed Act is automatically safe.
ÅRL remains visible as the contrary example: the source is reachable, but its present
structural mismatch keeps generic provision retrieval at `review_required`.

## Coverage status

| Area | Act | Authority ID | Status | What it adds to the test set |
|---|---|---|---|---|
| Companies | Aktiebolagslag (2005:551) | `sfs-2005-551` | **validated** | Long chaptered Act; 1,025/1,025 structural checks; boundary and ambiguity tests |
| Contracts | Lag om avtal och andra rättshandlingar på förmögenhetsrättens område (1915:218) | `sfs-1915-218` | **validated** | Older chaptered Act; 41/41 structural checks; exact `1 kap. 1 §` test |
| Employment | Lag (1982:80) om anställningsskydd | `sfs-1982-80` | **validated** | Chapterless Act; 70/70 structural checks; exact `7 §` test |
| Equality / compliance | Diskrimineringslag (2008:567) | `sfs-2008-567` | **validated** | Modern compliance Act; 88/88 structural checks; exact `2 kap. 3 §` test |
| Sales | Köplag (1990:931) | `sfs-1990-931` | **validated for current locator model** | Chapterless commercial Act; 82/82 structural checks; first, middle, final and missing-locator tests |
| International sales | Lag (1987:822) om internationella köp | `sfs-1987-822` | **validated as a two-layer source** | 2/2 statutory sections plus separate 101-article annex index; statutory scope signal preserved |
| Disputes | Lag (1999:116) om skiljeförfarande | `sfs-1999-116` | **validated for current locator model** | 64/64 structural checks; lettered-section, transition-boundary and missing-locator tests |
| Agency | Lag (1991:351) om handelsagentur | `sfs-1991-351` | **validated for current locator model** | 36/36 structural checks; first, middle, final and missing-locator tests |
| Interest | Räntelag (1975:635) | `sfs-1975-635` | **validated for current locator model** | 13/13 structural checks; chapterless lettered sections and transition-bearing final section |
| Tort | Skadeståndslag (1972:207) | `sfs-1972-207` | **validated with ambiguity boundary** | 39/39 structural checks; chaptered and lettered sections; duplicate transition locator reported, not selected |
| Labour relations | Lag (1976:580) om medbestämmande i arbetslivet | `sfs-1976-580` | **validated for current locator model** | 83/83 structural checks; chapterless lettered sections and transition-bearing final section |
| Marketing | Marknadsföringslag (2008:486) | `sfs-2008-486` | **validated for current locator model** | 79/79 structural checks; lettered sections, long provision and transition-bearing final section |
| Competition | Konkurrenslag (2008:579) | `sfs-2008-579` | **validated with ambiguity boundary** | 151/151 structural checks; chaptered/lettered sections, long final provision and duplicate transition locator |
| Bookkeeping | Bokföringslag (1999:1078) | `sfs-1999-1078` | **validated for current locator model** | 66/66 structural checks; chaptered lettered sections and long final chapter |
| Annual accounts | Årsredovisningslag (1995:1554) | `sfs-1995-1554` | **review_required** | 217 HTML anchors versus 222 text candidates; cross-reference list is mistaken for five sections |

The thirteen validated Act profiles are the current maintained regression base for the
present locator model. Other Acts may be audited and used locally without first entering
this list. The international-sales entry is a two-layer source: the Swedish
Act's `1 §`/`2 §` layer and a separate annex/article layer. The article layer resolves
Articles 1–101 from standalone text headings, records the partial HTML heading cross-check,
and preserves the Act's own signal that Articles 1–88 and 100 are the articles named in
`1 §`. This is source confirmation, not a conclusion about CISG applicability to a contract.

## Latest commercial audit

The commercial sources were fetched from the official Riksdagen endpoints on 2026-08-19
and stored as complete local snapshots, excluded from Git by default. Ten of the eleven
extension sources pass the current capability gate; Årsredovisningslag is retained as an explicit
`review_required` case. The reproducible local test suite passed 106/106 checks:

```bash
node tests/test_commercial_coverage.mjs
```

Receipt: `runs/commercial-coverage-2026-08-19T12-53-15-932Z.json`.

The suite includes lettered locators (`2 a §`, `4 a §`, `27 a §`, `2 kap. 3 a §`) and
transition-bearing final provisions. It checks that Skadeståndslag's duplicate
`3 kap. 5 §` and Konkurrenslag's duplicate `4 kap. 16 a §` are reported as ambiguous
without selection. It also records Årsredovisningslag's cross-reference-list mismatch
without producing a misleading index.

The audit found one intentional boundary for follow-up in Årsredovisningslag: five
section-shaped lines inside a cross-reference list are rejected as a source-capability
mismatch. The review packet records the exact lines and offsets. The CISG annex boundary
is now handled by a separate article index and its own test suite.

The CISG article suite passed 18/18 checks:

```bash
node tests/test_cisg_annex.mjs
node connector/get_cisg_article.mjs --article "Artikel 1"
```

Receipt: `runs/cisg-annex-tests-2026-08-19T12-53-15-932Z.json`.

The article index is deliberately separate from the statutory index because the publisher
HTML exposes only 48 article heading anchors while the text contains 101 standalone
article headings. The HTML result is retained as a diagnostic cross-check, not silently
treated as a complete article index.

Årsredovisningslag review packet:
`runs/capability-review-sfs-1995-1554-2026-08-19T12-49-39-875Z.json`.

## Minimum test for a new Act

An Act can move from `queued` to `validated` only after a source profile and receipt have
been produced. The minimum test is:

1. Retrieve the official consolidated Riksdagen source.
2. Store the complete source locally and record the snapshot time and consolidation marker.
3. Compare the publisher's structural anchors with text-section candidates.
4. Test at least three representative locators, including a boundary-sensitive locator.
5. Test one missing locator.
6. Report any ambiguous transition or duplicate locator rather than selecting automatically.
7. Verify section hashes and increasing offsets.
8. Add a small private or synthetic contract-reference fixture where appropriate.
9. Record the result as `supported`, `review_required` or `unsupported`.

The exact number of test locators can increase for a long or irregular Act. The aim is
not to claim that three examples prove every provision. The aim is to establish that the
source representation and connector behavior are understood well enough to use the Act
as a validated profile.

## First-principles rationale

The model is not asked to remember Swedish commercial law and present its learned text as
current. The build creates an evidence path:

```text
official source → complete snapshot → structural index → exact locator
→ small evidence packet → assistant explanation → separate legal analysis
```

The code handles retrieval, structure, hashes, offsets and comparison. The skill handles
the plain-English evidence workflow. The tests expose where either layer is uncertain.

This is why the commercial set is useful: it broadens the tested source shapes and
professional use cases without pretending that the entire corpus has been validated.

## Later English bridge

English translations should be added only as a separate source layer. A future bilingual
profile must identify the translation source, date/version, status, section mapping and
separate translation hash. The Swedish SFS text remains the authoritative source when
the two texts differ.

## Public wording

Recommended public wording:

> The project includes a Swedish commercial-law starter pack with thirteen validated Act
> profiles and one Act held for structural review. These profiles are tested examples, not
> an allowlist: other identified SFS sources can be audited on demand. The connector reports
> uncertainty, preserves source evidence and uses separate index families where a publisher
> document contains more than one legal-text structure.
