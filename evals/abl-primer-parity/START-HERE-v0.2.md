# ABL grounding-harness test — start here

This is a controlled test of the reader-draft and evidence-rendering pattern.

You are testing three separate things:

1. whether an assistant can write useful plain-language claims;
2. whether it links each claim to the right packet ID;
3. whether local code can add the exact source evidence without trusting the assistant to retype it.

This is not a live Riksdagen retrieval test. It uses ten frozen packets from an ABL
snapshot dated 2026-08-21.

## Part A — run the assistant test

Use a new Claude Code or Codex task. For this controlled test, do not activate the legal
grounding skill and do not use a connector, web search or live API.

Upload these two files from this kit:

- `PROMPT-v0.2.md`
- `source-packet-set.json`

Then send exactly:

> Follow `PROMPT-v0.2.md` exactly. Return JSON only. This is a packet-only test. Do not call a connector, search the web or use live legislation.

Run the test once with `output_language: "en"`. Later, repeat it with
`output_language: "sv"` to test a plain-Swedish reader layer.

The expected assistant output is a JSON object containing claims with fields such as:

```json
{
  "claim_id": "C01",
  "text": "Plain-language explanation",
  "boundary": "What still needs checking",
  "packet_ids": ["P01"]
}
```

Do not ask the assistant to reproduce the Swedish quotations, hashes or offsets. The
local harness will add those.

## Part B — save the assistant output

Save the complete JSON response as one of these files in the connector project:

```text
temp/reader-draft-claude-v0.2.json
temp/reader-draft-codex-v0.2.json
```

If the assistant returned commentary around the JSON, ask it to return JSON only before
saving the file. Do not edit the claim content manually.

## Part C — run the local harness

Open Terminal and run the command for the assistant you tested. For Claude:

```bash
cd legal-source-connector
node connector/render_grounded_claims.mjs \
  --draft temp/reader-draft-claude-v0.2.json \
  --packets evals/abl-primer-parity/source-packet-set.json \
  --output temp/grounded-artifact-claude-v0.2.json
```

For Codex, replace `claude` with `codex` in both filenames.

The command should either produce a grounded artifact or stop with a clear error. It will
reject an unknown packet ID and will verify every section hash before writing evidence.

## Part D — inspect and compare

The grounded artifact contains:

- the assistant's explanation;
- the packet IDs it selected;
- exact Swedish packet text copied by code;
- locator, status, consolidation marker, snapshot, hash and offsets.

Bring the assistant's JSON response back to Robert for comparison. Compare reader quality
first. Then compare packet selection and the renderer result. Do not treat fluent prose as
evidence unless it has a packet ID and a valid rendered evidence record.

## What counts as a good result

- The assistant stays in `packet-only` mode.
- It makes no live API or connector claim.
- Claims use sensible packet IDs.
- Unsupported points are marked ungrounded rather than attached to a nearby provision.
- The local renderer supplies the source text and provenance.
- English and Swedish change only the reader layer, not the source evidence.
