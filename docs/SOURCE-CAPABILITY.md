# Source capability and completeness gate

ABL is the first demanding test case, not the definition of every Swedish Act. A new
source must pass a structural capability check before the connector treats a provision
as safely retrievable. Structure and timing are separate: an Act can be structurally
addressable while containing outgoing or incoming versions that need date-aware selection.

## Snapshot result and maintained profile are different

The connector does not maintain an allowlist of Acts. It can orient any identified SFS
source that the Riksdagen adapter can retrieve and then evaluate that particular snapshot.
A capability result belongs to the snapshot and locator model; it is not a permanent
endorsement of the Act.

A **maintained source profile** adds committed regression tests, representative locators
and documented limitations. It is useful for release confidence, but it is not a
precondition for local use. An unprofiled snapshot that passes the generic audit may be
used; one that does not pass must remain `review_required`, `unsupported` or `unknown`.

This is enforced in the software, not left to the user's memory. `get_provision.mjs`
builds or rebuilds the index, reads its capability result and withholds confirmed text
unless the structural status is `supported`. `orient_riksdagen.mjs` is only the retrieval
step. `review_source_capability.mjs` is an optional diagnostic that explains a mismatch in
more detail; it is not an extra approval that must be run before every successful lookup.

## Capability states

| State | Meaning | Connector behaviour |
|---|---|---|
| `supported` | For this snapshot, structural markers, text boundaries and integrity checks agree | Return normal provision packets |
| `review_required` | The source is reachable, but a boundary, count or format check is unresolved | Return `unknown` for affected provision requests and expose the reason |
| `unsupported` | No reliable locator or structural representation has been established | Do not claim that a provision was confirmed |

## Temporal capability states

| State | Meaning | Connector behaviour |
|---|---|---|
| `flat` | No supported `I:`/`U:` transition marker was detected | Return structurally valid locators normally |
| `layered_unresolved` | At least one provision or heading carries a publisher transition marker | Return unmarked locators; refuse a unique marked version as `unknown`; keep multiple versions `ambiguous` |

This gate reports source evidence, not legal effect. `I:` (*ikraftträdande*) and `U:`
(*upphörande*) are retained as publisher markers. Packet contract 0.2 does not yet select a
version for an `as_of` date. See [TEMPORAL-MODEL.md](TEMPORAL-MODEL.md).

## Minimum maintained source profile

When an Act is added to the repository's maintained coverage, record:

- provider and source identifier;
- available representations: JSON, text and HTML;
- locator grammar: chaptered, chapterless or another form;
- structural signal, such as paragraph anchors in the HTML;
- expected section and chapter count, where available;
- known special cases: transition material, omitted sections, `a` sections and headings;
- timing-marker counts and whether the source is temporally layered;
- completeness-test receipt and profile version.

## Release gate

The connector should build two independent views:

1. a structural index from publisher markers, preferably paragraph anchors;
2. a text index used to extract the provision, transition markers, offsets and hashes.

The views must agree on locator identity, order, boundaries and source offsets. If they do
not agree, the connector must return `unknown` or `review_required`; a text-only fallback
must not silently present itself as complete.

## Test pattern for an untested Act

When a new Act is requested:

1. fetch and cache the complete official response;
2. run the capability audit;
3. compare structural anchors with text sections and inspect the requested locator;
4. if the snapshot passes, return a normal packet for safe locators;
5. if it does not, return `review_required`, `unsupported` or `unknown` with the reason;
6. only if recurring public coverage is useful, add representative first, middle, last,
   amended, `a`, transition and missing-locator tests as a maintained profile.

This lets a lawyer use the connector beyond the starter pack without pretending that an
unseen formatting variant is safe. Maintained coverage can then expand where repeated use
or a new source shape justifies the regression work.

## Current pilot profiles

| Source | Shape tested | Result | Sections / anchors |
|---|---|---|---:|
| ABL, SFS 2005:551 | Chaptered, long, transition material | `supported`; temporal `layered_unresolved` | 1,025 / 1,025 |
| LAS, SFS 1982:80 | Chapterless | `supported` | 70 / 70 |
| Avtalslagen, SFS 1915:218 | Chaptered, shorter historical Act | `supported` | 41 / 41 |
| Diskrimineringslagen, SFS 2008:567 | Chaptered, compliance-relevant Act | `supported` | 88 / 88 |
| Årsredovisningslagen, SFS 1995:1554 | Cross-reference list resembles section headings | `review_required` | 217 / 222 |

These results show that the same structural pattern works across the current Swedish
pilot set. They do not certify every SFS source; a new formatting variant must still pass
the same gate.
