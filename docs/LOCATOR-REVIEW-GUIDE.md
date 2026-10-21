# Review one provision locally

## Why this page exists

The connector may find the words of a provision in Riksdagen's source but still be unsure
where that provision begins and ends. In Upphovsrättslagen, for example, the text has a
`7 kap. 53 g §` that Riksdagen's HTML does not mark as a section. The connector cannot tell
which is right, so it holds the Act rather than silently cutting a provision at the wrong
place. (Up to v0.1.8 Årsredovisningslagen was the example: five references inside
`7 kap. 7 §` looked like separate sections. The connector now follows the HTML's section
marks, so that list stays inside `7 kap. 7 §` and ÅRL needs no review.)

For some mismatches, the connector can propose where the requested provision starts and
ends. The local review page shows why the automatic check stopped, the proposed text, and
the text on either side. A human reviewer can check those boundaries and save a decision for
that one locator.

The connector validates the decision against the exact downloaded source before it
retries the lookup. Other provisions keep their own result. The decision does not approve
the whole Act, choose a version for a date, or decide what the law means. When the
connector cannot offer confirmation, the page explains why without a save button.

For a visual preview, see the [synthetic, read-only review example](../examples/locator-review/README.md).
The commands below open the live local page for an actual source.

## Open the page

From the connector folder, use Upphovsrättslagen (1960:729), `1 kap. 2 §`, as a worked
example. The Act is held because of `7 kap. 53 g §`, but this provision's own start and end
can be checked:

```bash
node connector/get_provision.mjs --fresh \
  --source sfs-1960-729 --locator "1 kap. 2 §"
node connector/serve_locator_review.mjs \
  --source sfs-1960-729 --locator "1 kap. 2 §"
```

Try `7 kap. 53 f §` as well: its proposed text runs through the unmarked `53 g §`, and the
right answer there is **Cannot confirm**.

Open the complete `url` printed with `status: serving`, including `127.0.0.1`, the
`/review/` token and `?save=1` when supplied. The first command checks the official
source now; the page then reviews the saved snapshot from that check. A plain
`localhost` address is not the review link. If the fresh check fails, stop rather than
using an older saved source as current.

## Make the decision

Read the reason for the stop, the proposed text, and where that text starts and ends.
The page asks short **Yes** or **Cannot confirm** questions about those boundaries. A
question about heading-like lines appears only when relevant. No answer is selected in
advance. Enter a label for the person making the decision; the note is optional.

**Save review locally** validates the completed answers, imports the decision, retries
this locator and prints the result in the waiting terminal. **Cannot confirm** does not
create a confirming decision. The automatic `review_required` warning remains visible
even if this one result becomes `found` with `basis: human_reviewed_snapshot`.

For a current-wording request, run the same `get_provision.mjs --fresh` command again
after saving. Use that final packet. If the official source changed during review, the
saved decision will no longer validate for it.

## If the page cannot return to the connector

A review URL opened inside a remote workspace may be unreachable on your computer. Run
the preparation command where the source snapshot lives, open or transfer its generated
HTML file, and download the completed decision JSON from that page. Then import it in
the same connector workspace:

```bash
node connector/prepare_locator_review.mjs \
  --source sfs-1960-729 --locator "1 kap. 2 §"
node connector/import_review_decision.mjs \
  --artifact reviews/prepared/sfs-1960-729--1-kap-2/review-artifact.json \
  --decision /path/to/completed-review-decision.json
node connector/get_provision.mjs \
  --source sfs-1960-729 --locator "1 kap. 2 §"
```

Use the paths printed by the preparation command if they differ from this example. If
the request is for current wording, finish with a fresh lookup as above. A chat approval
or a JSON download alone is not an imported review.

## When confirmation is unavailable

An unresolved incoming or outgoing version, an unsupported structure, or an incomplete
boundary gets an explanation page without a save button. Where the connector can isolate
text, it still shows it as an **unverified source observation** for reading, with the
reason confirmation stopped. It does not select a dated version. See the
[technical reviewed-source workflow](REVIEWED-SOURCE-WORKFLOW.md) for the decision record,
validation rules and other mismatch patterns.
