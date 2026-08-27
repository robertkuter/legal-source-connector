# Modular extension roadmap

The connector is the shared substrate. Extensions consume its packet contract; they do
not rewrite the source retrieval logic.

## Three different kinds of extension

Keep these tracks separate even when one user workflow combines them:

| Track | Example | What changes | What stays stable |
|---|---|---|---|
| Source coverage | Add another SFS Act | Source profile, capability fixtures and locator tests | Riksdagen adapter and SFS packet contract |
| Consumer module | Contract citation audit | Candidate extraction, orchestration and review output | Source connector remains the only layer that confirms the source address |
| Provider connector | Another official or commercial authority | API access, identity model, field schema, freshness and provider-specific tests | The general evidence discipline, not the SFS parser or SFS packet shape |

A new Act is therefore not a new connector. A contract audit is not a new source. An
integration with a different authority is a new connector, even if a higher-level workflow
later uses its evidence beside SFS packets.

## Launch contribution model

The alpha should remain one focused reference repository rather than start as a monorepo or
collection of packages. Its present public contribution scope is deliberately narrow:

1. SFS source profiles and generic Riksdagen fixes arrive through pull requests here.
2. Small consumers that exist mainly to demonstrate this packet contract may be proposed
   here; complete applications stay separate.
3. Other provider connectors are outside the current public contribution scope. The roadmap
   records a design boundary, not a request for implementations.

Do not introduce a provider-neutral framework before a second connector has established
what is genuinely common. This release does not define a connector marketplace, compatibility
programme or repository-linking model.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the proposed GitHub routes and evidence gates.

## Extension rule

Every new module must define five things before implementation:

1. **Trigger** — what user request activates it;
2. **Input** — which packet or source identity it consumes;
3. **Output** — the result shape and uncertainty states;
4. **Tests** — automated cases and human evaluation prompts;
5. **Boundary** — what the module explicitly does not decide.

If a proposed feature cannot state these five things, keep it as a research note rather
than adding code.

## Planned modules

| Module | First useful question | Depends on | Priority |
|---|---|---|---|
| Source capability gate | Does this Act's structure support safe complete addressing? | Publisher structure + text index | Now |
| Source grounding | Did we retrieve the requested Swedish source/provision? | Riksdagen adapter + capability gate | In progress |
| Currency comparison | Has the pinned source changed? | Receipt + full-source hash | Done |
| In-force marker detection/refusal | Does the source contain transition wording requiring date analysis? | Provision packet | Done |
| Date-aware version selection | Which visible version should be selected for an explicit `as_of` date? | Parsed markers + selection contract | Next |
| Source resolver | Which SFS number does “LAS” or a statute name mean? | Riksdagen search | Later |
| Legal research | What do source hierarchy and preparatory works add? | Grounding + resolver | Later |
| Contract citation audit | Which contract references are stale, vague or unsupported? | Grounding + resolver | Later |
| Compliance authority audit | Which policy/rule sources need refresh or escalation? | Grounding + comparison | Later |
| EU source adapter | Can the same packet pattern work for EUR-Lex? | Provider-neutral contract | Later |
| Other authority adapter | Can the same evidence discipline transfer without copying the SFS model? | Separately owned research | Research direction |

The other-authority row is only a placeholder. Revisit its public detail after the first
release, when actual use, questions and repository traffic show whether a shared approach
would help. It does not reserve a provider, announce a build or invite contributions.

## Adding another SFS Act

Adding coverage should be a repeatable promotion exercise rather than a parser change by
default:

1. Identify the Act and official SFS source.
2. Orient and preserve JSON, text and HTML snapshots locally.
3. Run the generic structural and temporal capability audit.
4. Exercise representative locators: first, middle, last, chapterless or lettered forms,
   amendments, transition markers and one deliberately missing locator.
5. Classify every mismatch. Do not promote the Act merely because most locators work.
6. Add a source manifest and deterministic source-profile test.
7. Record the tested snapshot, shapes and limitations in the coverage documentation.
8. Promote to `supported` only when the complete audit passes; otherwise keep
   `review_required` visible.

These are the steps for adding an Act to the maintained public regression pack. They are
not a permission gate. For an on-demand Act, orient and audit the snapshot first; safe
locators may be used when the generic gate passes, while unresolved cases remain visible.

An Act should enter the public starter set when it is useful in an actual workflow and
adds a source shape or safety case not already represented. This avoids turning coverage
into an unreviewed statute count.

## Building over the connectors

Higher-level modules consume evidence packets. They should not reach around the connector
and call the provider API directly.

```text
document or question
  → candidate authority / entity / field
  → appropriate connector
  → provider-specific evidence packet
  → cross-packet analysis
  → lawyer-readable finding with packet references
```

The composed result should retain every contributing packet and its provider. Do not merge
an SFS source claim and a company-register claim into one undifferentiated “verified” flag.
For example, a signing-authority review might need:

- a corporate packet identifying the company and registered signatory information;
- an SFS packet for any statutory proposition the analysis relies on;
- contract evidence showing the name, capacity and signature block actually used; and
- a separate legal conclusion explaining what those sources mean together.

The first higher-level public example should remain the explicit contract-reference check.
It exercises composition without adding uncertain document-wide extraction or a second
provider at the same time.

## Versioning rule

Keep separate versions for:

- connector implementation;
- packet contract;
- each skill;
- evaluation set.

A module may evolve independently if it continues to consume the same packet contract. A
packet-contract change requires a compatibility note and rerun of all consumer tests.

## Promotion rule

Prototype scripts can remain under `temp/` while the behavior is being learned. Promote a
script into tracked `connector/` or `tests/` code only when:

- the automated harness covers its failure states;
- a human can explain the output;
- the packet contract is documented;
- no private fixture data is required to reproduce the test;
- the module has an explicit non-goal.
