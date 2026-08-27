# Contributing

This is an explainability alpha. Contributions should keep the source boundary visible,
add evidence for changed behaviour and avoid expanding the project into an untested general
legal assistant.

## Choose the contribution route

| Contribution | Normal home | Expected route |
|---|---|---|
| Add or update an SFS source profile | This repository | Pull request with source-profile tests and coverage notes |
| Fix the generic Riksdagen parser or packet code | This repository | Pull request with a synthetic regression and all affected source tests |
| Improve the skill, packet contract or explanations | This repository | Pull request with compatibility and reader-impact notes |
| Add a focused consumer of SFS packets | Propose here first | Small modules may fit here; broader applications should remain separate |
| Build a connector for another provider | Outside this repository's present contribution scope | No public compatibility or incorporation route is defined yet |
| Build a different implementation of the same idea | Fork or separate repository | Fork when proposing changes back; separate repository for an independent project |

The distinction matters. Another Swedish Act is additional coverage. A contract citation
audit is a consumer module. An integration with another authority is a new connector with
its own identity, freshness, access and data-governance model. Mentioning that design
direction in the roadmap is not a request for provider implementations.

## Before writing code

Define:

1. the user question or trigger;
2. the source or packet consumed;
3. the output and uncertainty states;
4. the automated and human-review tests; and
5. what the change explicitly does not decide.

## Adding an SFS source profile

An Act does not need a committed profile before someone can use it locally. The connector
may orient an identified SFS source and decide from the snapshot audit. A profile is a
contribution of repeatable release evidence for an Act that merits maintained coverage.

1. Orient the official JSON, text and HTML representations locally.
2. Run the structural and temporal capability audit.
3. Test first, middle, final, special-form, transition and missing locators.
4. Classify every structural mismatch.
5. Add a compact source manifest and deterministic source-profile test.
6. Update tested coverage and limitations.
7. Keep the source `review_required` unless the complete audit passes.

Do not commit complete cached Acts or local run receipts merely to make a test pass.

## Change requirements

A pull request that changes behaviour should normally include:

- the focused regression test;
- the implementation change;
- the packet-contract or compatibility impact;
- the plain-language explanation; and
- the affected source-profile and no-cache test results.

Changes to the shared packet contract require a version change and rerun of every consumer
test. Source-profile additions do not necessarily require a skill-version change.

## Public-data and security boundary

Never commit:

- API credentials, client secrets or test-environment keys;
- private contracts, workbooks or client facts;
- uncurated source caches or local receipts;
- personal data obtained from a register unless a public fixture has been deliberately
  reviewed and approved; or
- provider responses whose terms do not permit redistribution.

Use synthetic fixtures for portable failure-state tests. A live-source receipt may support
local verification without becoming a public fixture.

## GitHub workflow

Contributors without write access can fork the repository, work on a branch and open a pull
request. A pull request proposes a change; it does not make the contributor’s entire fork
part of this project. Larger SFS consumers should begin with an issue describing the five
extension questions above. Other-provider connectors are not part of this release scope.

The public repository is intended to remain readable as a work product. A contribution is
not complete merely because its code runs; a lawyer or reviewer should be able to see what
changed, what evidence supports it and where the boundary remains.
