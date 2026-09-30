# Reviewed-source workflow

**Status:** Locator-scoped decision, explanation, privacy-safe blocked-case reporting and local save/import/retry handoff implemented in this candidate; source-snapshot review and host-specific integrations remain future work

**Recorded:** 2026-09-04; implementation updated 2026-09-28

## Purpose

The connector currently fails closed when the publisher's HTML structure and the text
parser disagree. That remains the correct automatic behaviour, but it should not prevent
a lawyer from inspecting the source or confirming a specific provision through a
recorded review.

The reviewed-source pathway therefore adds a controlled human-evidence layer. It is not
a `--force` flag and does not turn an automatically mismatched source into an
automatically `supported` source.

The first design cases are:

- Årsredovisningslagen (`SFS 1995:1554`), where five cross-references inside `7 kap. 7 §`
  resemble section headings: 217 HTML anchors versus 222 text candidates; and
- Upphovsrättslagen (`SFS 1960:729`) in the pinned August 2026 snapshot, where 192 HTML
  anchors versus 197 text candidates expose more than one mismatch class, including an
  `I:`-marked provision, a
  `6 a kap.`/`6 b kap.` identity discrepancy and a separate `53 g §` discrepancy.

Using both sources should prevent the implementation from treating the known ÅRL list
pattern as the whole problem.
The `2026-09-01` timing markers in the August snapshot are historical fixture evidence
as of 2026-09-28; fresh-source behavior must be checked separately.

## Core rule

Keep automatic capability and reviewed usability as separate facts:

```text
automatic capability: review_required
review status: valid for an exact snapshot and scope
provision result: found
result basis: human_reviewed_snapshot
```

The packet should preserve the current automatic capability result and add a review
record. A consumer may use the provision because of that review, but it must not report
that the parser and publisher representations agreed automatically.

Human inspection is allowed before confirmation. A mismatch blocks an automatic
`found` result; it should not hide the cached official material from the reviewer.

## One engine, two review scopes

The design retains two eventual scopes through one validation boundary. Version 1.1.0 of
the implemented decision schema is deliberately locator-only; complete-source correction
sets remain outside this milestone and cannot be smuggled into the locator field.

### 1. Locator review

The reviewer confirms one requested provision: its canonical locator, publisher anchor,
start and end boundaries, text, timing markers and neighbouring structure. If validation
passes, only that provision is usable under the review.

This is implemented. It solves the immediate lawyer workflow without
requiring every mismatch in a long Act to be resolved.

### 2. Source-snapshot review

The reviewer classifies every mismatch in one exact snapshot and supplies a complete
correction set. The connector applies the corrections and reruns the full alignment and
integrity checks. Safe provisions in that snapshot may then be returned with a
`human_reviewed_snapshot` basis.

This still does not change the raw automatic status. A later parser correction may cause
a fresh complete audit to pass normally; only then should the snapshot become
automatically `supported`.

## Review actions

The interface should offer structured, auditable actions rather than a general approval
box:

- exclude a text candidate that is demonstrably a cross-reference or other false
  heading;
- map a text candidate to the corresponding publisher anchor;
- correct a locator or chapter identity for this snapshot;
- confirm explicit start and end boundaries for a requested provision; or
- leave the mismatch unresolved.

Each affirmative action needs a recorded basis. For the implemented locator page, the
record contains the exact questions answered **Yes** and any optional reviewer note;
the validator checks the decision's binding to the source, not whether those answers
are persuasive. An unresolved item remains blocked. A chat message such as “looks good”
can prompt the workflow, but is not itself the review record.

## What the review record binds

A valid decision must be bound at least to:

- provider and SFS source identity;
- complete text snapshot hash and HTML snapshot hash;
- connector/index and decision-schema versions;
- review scope: locator or complete source snapshot;
- requested and canonical locator when locator-scoped;
- publisher anchor, source offsets and provision-text hash when a locator is confirmed;
- every mismatch and chosen action required by the selected scope;
- reviewer identity or local reviewer label, review time and rationale; and
- a hash of the completed decision record.

