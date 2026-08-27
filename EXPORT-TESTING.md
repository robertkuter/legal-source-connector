# Export testing

The release has two separate test surfaces.

## Claude portable-skill test

During development, test the tracked directory under
`skill/sv-legal-source-grounding/`. For a tagged release, upload the portable ZIP attached
to that release and confirm that its version matches `metadata.skill_version` in
`SKILL.md`. Generated ZIPs are release artifacts and are not part of the source checkout.

The portable and Codex packages use the same `SKILL.md` and packet contract. The Codex
package additionally includes `agents/openai.yaml`.

This export tests the skill's evidence discipline and lawyer-facing explanation. Use the
prompts in [`evals/skill-test-cases.md`](evals/skill-test-cases.md). For the first Claude
pass, paste a packet when the prompt requires live source data; the portable skill does
not secretly bundle the local cache or connector.

Claude custom skills are uploaded as a ZIP whose single top-level directory contains the
skill. Keep the live source connector separate until the packet contract is stable.

## Codex local test

Use the skill directory directly:

`skill/sv-legal-source-grounding/`

### Codex packet test checklist

Before starting, use the tracked directory or install the Codex ZIP attached to the same
tagged release. Confirm that the installed version matches `metadata.skill_version` and
that `sv-legal-source-grounding` appears in the available skills. Start a fresh Codex task
and attach a reviewed `found` packet, such as a locally generated packet for
Diskrimineringslag (2008:567), 2 kap. 3 §.

No live Riksdagen connector is needed for a packet-only parity test. Use the same prompt
as Claude:

> Using the attached source packet, check Diskrimineringslag (2008:567), 2 kap. 3 §.
> Report: (1) source and status; (2) targeted text; (3) consolidation marker and
> timing; (4) hashes, offsets and capability status; and (5) what this confirms and
> what it does not decide. State whether the displayed text is verbatim, normalized or
> summarized. Keep source confirmation separate from legal interpretation. Do not use
> an unreceipted web search.

Check the response for all of the following before calling the test complete:

- `found`, exact authority and canonical locator `2 kap. 3 §`;
- targeted text preserved and correctly labelled as verbatim/normalized;
- consolidation marker `t.o.m. SFS 2025:736`;
- `source_snapshot_at`, `packet_generated_at` and `retrieval_mode: cached_snapshot`;
- source, HTML source, full-text and section hashes;
- offsets, UTF-16 unit and capability result `supported`, 88/88;
- no claim of a live retrieval or staleness result;
- no claim that “current” was proven without a second receipt;
- hash described as applying to the normalized packet field, not raw publisher bytes;
- source confirmation kept separate from applicability, legal effect and drafting advice.

If the skill is not visible, stop and restart Codex before testing. If it still is not
visible, label the run **packet-only, skill not active** rather than treating it as a
Codex skill pass.

For the live connector tests, start from the connector project directory:

```bash
cd legal-source-connector
node tests/test_connector.mjs
```

The Codex export also includes `agents/openai.yaml`. Run the same six prompts, then use the
local connector commands for C01–C05 to compare actual packets with the assistant's
explanation.

## Interpretation

There are two independent results:

1. **Skill pass** — the assistant follows the workflow and reports uncertainty correctly.
2. **Connector pass** — the code retrieves, indexes, hashes and compares the source correctly.

Do not merge those results. A skill can be well-behaved while its tool is unavailable, and
a tool can be correct while an assistant fails to call it.
