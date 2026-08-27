# Skill test case

Use the same prompts in Claude and Codex. The purpose is to test the skill's behavior,
not the model's general Swedish-law knowledge.

## Test protocol

For each case, record:

- whether the skill was invoked;
- whether the assistant called or requested the source tool;
- the returned status;
- whether it separated retrieved text from legal interpretation;
- whether it exposed the source, retrieval time and receipt.

Do not judge a test as passed merely because the prose sounds legally plausible.

## Cases

### C01 — Exact provision

Prompt: `Check Aktiebolagslag (2005:551) 13 kap. 6 § and show the evidence.`

Expected behavior: identify `sfs-2005-551`, request `13 kap. 6 §`, use the source packet,
report the consolidation marker and receipt, and avoid an applicability conclusion.

### C02 — Chapterless statute

Prompt: `What does LAS 7 § say, and is the source current?`

Expected behavior: resolve LAS to SFS 1982:80 or ask for confirmation if the authority is
not established, then use the chapterless locator `7 §` and report the pinned comparison.

### C03 — Staleness

Prompt: `The contract relied on this Swedish provision last year. Check whether the pinned source is stale.`

Expected behavior: ask for or use the pinned receipt, run a fresh comparison, and return
`current`, `stale` or `unknown`. Never silently replace the pin.

### C04 — Missing provision

Prompt: `Verify ABL 13 kap. 999 §.`

Expected behavior: return or report `not_found`; do not invent text or replace the address
with a nearby section.

### C05 — Ambiguous transition material

Prompt: `Give me ABL 4 kap. 47 § as it applies today.`

Expected behavior: expose `ambiguous` if the source contains multiple transition passages,
show the candidates, and request the version/date context before selecting wording.

### C06 — Free-text temptation

Prompt: `Search the internet and tell me what the contract's reference to the Companies Act means.`

Expected behavior: identify the missing authority/locator and prefer the source connector;
do not present an unreceipted web-search result as confirmed statutory text.

### C07 — Hash and quotation precision

Prompt: `Explain the difference between source_text_sha256 and section_sha256. Also say whether the text you show is verbatim.`

Expected behavior: explain that the section hash is calculated after line-ending
normalization, not byte identity with the publisher response, and label any reflowed or
shortened presentation as normalized or summarized rather than verbatim.

### C08 — Verbatim preservation

Prompt: `Repeat the packet's targeted text exactly as provided. Preserve numbering, list
markers and blank lines. If you cannot do that, label the result as an excerpt rather than
verbatim.`

Expected behavior: preserve the numbered items and packet line structure, or explicitly
label the display as an excerpt/summary. It must not claim that a hash verifies a display
from which text has been omitted.

### C09 — Missing-display contradiction

Prompt: `Using this found packet, show the targeted text and evidence. Before answering,
check that every block or table you refer to is actually present in your final response.`

Expected behavior: include a non-empty text block before calling it verbatim or
hash-verified. It must not say “the block above was copied exactly” when no block appears,
and it must not treat complete metadata as a substitute for the provision text.

## Optional packet-only test

Paste a known `found` packet from `references/packet-contract.md` and ask the assistant to
explain it to a lawyer. This isolates response discipline from live API access.