The record lives in the gitignored `reviews/store/` directory by default and is exportable
when the evidence needs to travel with a matter. Source excerpts and reviewer details must
not enter the public repository merely because the connector is public.

## Validation and invalidation

The connector, not the host assistant, validates an imported decision. It should reject
the record if the schema is unsupported, hashes or source identity differ, required
items for the scope are absent, or the corrections create inconsistent or overlapping
boundaries.

Any change to the relevant source representation, locator/index behaviour or parser
version invalidates the review for live use. The old packet and review remain evidence of
what was confirmed for the old snapshot; they are not silently rewritten or carried
forward. A future re-review flow may show a diff and propose prior decisions, but the
reviewer must confirm the new snapshot.

## User surface

The first human-review surface is a connector-generated, self-contained local browser
page. It can be opened from Codex Desktop, Claude Desktop, Claude's Word add-in, a CLI, or a later
contract workbench without implementing the legal review controls separately in each
host.

```text
Codex Desktop ─┐
Claude Desktop ├─> prepare review ─> local browser UI ─> decision JSON ─> validate/apply
Claude + Word ─┘
```

The browser view is deliberately part of the trust design rather than a raw debug dump. It
shows a three-step reviewer journey:

- the source and exact snapshot being reviewed;
- the requested locator and why automatic confirmation stopped;
- the proposed provision in document typography, with its publisher anchor, source offsets,
  neighbouring boundary context and duplicate-looking candidates available for inspection;
- an expandable comparison of what the decision can and cannot do; and
- unanswered-by-default start and stop questions, plus an intervening-lines question only
  when the locator has those lines. Every answer must be **Yes** for a decision; **Cannot
  confirm** creates no new decision. The reviewer label is required and a note is
  optional.

Choose the page by the user's question. A decision-available page for `1 kap. 1 §`
contains detailed evidence for `1 kap. 1 §` only; its source-wide warning does not make
it the explanation page for a discrepancy at `7 kap. 53 g §`. Open the affected locator's
explanation page and local blocked-case record when the question is about that discrepancy.
The explanation page has no approval control. Unsupported cases can share this generic
case format without adding a bespoke review card or making complete-source correction a
prerequisite for reviewing another reproducible locator.
Blocked packets also carry `review_action.source_observation` when source text can be
identified. One provisional candidate is labelled `unverified_text_candidate`; multiple
timing or renumbering candidates are `unselected_text_candidates`. If the connector can
identify only nearby lines, it returns `limited_context`. Each observation carries its
verification issue and is for reading only. The packet remains `unknown` or `ambiguous`,
with no confirmed `text` field or selected dated version. The public case report
continues to exclude source excerpts.

The human-factors rule is **background and intuition before implementation detail**. The
surface should help a lawyer participate in the judgment, not merely ask for a technical
thumbs-up. This follows the broader “understand to participate” framing in Geoffrey Litt's
[Understanding is the new bottleneck](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck),
adapted here for a legal reviewer who is not expected to know HTML or parser design.

The optional anchor explainer teaches three different coordinates before showing the
extraction. It is collapsed by default so the reviewer sees the source identity and
automatic stop reason sooner; the full lesson remains one click away:

- the **publisher anchor**, an invisible HTML bookmark such as `K7P7`, including the exact
  source markup and a plain-language explanation that `K7` means chapter 7 and `P7`
  means section 7;
- the **line number**, a human-readable place in the plain-text representation; and
- the **source offset**, the exact machine boundary in the hashed snapshot.

For ÅRL `7 kap. 7 §`, it then places the true line-2433 candidate beside the heading-like
line-2444 cross-reference and explains why only the former matches publisher anchor
`K7P7`. The reviewer should not have to infer that distinction from candidate numbers.
The automatic-stop card points directly to the yellow-highlighted source lines so the
reviewer can connect the whole-Act count trigger with the local evidence without opening
the longer anchor lesson.
It also connects the whole-Act count to the local evidence: the five intervening
heading-like items (`3 a §`, `4 §`, `5 §`, `6 §` and `7 §`) exactly match the net
217-versus-222 count gap. This is presented as strong context, not as a claim that equal
totals resolve every possible identity or order difference.

