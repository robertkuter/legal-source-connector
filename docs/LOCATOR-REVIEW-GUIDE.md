# Review one provision locally

The connector may find official source text but be unable to confirm its boundary. The
local review page shows what stopped it, the proposed provision, and the text immediately
after it. A reviewer can confirm one exact provision in one downloaded snapshot. Other
provisions in the Act keep their own result.

For a visual preview, see the [synthetic, read-only review example](../examples/locator-review/README.md).
The commands below open the live local page for an actual source.

## Open the page

From the connector folder, use Årsredovisningslagen (1995:1554), `7 kap. 7 §`, as a
worked example:

```bash
node connector/get_provision.mjs --fresh \
  --source sfs-1995-1554 --locator "7 kap. 7 §"
node connector/serve_locator_review.mjs \
  --source sfs-1995-1554 --locator "7 kap. 7 §"
```

Open the complete `url` printed with `status: serving`, including `127.0.0.1`, the
`/review/` token and `?save=1` when supplied. The first command checks the official
source now; the page then reviews the saved snapshot from that check. A plain
`localhost` address is not the review link. If the fresh check fails, stop rather than
using an older saved source as current.

## Make the decision

Read the reason for the stop, the proposed text, and where that text starts and ends.
The page asks short **Yes** or **Cannot confirm** questions about those boundaries. A
question about heading-like lines appears only when relevant. No answer is selected in
advance. Enter a reviewer label; the note is optional.

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
  --source sfs-1995-1554 --locator "7 kap. 7 §"
node connector/import_review_decision.mjs \
  --artifact reviews/prepared/sfs-1995-1554--7-kap-7/review-artifact.json \
  --decision /path/to/completed-review-decision.json
node connector/get_provision.mjs \
  --source sfs-1995-1554 --locator "7 kap. 7 §"
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
