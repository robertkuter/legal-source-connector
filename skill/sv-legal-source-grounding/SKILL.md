---
name: sv-legal-source-grounding
description: Verify Swedish statutory references against a pinned official Riksdagen source, retrieve an exact SFS provision, report currency and evidence, and explain uncertainty. Use for contract citation checks, compliance authority checks, legislation-reference staleness, or requests to confirm Swedish chapter/section text. Do not use as a substitute for legal interpretation or applicability analysis.
metadata:
  skill_version: "0.1.8-rc.1"
  packet_contract: "0.2"
---

# Swedish legal-source grounding

Use the source connector before making a claim about the text or currency of a Swedish
statute. Treat the connector as an evidence layer: it identifies the authority, holds the
complete source separately, addresses the requested provision, and returns a small packet
with provenance.

## Operating modes and wiring disclosure

The base skill is a source-grounding skill. It is not, by itself, a document-review agent.
Keep these modes separate:

- **Strict source mode** checks an explicitly supplied authority and locator, then reports
  the packet status, text and evidence. It does not rewrite a document or decide whether a
  provision applies.
- **Review-assist mode** is an additional consumer workflow. It may extract candidate legal
  claims from a document, compare them with source packets and propose human-reviewable
  findings or edits. It requires its own review module and tests.

Before reporting a source-grounded result, disclose the wiring that produced it:

```text
mode: strict source | review-assist
source_path: connector packet | packet-only | direct official fetch | no source
connector_receipt: [actual run receipt identifier if supplied, otherwise not supplied]
capability_audit: [status when available]
edit_status: none | proposed only | applied with user instruction
```

Do not silently fall back from a connector or packet to a free-text search. A direct fetch
from the official publisher may be useful in an exploratory workflow, but it is not a
connector packet and must be labelled as a direct fetch. If strict source mode has neither
an available connector nor a source packet, return `unknown` rather than reproducing the
statutory text from memory.
The packet's `source_snapshot` filename identifies pinned source bytes; it is not the
connector run receipt. For a packet-only handoff without `run_receipt`, say the run receipt
was not supplied and name the source snapshot separately.

If a user asks for a whole-document review while only the base skill is available, explain
that citation checking is possible only for supplied references or packets. Any broader
claim comparison is an extension and must label findings as ungrounded until each finding
has source evidence.

## Grounded explanation consumer contract

When a consumer workflow asks for a readable explanation from a packet set, keep the
model-produced reader layer separate from the evidence layer. Each source-based claim
should carry one or more packet IDs. If a claim cannot be supported by the supplied
packets, mark it `ungrounded` rather than attaching a nearby provision.

The reader language is a presentation choice. A consumer may request plain English or
plain Swedish (or another explicitly supported language), but the source packet remains
in the publisher's original language. Never silently translate a source quotation while
calling it verbatim.

Where deterministic rendering is available, do not ask the model to reproduce packet
text, hashes, offsets or provenance as the authoritative copy. The renderer should look
up the packet IDs, copy the exact packet text, verify the section hash and add the source
metadata. This prevents a fluent explanation from silently becoming a new or altered
source record.

## Workflow

1. Identify the authority and SFS number. Do not infer an SFS number from a vague name
   without reporting the uncertainty.
2. Normalize the requested address. Use `13 kap. 6 §` for chaptered Acts and `7 §` for
   chapterless Acts such as LAS.
3. Call `get_provision(authority_id, locator)` through the available source tool. When
   the user asks for current wording and the local connector can reach Riksdagen, use
   the connector's fresh mode:

   ```bash
   node connector/get_provision.mjs --fresh --source sfs-2005-551 --locator "13 kap. 6 §"
   ```

   For deliberate replay of a pinned local snapshot, omit `--fresh`:

   ```bash
   node connector/get_provision.mjs --source sfs-2005-551 --locator "13 kap. 6 §"
   ```

   A fresh fetch failure returns `unknown`; do not relabel a cached packet as current.