The short orientation is now a deterministic presentation model built from the hashed
artifact. It chooses a plain-language evidence pointer for intervening heading-like text,
a reproducible boundary without local intervening candidates, timing-marked alternatives,
renumbering notices or incomplete boundaries. It does not classify the source afresh,
change the artifact, or decide whether confirmation is allowed. New source patterns can
reuse the same page sections and reading component; unknown patterns retain the
unsupported disposition. The ÅRL count explanation appears only when the artifact's
local candidate count actually equals the source's net count difference. Candidate labels
describe observable anchor relationships rather than assuming that every unanchored line
is a cross-reference.

Both ends of the proposed extraction are visible. A boundary chain shows the start anchor
`K7P7` and its line/offset, the excluded standalone heading at the end offset, and the
next anchored provision `K7P8` with its exact publisher markup and matching text
line/offset. This makes “stops before the next provision” inspectable instead of merely
asserted.

An expandable mismatch vocabulary keeps the design open to more than this one anomaly:
coverage/count differences, identity or order differences, duplicate-looking text,
temporal layers and a broken neighbouring-boundary chain. It distinguishes evidence
observed in the current snapshot from fail-closed conditions that prevent a review page
from being prepared. Each signal card follows the same three-part profile—what the
evidence looks like, what it means in plain language and what the connector does—so a
lawyer can learn the system's response without learning its implementation. The first
four cards are populated from the current artifact; the broken-chain card is explicitly
labelled as a hypothetical hard stop and cannot be mistaken for current evidence.

Long hashes and parser details remain visible in expandable evidence panels, but they do
not displace the legal text or scope contract. The page is responsive, printable and has
no remote fonts, scripts, images or analytics. It includes the source attribution and
independent-project disclaimer that a reviewer should see if the repository is cloned.

The main boundary evidence is shown as a paired reading component. The left pane preserves
the numbered snapshot lines from the proposed start through the following anchored
provision, with the start, same-number text candidate, excluded heading and next anchor
marked in place. The right pane reflows the same bounded text into ordinary legal-reading
paragraphs and shows where reading stops. It is explicitly a presentation aid: the source
lines, offsets and hash remain the evidence. This replaces separate start/end snippets so
the reviewer does not have to reconstruct the middle of the provision mentally.

The component accepts zero, one or several bounded candidates. A decision page shows the
single proposed boundary. Explanation-only temporal and renumbering pages repeat the same
component for each publisher-backed candidate and label all of them as unselected. A
text candidate in a source with a failed map can be read up to the following text
heading or the end of the available source, with that provisional boundary labelled;
multiple marked candidates remain
separate and unselected. An unsupported pattern with no reproducible candidate falls
back to the smaller context excerpt. This keeps the visual model reusable without
pretending every blocker is a structural decision.

The preparation result returns the artifact hash as a stable review identifier, the
automatic capability summary and an open target. A
host may present that as an “Open review” control. In Word, it can sit beside the disputed
citation or finding; the full review UI need not be built into the add-in.

The current slice supports both the self-contained local HTML bundle and a minimal local
viewer for products that cannot open `file://` links. The viewer binds to
`127.0.0.1` on an ephemeral port, serves one in-memory HTML file at an unguessable
192-bit token route, returns `no-store` and restrictive browser security headers, and
does not expose the artifact or decision-template JSON. In source-and-locator mode, the
same token permits one JSON decision POST from the local page. The request is bounded,
same-origin and validated by the existing importer against the current cached snapshot;
the connector then retries only the requested locator and closes the viewer after a
successful import. The file-only viewer keeps its read-only behavior. Opening the URL
remains a host action; the connector does not launch a browser or send the source to an
internet service.

For `decision_available`, the loopback page offers **Save review locally** as the routine
return path. It calls the same importer and shows the retry status. The page can also
export a structured decision file; a separate connector operation imports and validates
that file. This keeps the evidence independent of chat history and avoids a permanently
running review service.

The connector now distinguishes three host-visible dispositions before the page is
prepared:

- `decision_available`: one exact publisher anchor and both local boundaries are
  reproducible, so locator confirmation controls may be shown;
