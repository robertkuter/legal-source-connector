# ABL reader-draft comparison — v0.2 English run

Date: 2026-08-21

## What was held constant

- the same ten ABL source packets;
- the same packet-only prompt;
- the same output schema;
- the same deterministic grounding harness;
- no live connector, web search or currentness check.

## Machine-level result

| Measure | Codex | Claude Code |
|---|---:|---:|
| Claims | 13 | 11 |
| Grounded claims | 13 | 10 |
| Explicitly ungrounded claims | 0 | 1 |
| Evidence records rendered | 13 | 14 |
| Packet IDs used | all 10 | all 10 |

Both outputs passed the structural grounding step. The difference is in the reader layer,
not in the source packet or evidence renderer.

## Human review finding

The Codex draft is currently the better public-reader baseline. It is more direct, breaks
the material into useful claims and uses less narrative framing.

The Claude draft is often thoughtful and legally aware, but its default style is more
story-like and expansive. It introduces more contextual framing, rhetorical explanation
and model-like rephrasing. That makes it interesting as a review-assist output, but less
suited to the first plain-language public example without editing.

## Specific review points

- In the Codex draft for `29 kap. 1 §`, preserve the legal actor and active responsibility
  clearly. The current wording uses a passive formulation and then identifies in the next
  sentence who may breach or owe compensation; this is a local clarity edit, not a
  grounding failure.
- In the Codex draft for `13 kap. 2 §`, check whether the English sentence ends one word
  early. This is a reader-layer issue if the exact source evidence is complete. The renderer
  must never truncate `packet_text`; any apparent loss in the evidence view is a harness
  defect, while a shortened English sentence is a model-output issue.
- Avoid startup-specific language such as “cap table” in the public founder primer; use
  “ownership structure” or “shareholding” where needed.
- Keep the distinction visible between what the packet says and useful contextual topics
  that are merely outside the supplied material.

## Edits applied after review

The Codex English draft was revised without changing the packets, locators, hashes or
grounding rules:

- `29 kap. 1 §`: the second sentence now names the actor directly — “They may also have
  to compensate a shareholder or another person if their breach ... causes harm.”
- `13 kap. 2 §`: the sentence now states the decision-maker and ends explicitly with
  “support the decision,” while retaining “the shares represented at the meeting.”

The regenerated artifact still contains one deterministic evidence record for each claim.
The grounding-harness and ABL parity tests pass after these reader-layer edits.

## Decision for the next iteration

Use the Codex-style reader layer as the current public presentation baseline. Keep the
Claude result as a valuable evaluation artifact showing that source grounding does not
automatically produce the same prose style across assistants.

The Swedish run should repeat the same packet and harness test. It should change only the
reader language to `sv`; it should not silently change the source evidence or the grounding
rules.
