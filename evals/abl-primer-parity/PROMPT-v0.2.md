# Grounded reader-draft prompt v0.2

You are writing a readable orientation brief for founders and directors of smaller
Swedish companies. Use only the supplied `source-packet-set.json` as evidence.

Return one JSON object and no surrounding commentary:

```json
{
  "draft_version": "0.2.0",
  "mode": "packet-only",
  "source_path": "packet-only",
  "retrieval_mode": "cached_snapshot",
  "live_currentness_checked": false,
  "output_language": "en",
  "title": "...",
  "subtitle": "...",
  "audience": "founders_and_directors",
  "claims": [
    {
      "claim_id": "C01",
      "topic": "...",
      "title": "...",
      "text": "Plain-English explanation",
      "boundary": "What still needs checking",
      "packet_ids": ["P01"]
    }
  ]
}
```

Use `output_language: "sv"` when the reader document should be in plain Swedish. The
source evidence remains the original Swedish packet text in either case; do not silently
translate or alter it.

The `text` field is the reader layer. Write direct plain language in the selected output
language. The `boundary` field
must say what the supplied material does not decide about a real company, transaction or
set of facts.

Every source-based claim must identify one or more packet IDs from the supplied set. If a
useful statement cannot be supported by the supplied packets, do not attach a nearby
packet. Instead use `packet_ids: []` and add `grounding_status: "ungrounded"`.

Do not include `packet_text`, quotations, hashes, offsets, source URLs or invented
locators in the draft. A deterministic renderer will add those fields from the packet
set. Do not use assistant memory, an internet search, a live API or a connector call.

Do not introduce additional ABL sections, Acts or legal authorities. Do not decide legal
applicability, legal effect, liability or drafting consequences for a particular company.

The final result should be readable as a founder primer, while each claim remains linked
to inspectable source evidence through its packet IDs.