4. Read the returned status before using the text:
   - `found`: use the text, source URL, currency signal, hashes and receipt;
   - `not_found`: do not invent or approximate the passage;
   - `ambiguous`: show every available candidate under
     `review_action.source_observation.candidates`, with its verification issue and
     timing marker. Do not select an outgoing or incoming version from today's date or
     memory;
   - `unknown`: explain that the official source or its structural capability could not
     be confirmed. If `review_action.source_observation` is present, show its candidate
     excerpt(s) or limited context as readable **source observations**, stating the
     verification issue and provisional boundary. A uniquely matched provision carrying
     an unresolved `I:` or `U:` marker is also `unknown`; its text may be readable, but
     no dated version has been selected. Do not treat a reachable but structurally
     untested or temporally unresolved passage as supported.
   - `found` with `basis: human_reviewed_snapshot`: state that one exact locator was
     released by a validated human decision. Keep the automatic `review_required`
     capability visible; do not describe the whole Act as structurally supported.
   If `review_action.operation` is `prepare_locator_review`, offer the same local page
   route for `decision_available`, `explanation_only` and `unsupported_pattern`. Only
   `decision_available` has a save control. When the host can run local commands, run
   `node connector/serve_locator_review.mjs --source <SFS ID> --locator <locator>`
   from the connector directory. Copy the complete `url` value from its `status: serving`
   output exactly, including `127.0.0.1`, the token path and `?save=1` when present.
   Do not construct a `localhost` link or guess a port. If the serving output was not
   captured, obtain it before giving the reviewer a link. A completed local save
   validates/imports the decision and retries that locator against the pinned snapshot.
   Read its `status: completed` result. If the user requested current wording or a fresh
   check, run `get_provision.mjs --fresh` after the save and use that final packet;
   report the `source_check` result. Do not present the server's cached retry as the
   requested fresh check. A changed source will invalidate the earlier review. If local
   command or file access is unavailable, give the reviewer that command to run locally;
   the HTML page's JSON download can be imported with `connector/import_review_decision.mjs`, followed
   by `connector/get_provision.mjs`. Do not treat a chat approval as a decision record.
   When explaining a saved review, keep record validity separate from the reviewer's
   understanding: import validates the locator, source bytes and decision record. The
   local page records the reviewer's Yes answers to the relevant start, inside-text and
   stop-boundary questions, with an optional note. A cross-reference list with
   heading-like lines can explain the text candidate mismatch. Report what the recorded
   answers cover and any material limitation visible in the packet; do not grade the
   reviewer's wording, call that cross-reference observation wrong, or substitute the
   model's opinion for the recorded human decision.
5. For a staleness question about an older pinned receipt, use the explicit comparison
   command and report whether the receipt supplied both text and HTML hashes or text
   alone. `--fresh` compares the live embedded
   source and direct response text/HTML hashes with the latest local snapshot; unchanged
   bytes keep that snapshot, while changed bytes create a new one. Do not silently replace
   the older receipt or carry a review to changed bytes.
6. Separate three statements: what the official source returned, whether the pinned
   source changed, and what the provision may mean or require. Only the first two belong
   to this skill.

## Response shape

Explain the result in this order:

1. **Source found** — title, SFS number, requested address and status.
2. **Text shown** — for `found`, quote the confirmed targeted provision or a short
   relevant excerpt. For `unknown` or `ambiguous`, display available
   `review_action.source_observation` text separately as unverified or unselected source
   material, with its verification issue. Never move that excerpt into the packet's
   confirmed `text` field or call it the applicable provision.
   State whether the presentation is verbatim, line-ending-normalized or summarized.
   For a verbatim presentation, use a fenced text block and preserve numbering, list
   markers, punctuation and blank-line structure from the packet. Do not label a
   reformatted or shortened passage as verbatim text. A statement that text was returned
   is not a substitute for displaying the actual text block. If line endings are changed,
   label the display line-ending-normalized; if trailing blank lines or other characters
   are omitted, call it a trimmed excerpt. A hash of the stored excerpt does not verify
   those presentation changes.