- `explanation_only`: the evidence can be explained, but it requires a different
  capability such as date-aware selection or explicit treatment of an editorial
  renumbering notice; and
- `unsupported_pattern`: the source shape is incomplete or outside the tested signal
  vocabulary, so the page explains the safe stop and exposes no decision route.

All three use review-signal vocabulary 1.0.0. The closed initial kinds are coverage and
identity/order differences, text-only and missing-text candidates, temporal layers,
duplicate publisher identities, editorial renumbering notices, broken boundaries and an
unclassified fallback. An unclassified signal is a blocking result, not permission for a
free-form decision.

The normal provision packet now includes a machine-readable `review_action` when a
blocked locator has a review or explanation surface. It gives the host the disposition,
reason codes, signal kinds and exact source/locator input. The host still needs a thin
launch/completion adapter; the current page downloads a portable record and the existing
import command performs connector-side validation.

## Blocked-case reporting

An `explanation_only` or `unsupported_pattern` lookup now produces a separate, versioned
case report. This is a development handoff, not a review decision: it cannot release a
locator, alter capability status or select a temporal version.

The public issue draft is constructed from a strict allowlist. It contains the public SFS
identity, requested and canonical locator, source snapshot time, official source links,
disposition, reason and signal codes, structural counts, connector versions and a
reproduction command. It excludes source excerpts, source and artifact hashes, cached
filenames, local paths, matter context, prompts, reviewer labels and rationales.

Two identifiers keep recurring use legible:

- `case_id` is stable for the same provider, source, locator and classified blocker, so
  repeated encounters can be deduplicated; and
- `occurrence_id` changes with the source snapshot hashes or relevant implementation
  versions, so a genuinely different occurrence is retained without publishing those
  hashes.

The normal lookup and review-preparation command record these cases under gitignored
`reviews/cases/`. Repeating the same occurrence updates `last_seen_at` but does not inflate
the occurrence count. A changed snapshot or implementation is another occurrence under
the same case when the classified pattern is unchanged.

The local explanation page offers four explicit actions: copy the exact safe GitHub draft,
download the safe JSON report, download the full private evidence artifact, or open an
empty GitHub issue page. Nothing is uploaded or submitted automatically. The page warns
that the private artifact contains source excerpts and is not the public attachment.

Known limitations and unknown structures use different language:

- `explanation_only` becomes a `capability_need`, such as date-aware selection or tested
  renumbering treatment; and
- `unsupported_pattern` becomes an `unsupported_source_pattern`.

Decision-available locator reviews do not create development cases. Their existing review,
import and validation route is the appropriate handoff.

## Host-neutral lifecycle

```text
lookup returns review_required
  → host offers Open review
  → connector prepares immutable review bundle
  → reviewer inspects and records structured decisions
  → connector validates decision against snapshot and scope
  → lookup is retried
  → packet returns found with human_reviewed_snapshot basis
```

If the decision is incomplete, invalid or stale, the lookup remains `unknown` or
`review_required`. Consumers should display the distinction between automatic support,
reviewed use and unresolved material.

## Implemented locator flow

The implementation uses built-in Node.js facilities and separately hashed or validated
review, decision, store and case-report objects:

1. `prepare_locator_review.mjs` reproduces automatic `review_required`, resolves one exact
   publisher anchor and a bounded text passage, and writes an immutable artifact, an
   incomplete decision template and a self-contained `review.html` under gitignored
   `reviews/prepared/`.
2. The browser page shows the source identity and automatic stop reason first. An
   expandable lesson explains how exact publisher markup, anchor identity, text line and
   offsets relate. The page then displays the exact locator, provision text and
   neighbouring boundary. It creates a completed decision only after the reviewer answers
   each relevant boundary question **Yes** and supplies a label. The page records the
   questions and an optional note as the rationale. A local save
   calls the validator and retries the locator; the portable download remains available.
3. `import_review_decision.mjs` validates the completed decision against
   `schemas/locator-review-decision.v1.1.schema.json` semantics and the current cached source,
   then writes a store record under gitignored `reviews/store/`.
4. `get_provision.mjs` revalidates a matching stored record on every lookup. Only the
   exact canonical locator can return `found` with `basis: human_reviewed_snapshot`;
   `capability.status` remains the automatic `review_required` result.
