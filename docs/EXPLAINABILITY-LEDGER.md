# Explainability ledger

This is the change-to-understanding record for the connector. It sits between the
technical changelog and the public narrative: every meaningful implementation change
should leave behind a short explanation that can be reused in the README, a presentation,
an interactive view or a lawyer-facing demonstration.

## The rule

When code changes, record four linked items before calling the iteration complete:

| Item | Question it answers |
|---|---|
| Code change | What did the machine do differently? |
| Plain-English reason | Why was the change needed? |
| Evidence | Which automated test, receipt or fixture supports it? |
| Presentation hook | How could a non-technical user see or explain it? |

The code remains the source of truth for behaviour. This ledger is the source of truth
for preserving understanding about that behaviour.

## Entry: v0.1.5 code-hardening iteration

| Code change | Plain-English reason | Evidence | Presentation hook |
|---|---|---|---|
| Project-root defaults and automatic run-directory creation | The command should not depend on which folder a user happens to be standing in | Absolute-path ABL invocation passed; receipt written to the requested run directory | “The filing cabinet is located before we start looking for the document” |
| Chapter-aware candidate matching | A section number alone is not enough when a long Act has many chapters | Synthetic chapter-mismatch test returns `review_required`; ABL capability remains supported | Show two addresses with the same section number and explain why the chapter matters |
| Index reuse for unchanged snapshots | Re-reading and re-indexing an unchanged Act adds work without adding evidence | Connector test confirms matching index is reused; source hash and index version are checked | Show first run as “build the table of contents” and later run as “reuse the verified table” |
| One-pass line-offset helper | Repeatedly rescanning a long Act makes the simple prototype less efficient | Connector, commercial, CISG and staleness suites pass after the shared helper change | Use a small animation or diagram: one pass through the document versus starting over for every section |
| Strict locator parsing | A citation with extra words should not silently become a different request | Trailing-text regression test passes | Show the connector stopping at an invalid address instead of guessing |
| Tracked code/tests plus `CODE-EXPLAINER.md` | The build should be inspectable and teachable, not just runnable on one machine | Syntax checks and 38/38 connector tests pass | Public repository read order: orientation → wiring → code map → tests |
| Explicit API/cache/memory disclosure | Users need to know whether an answer came from a live source call, a stored snapshot or model context | Runtime disclosure fields are now documented in `CODE-EXPLAINER.md` and `WIRING-AND-MODES.md` | Show three boxes: official source, connector cache and assistant context |
| Building-block framing | The Swedish implementation should be useful without pretending to be a complete legal assistant | `BUILD-OVERVIEW.md`, `README.md` and `DISTRIBUTION.md` describe the source/evidence pattern; `MODULE-ROADMAP.md` separates future overlays | Show the same evidence-packet boundary feeding contract and compliance consumers; keep other domains on the internal roadmap |
| No-cache public smoke test | A fresh user should be able to test the core build without receiving private cached Acts | `tests/test_synthetic.mjs` passes 17/17; source-profile tests are documented as requiring explicit orientation | Show “core logic test” and “source evidence test” as two separate gates |
| Reader claims linked to packet IDs | A fluent assistant can explain useful material while still omitting or altering the evidence it claims to have checked | `tests/test_grounded_claims.mjs` rejects unknown packet IDs, verifies section hashes and preserves explicit ungrounded claims; `tests/test_primer_example.mjs` renders the ten-claim example | Show two lanes: “model explains” and “code supplies the exact source”; join them with `P01`, `P02` or another packet ID |

## Entry: v0.1.6 timing and attribution safety gate

| Code change | Plain-English reason | Evidence | Presentation hook |
|---|---|---|---|
| Separate temporal capability and parsed `I:`/`U:` marker records | A structurally valid Act can display outgoing and incoming versions at the same address | Synthetic timing cases plus cached ABL marker counts | Put an ordinary provision, a future-only provision and an outgoing/incoming pair side by side |
| Refuse unique marked versions; retain paired versions as ambiguous | A plausible passage is unsafe if the connector has not selected it for a date | Real ABL `7 kap. 68 a §` returns `unknown` without text; `19 kap. 13 §` remains `ambiguous` | “The useful result is sometimes a stop sign” |
| General lettered-chapter parsing and evidence-derived diagnostics | Upphovsrättslagen (URL) has both timing and chapter-identity mismatches; ÅRL's cross-reference explanation must not be reused generically | Synthetic `6 b kap.` test and URL capability diagnostic | Show URL and ÅRL as different reasons for the same `review_required` outcome |
| Attribution travels with packets, manifests and grounded artifacts | A detached artifact should still identify the official source and avoid implying endorsement | Grounded-artifact and primer-render tests; rendered footer | Detach the HTML example from the repository and show that the source credit remains |
| Packet contract 0.2 explains receipt timing in lawyer language | Technical fields are only useful if a reviewer can distinguish snapshot time, publisher marker and legal effect | Skill contract plus teach-back questions in `TESTING.md` | Ask a lawyer to identify which of the three timing questions the receipt answers |
| Clean-clone tests explain missing source data | The public repository intentionally excludes complete Acts, so an absent cache should lead to the next safe action rather than a machine stack trace | No-cache preflight checks list missing SFS IDs; the synthetic suite checks the connector's orientation guidance | Show the difference between “software failed” and “source has not been downloaded yet” |
| Found-packet response must contain the evidence it describes | A pasted Claude Sonnet transcript appeared to omit a provision block while still describing it as verbatim; the later full-box check showed that the rendered answer did contain the block | v0.1.6 transcript record; v0.1.7 adds a final response integrity check and C09; the v0.1.7 positive-path evaluation records the copy/paste artifact | Show the rendered evidence box as well as the prose transcript when reviewing output integrity |

## Reusable presentation pattern

For a future change, present it in this order:

1. **The observed problem** — what could go wrong or become confusing?
2. **The small code change** — name the file and function, without requiring the audience to read it.
3. **The guardrail** — what does the connector now refuse to assume?
4. **The evidence** — show the test or receipt.
5. **The boundary** — what is still not established?

This pattern is deliberately suitable for a README paragraph, a short article, a live
walkthrough or an interactive visual. It also keeps the public explanation honest: a
successful test demonstrates tested behaviour, not universal coverage of Swedish law.

## Update checklist

- [ ] Add or update a focused automated test.
- [ ] Update `CODE-EXPLAINER.md` if the workflow or code map changed.
- [ ] Add a row here if the change affects reliability, scope or user understanding.
- [ ] Update the release manifest with the relevant version and evidence counts.
- [ ] Update the public wording only after the limitation is clear.