3. **Timing** — distinguish snapshot freshness from provision timing. Explain
   `temporal.capability_status`, `temporal.resolution` and any raw `I:`/`U:` marker.
   Do not turn a publisher marker into an applicability conclusion.
4. **Currency** — state the consolidation marker, retrieval mode, fresh-check time when
   present, and whether the source was unchanged, changed, first seen or unverified.
5. **Evidence** — link to the official source and name the source snapshot time, packet
   generation time, content hash and receipt when those fields are present.
6. **Boundary** — say that applicability, legal effect and drafting advice require a
   separate legal analysis.

Use plain language for lawyers. For example: “The connector found the provision in the
official consolidated SFS text retrieved at [time]. It is current against the pinned
receipt up to [marker]. This confirms the source text; it does not decide whether the
provision applies to this contract.”

## Final response integrity check

Before sending a response for a `found` packet:

1. Confirm that the response contains a non-empty displayed provision or clearly says that
   the text was omitted. Do not claim “text returned” when only metadata is shown.
2. Claim `verbatim` or `hash-verified as displayed` only when the actual displayed block is
   present and exactly reproduces the packet's `text` field under the stated normalization.
3. Never refer to a block, table or quotation “above” or “below” unless that object is
   actually present in the final response.
4. If display completeness cannot be checked, label the text as an excerpt or say that no
   display-integrity claim is made.

## Source discipline

- Prefer the direct Riksdagen source over an aggregator when the source is available.
- Never present a free-text internet search as equivalent to a source receipt.
- Preserve the distinction between a consolidated text and the underlying SFS source
  hierarchy.
- Do not send a whole long Act into the assistant context when a targeted provision packet
  is sufficient.
- Treat an ambiguous or missing address as a useful result: it identifies what the code
  could not safely establish.
- Treat `capability.status` as a source-level gate. A source marked `unsupported` cannot
  yield confirmed provision text, although raw source observations can remain readable.
  A `review_required` source remains blocked unless one
  exact locator has a valid imported human review for the current snapshot. That packet
  uses `basis: human_reviewed_snapshot`; every other locator remains blocked.
- Treat `capability.temporal.status` as a separate timing gate. `flat` means no supported
  transition markers were detected. `layered_unresolved` means some passages or headings
  carry publisher transition markers but the connector does not yet implement date-aware
  version selection. An unmarked locator can still be returned, but that does not prove
  its historical commencement date or reconstruct earlier law.
- Read `I:` as the publisher's commencement marker (*ikraftträdande*) and `U:` as its
  cessation marker (*upphörande*). A dated marker is evidence attached to a source
  version, not by itself a conclusion about legal effect. An undated or otherwise
  indeterminate marker must remain indeterminate.
- Keep three layers distinct: the publisher's raw marker; any version-selection step and
  its `as_of` date; and the lawyer's conclusion about whether a rule governed the facts.
  Packet contract 0.2 implements the first layer and a refusal gate. It does not yet
  implement date-aware selection or legal-effect analysis.
- Explain hash semantics precisely: `source_text_sha256` identifies the complete stored
  `document.text`; `section_sha256` identifies the returned provision after line-ending
  normalization and trimming of outer whitespace. Do not call `section_sha256` byte-
  identical to the publisher's response.
- A section hash verifies the packet's `text` field. It verifies the displayed answer only
  when that field has been copied exactly; if numbers, list markers or lines are omitted,
  call the display an excerpt or summary and do not describe it as hash-verified.
- Treat a missing display as an evidence failure even when every metadata field is correct.
  Do not say that an absent quotation was reproduced or verified.
- Distinguish `source_snapshot_at` from `packet_generated_at`. A packet read from a local
  cache is evidence of the timestamped snapshot, not proof of a live fetch at the time the
  packet was generated.

Read [packet-contract.md](references/packet-contract.md) when checking field meanings or
when designing another consumer such as a contract or compliance skill.