5. When retrieval remains blocked under `explanation_only` or `unsupported_pattern`, the
   connector writes or deduplicates a privacy-safe case in `reviews/cases/`. The case can
   be copied into GitHub only after the user inspects it; the full local artifact remains
   separate.

```bash
node connector/serve_locator_review.mjs \
  --source sfs-1995-1554 \
  --locator "7 kap. 7 §"
```

The command prints a tokenized `127.0.0.1` URL. Open it in a local browser, inspect the
evidence and use **Save review locally**. The command prints a `completed` result with
the import status and retried provision packet, then exits. Copy the full `url` value
from its `status: serving` output; `localhost` without the token path is not the page.
The immediate retry uses the pinned local snapshot and now identifies the separate fresh
command in its result. A rejected decision leaves
the page open and the locator blocked. An `explanation_only` or `unsupported_pattern`
page offers reporting controls but no save action; stop its viewer with Ctrl-C.
When the question is about current wording, the host should run
`get_provision.mjs --fresh` again after the local save and use that final packet. The
review page and its immediate retry are snapshot-bound; a fresh recheck detects a source
change during the review and prevents an old decision from being reported as current.

If a host cannot run the command, or a browser cannot reach the loopback URL, use the
existing file and JSON route from a terminal in this directory:

```bash
node connector/prepare_locator_review.mjs \
  --source sfs-1995-1554 \
  --locator "7 kap. 7 §"

# Open reviews/prepared/sfs-1995-1554--7-kap-7/review.html locally.
# Download the completed decision JSON from that page, then:

node connector/import_review_decision.mjs \
  --artifact reviews/prepared/sfs-1995-1554--7-kap-7/review-artifact.json \
  --decision /path/to/completed-review-decision.json

node connector/get_provision.mjs \
  --source sfs-1995-1554 \
  --locator "7 kap. 7 §"

node connector/list_review_cases.mjs
```

All three AI surfaces use this same handoff. Codex Desktop can run the local command in
its project environment and open the printed URL; local execution and browser access
remain subject to the user's app permissions. Claude Desktop can do so when its current
mode or installed local tool provides command access. A chat without local tools can
present the exact command and receive the result after the reviewer runs it. Claude for
Word can identify the disputed citation and present the same command/URL and returned
packet, but this repository has no Word add-in command bridge. A reviewer runs the local
command outside Word and brings the validated result back; Word must not treat its chat
response or a downloaded JSON file as an imported decision. No host needs its own review
controls or source-wide approval path.

The schema and validator bind provider, authority and SFS identity; text and HTML snapshot
hashes; snapshot filename; connector-review, index, artifact and decision-schema versions;
locator scope; requested and canonical locator; publisher anchor; UTF-16 source offsets;
provision-text hash; unresolved temporal state; reviewer label, review time and rationale;
artifact hash; and decision-record hash. Missing fields, unknown fields, unresolved
decisions, source-wide scope, changed sources or versions, inconsistent boundaries and
marked temporal passages are rejected.

## Remaining sequence

1. Exercise the local HTML and blocked-case reporting bundle with real reviewers. Confirm
   that the public draft is understandable and that the private/public evidence boundary
   is obvious before mirroring it into a public release.
2. Add source-snapshot correction sets and complete realignment as a separately versioned
   milestone.
3. Exercise the shared launch/result command from Codex Desktop and Claude Desktop, and
   the manual Word handoff, before deciding whether any host-specific bridge is justified.

The synthetic and cached-source acceptance tests prove that a valid locator review releases
only its locator, an unresolved mismatch releases nothing, changed hashes invalidate the
review, the automatic capability remains visible, and no host-specific chat state is
required to reuse the decision. The cached suite also proves that Skadeståndslagen
`3 kap. 5 §` renders two `I:/U:` versions as explanation-only and Konkurrenslagen
`4 kap. 16 a §` renders its duplicate publisher identity and “Ny beteckning” notice as
explanation-only. Neither surface contains confirmation or decision-download controls;
their separate case-report and private-evidence downloads cannot release a locator.
