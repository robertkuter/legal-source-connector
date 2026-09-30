# Changes

This page tracks changes a user would notice. The [README](README.md) explains how to
start; the [technical documentation guide](docs/README.md) holds the detailed evidence
and design notes.

## On `main` after v0.1.7 (unreleased)

- `--fresh` checks the official Riksdagen source again and reports whether its text or
  HTML changed. A failed check returns `unknown` rather than presenting cached text as
  current.
- Blocked results can show identifiable official text as an **unverified source
  observation**, separate from confirmed provision text.
- A local page lets a reviewer inspect and record the boundaries of one provision.
  A valid decision releases only that locator in the reviewed snapshot; timing and
  unsupported cases remain explanation-only.
- The same commands and decision file work across local AI assistants. A remote
  workspace may need the HTML-and-JSON handoff instead of a browser link.

See the [local review guide](docs/LOCATOR-REVIEW-GUIDE.md) for a short walkthrough.
The [synthetic HTML example](examples/locator-review/README.md) shows the review layout
without offering a live decision.
The v0.1.7 release downloads do not include these changes. Download the
[current `main` source](https://github.com/robertkuter/legal-source-connector/archive/refs/heads/main.zip)
to try the updated connector.

## v0.1.7

The [existing public prerelease](https://github.com/robertkuter/legal-source-connector/releases/tag/v0.1.7)
contains the connector, portable skill, source packets, tests and dated ABL example.
Its downloads do not include the changes above.
