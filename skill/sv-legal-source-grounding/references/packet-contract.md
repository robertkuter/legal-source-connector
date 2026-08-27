# Source packet contract 0.2

The source tool returns JSON. The packet is evidence about retrieval, not a legal
conclusion.

## Status values

| Status | Meaning | Agent action |
|---|---|---|
| `found` | One exact structurally plausible passage was retrieved | Use the text and provenance |
| `not_found` | The indexed source did not contain the requested address | Do not guess; check the citation |
| `ambiguous` | More than one plausible passage matched | Expose candidates; require version context |
| `unknown` | Retrieval, parsing, structural confirmation or safe timing resolution failed | Report the reason and stop source claims |

## Core fields

```json
{
  "packet_version": "0.2",
  "status": "found",
  "authority_id": "sfs-2005-551",
  "source_id": "2005:551",
  "title": "Aktiebolagslag (2005:551)",
  "requested_locator": "13 kap. 6 §",
  "canonical_locator": "13 kap. 6 §",
  "text": "...",
  "source_url": "https://data.riksdagen.se/dokument/sfs-2005-551.text",
  "retrieved_at": "...",
  "source_snapshot_at": "...",
  "packet_generated_at": "...",
  "retrieval_mode": "cached_snapshot",
  "consolidation_signal": "t.o.m. SFS 2026:783",
  "source_text_sha256": "...",
  "source_html_sha256": "...",
  "section_sha256": "...",
  "capability": {
    "status": "supported",
    "method": "html_paragraph_anchors_plus_text_section_candidates",
    "html_anchor_count": 1025,
    "text_candidate_count": 1025,
    "issues": [],
    "temporal": {
      "status": "layered_unresolved",
      "section_marker_count": 28,
      "heading_marker_count": 7,
      "marker_counts": {
        "enters_on": 16,
        "ceases_on": 12,
        "heading_enters_on": 5,
        "heading_ceases_on": 2
      },
      "issues": ["Publisher transition markers require date-aware version selection."]
    }
  },
  "temporal": {
    "capability_status": "layered_unresolved",
    "resolution": "unmarked_locator",
    "markers": []
  },
  "attribution": {
    "text": "Källa: Sveriges riksdag",
    "non_endorsement": "This project is independent and is not produced, endorsed or sponsored by Sveriges riksdag."
  },
  "source_snapshot": "...",
  "source_offsets": {"start": 0, "end_exclusive": 0},
  "offset_unit": "UTF-16 code units in document.text",
  "index_version": "0.6"
}
```

`source_text_sha256` identifies the complete consolidated text held by the connector.
`section_sha256` identifies the returned provision after line-ending normalization and
trimming of outer whitespace; it is not a byte-level hash of the publisher's JSON, text or
HTML response. The `source_offsets` point into the raw document text and may therefore span
more characters than the normalized, trimmed packet text. Use the source snapshot and
offsets when raw re-derivation is needed.
`consolidation_signal` is a publisher-provided marker such as `t.o.m. SFS 2026:783`;
it is evidence of the retrieved consolidation, not a legal opinion that the provision
applies.

`capability.status` is a source-level completeness gate. `supported` means the publisher's
structural paragraph anchors and the text section candidates agree for the cached source.
`review_required` or `unsupported` means the connector must return `unknown` for provision
confirmation rather than silently relying on an untested text parser.

`capability.temporal.status` is independent of structural capability:

| Value | Meaning |
|---|---|
| `flat` | No supported transition markers were detected in this snapshot |
| `layered_unresolved` | One or more provisions or headings carry publisher transition markers; date-aware selection is not implemented |

The provision-level `temporal.resolution` records what happened at the requested locator:

| Value | Packet result | Meaning for a lawyer |
|---|---|---|
| `not_applicable` | normally `found` | The source is flat under the current marker vocabulary |
| `unmarked_locator` | `found` | This locator has no marker, although another part of the Act may be layered; this is not proof of its historic commencement date |
| `marked_version_unresolved` | `unknown` | One version was found with an `I:` or `U:` marker, but the connector cannot safely select it for a date |
| `multiple_versions_unresolved` | `ambiguous` | More than one version matched; candidates and their markers remain visible |
| `locator_not_found` | `not_found` | No exact address was indexed |
| `source_structure_unresolved` | `unknown` | The structural gate failed before timing could be resolved |

Riksdagen's inline `I:` marker means *ikraftträdande* (entry into force) and `U:` means
*upphörande* (cessation). Heading markers apply to the heading, not automatically to every
provision beneath it. The `markers` array preserves the publisher's raw wording and, when
possible, an ISO date plus `date_status`. These fields report source evidence. They do not
say that the selected rule governed a transaction, claim or reporting period.

Contract 0.2 deliberately refuses marked provisions until an explicit, tested `as_of`
selector exists. A future contract may record the query date, selected version and visible
alternatives. Those selection fields must remain separate from legal applicability.

`retrieved_at` identifies the source snapshot used by the packet when it is available.
`packet_generated_at` identifies when the local packet was produced. A cached snapshot is
not a live retrieval; `retrieval_mode` makes that distinction visible.

When presenting `text` as verbatim, preserve its numbering, punctuation and blank lines.
If the presentation is shortened or reflowed, label it as an excerpt or summary; the
section hash then applies to the packet field, not to the altered display.

The complete JSON/text/HTML responses remain in the connector cache. The assistant should
normally receive only the targeted provision and the fields needed to inspect its source.

`attribution` is presentation metadata carried with the packet so a downstream artifact
can identify Sveriges riksdag and preserve the project's non-endorsement statement. It is
not an integrity field and is not included in the section hash.
