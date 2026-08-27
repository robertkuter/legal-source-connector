# ABL primer parity test

This is a controlled cross-assistant test for the reader/evidence pattern.

There are two generations:

- `PROMPT.md` is the v0.1 historical test. The assistant writes both the reader and
  evidence layers. It is useful for comparing model behaviour, but it asks the model to
  reproduce exact source text.
- `PROMPT-v0.2.md` is the preferred harness. The assistant writes a reader draft with
  packet IDs; deterministic code adds the exact source text and provenance.

Both Claude and Codex should receive the same two files:

1. `source-packet-set.json` — ten selected ABL evidence packets;
2. `PROMPT.md` — the exact task and output rules.

Do not provide the finished ABL primer. The point is to see how each assistant turns the
same evidence into plain-English orientation while preserving the source boundary.

## Claude — v0.1 historical test

Upload `source-packet-set.json` and `PROMPT.md` to a new session. If the Swedish legal
grounding skill activates, let it read the packet, but do not allow it to imply that a live
connector call occurred. The required source path is `packet-only`.

## Codex — v0.1 historical test

Open the repository or attach the same two files in a new task. Run the prompt as written.
The installed skill may be available, but the packet set—not assistant memory—controls the
source claims.

## Comparison rule

Compare the outputs against `EXPECTED-BEHAVIOR.md`. Compare source fidelity and disclosure
before comparing writing style.

The packet set comes from the refreshed Riksdagen snapshot dated 2026-08-21. It is not a
live currentness check and does not include the complete Act.

## v0.2 harness test

For the human-facing sequence, start with [`START-HERE-v0.2.md`](START-HERE-v0.2.md).

Upload `source-packet-set.json` and `PROMPT-v0.2.md` to either assistant. Save its JSON
response as a reader draft, then run the local renderer:

```bash
node connector/render_grounded_claims.mjs \
  --draft reader-draft.json \
  --packets evals/abl-primer-parity/source-packet-set.json \
  --output grounded-artifact.json
```

The model output is then compared for readability and claim selection. The generated
artifact is compared for source fidelity; the model does not control that evidence layer.
