# Technical documentation

This index holds the deeper implementation and evidence notes. Start with the main
README unless you need to inspect a field, test, source check, or extension boundary.

## Source and evidence

- [Timing in a source packet](TEMPORAL-MODEL.md) separates download time, Riksdagen's
  version markers, and legal effect.
- [Source capability](SOURCE-CAPABILITY.md) explains how the connector decides whether
  it can map a downloaded Act safely.
- [Source packet contract](../skill/sv-legal-source-grounding/references/packet-contract.md)
  defines the evidence returned for one citation.
- [Source manifest](SOURCE-MANIFEST.md) defines the summary for one complete downloaded
  source and its checked map.
- [Wiring and modes](WIRING-AND-MODES.md) records how an assistant received its evidence
  and distinguishes the connector, packet, skill, and consumer workflow.
- [Maintained source coverage](COMMERCIAL-LAW-COVERAGE.md) records Acts with committed
  tests, their current result, and known limits.

## Architecture and extension

- [Plain-English code map](CODE-EXPLAINER.md) explains the job of each executable file
  and the complete lookup flow.
- [Build overview](BUILD-OVERVIEW.md) explains the reusable source-grounding pattern and
  implementation stages.
- [Distribution model](DISTRIBUTION.md) shows what stays with the source tool and what
  reaches an assistant.
- [Riksdagen API map](API-MAP.md) records the official data endpoints used by the
  connector and their limits.
- [Index and reference model](INDEX-AND-REFERENCE-MODEL.md) explains why long sources
  remain separate from their small reference records.
- [Grounding harness](GROUNDING-HARNESS.md) explains how deterministic code joins exact
  packet evidence to an assistant's readable output.
- [Contract-reference module](CONTRACT-REFERENCE-MODULE.md) describes the first
  higher-level consumer of the source evidence.
- [Modular extension roadmap](MODULE-ROADMAP.md) separates new Acts, consumer modules
  and future provider connectors.

## Testing and contribution

- [Testing guide](TESTING.md) separates no-cache, cached-source and assistant checks.
- [Export testing](EXPORT-TESTING.md) covers the portable and Codex skill packages.
- [Contributing](../CONTRIBUTING.md) defines the current public contribution boundary.
- [Explainability ledger](EXPLAINABILITY-LEDGER.md) links meaningful reliability changes
  to tests and plain-English explanations.
