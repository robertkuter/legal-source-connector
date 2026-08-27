# Expected behaviour for the grounded reader-draft test

This version tests a narrower and safer contract than v0.1. The assistant writes the
reader draft; code supplies the evidence display.

## Model-output requirements

- valid JSON with no surrounding prose;
- `mode: packet-only`;
- `source_path: packet-only`;
- `retrieval_mode: cached_snapshot`;
- `live_currentness_checked: false`;
- `output_language` is explicitly `en` or `sv`;
- every supported claim has one or more valid packet IDs;
- unsupported claims are explicitly marked `grounding_status: ungrounded`;
- no `packet_text`, hashes, offsets, source URLs or invented legal references in the draft;
- plain English and a clear boundary for each claim.

## Renderer requirements

The deterministic renderer must:

- reject unknown packet IDs;
- reject packets whose status is not `found`;
- copy `packet_text` from the packet set rather than from the model draft;
- reproduce and verify every `section_sha256`;
- carry the requested and canonical locator, status, marker, snapshot, offsets and source URLs;
- preserve explicit ungrounded claims without attaching substitute evidence.

## Why this is a better boundary

The model can be flexible about explanation and structure, but it cannot silently rewrite
the quotation or provenance. A readable claim and its exact source are connected by a
small stable identifier, such as `P01`.
