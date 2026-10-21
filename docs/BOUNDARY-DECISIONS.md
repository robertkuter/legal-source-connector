# Boundary decisions (v0.2.0)

Code comments and docs refer to these decisions and findings by number. Each one follows the
same principle: the publisher's own markup (Riksdagen's HTML) decides where a provision and its
parts start and end; the plain text supplies the words.

## Findings

- **C9** (October 2026): a provision's text could run on into the next section's heading, for
  example ABL `29 kap. 1 §` ended with the heading of `29 kap. 2 §`. In the cached test set this
  affected 281 provisions in 12 Acts. Fixed by D011.
- **C11** (October 2026): in seven provisions (ABL `20 kap. 12 §`, `20 kap. 36 §`, `23 kap. 56 §`,
  `24 kap. 61 §`, `25 kap. 51 §`, `28 kap. 4 §`; ÅRL `7 kap. 31 g §`) the publisher prints the next
  heading as plain text right after the amendment marker. Fixed by D015.

## Decisions

**D011: a section stops before the publisher's headings; headings are structure.** The headings
between two paragraph anchors in the HTML introduce the next section. Working back from the next
section's start, a trailing paragraph is removed only when it equals the next expected heading;
the section's first paragraph is never removed, and a heading-like line that is not a heading
(for example the reference list inside ÅRL `7 kap. 7 §`) stays statute text. The index records
each section's chapter title and the headings directly before it.

**D012: a section starts only at a publisher anchor; an unmatched heading blocks.** A text line
that reads "N §" starts a section only where the HTML has a paragraph anchor. Lines such as
"3 a § om väsentlighet," inside a provision are in-text references and stay part of it, which is
why Årsredovisningslagen is now confirmed. If a heading between two sections cannot be found in
the text, the section before it is held rather than returned with an uncertain end.

**D013: held text is shown with an explanation.** When a provision cannot be confirmed, the
packet still shows the published text, labelled unverified, with the reason. A section printed
inside another section's text is held.

**D014: stycke and punkt addresses, cross-references and the amendment marker.** A lookup can ask
for "13 kap. 6 § andra stycket 2" (also "2 st. 2 p.", "punkt 2"); the stycke boundaries come from
the publisher's `…S2`, `…S3` markers and must match the plain text exactly. The result arrives in
an additional `subdivision` field; existing fields keep their meaning. References such as
"enligt 30 §" or "7 kap. 28 § tredje stycket" are resolved to their anchors; references to other
Acts are marked external, and any internal reference that cannot be placed is listed with a
reason. `last_amended_by` is the latest "Lag (YYYY:NNN)." marker printed in the section: source
evidence for dating, not a commencement date. In an Act's last section the transitional
provisions follow an "Övergångsbestämmelser" heading inside the same span; the stycken end there.

**D015: a heading-shaped tail after the amendment marker ends the section.** Outside an Act's
last section, text after the last "Lag (…)." marker is cut when it is shaped like a heading (at
most 120 characters, no §, no finite verb, no closing full stop except "m.m."/"m.fl."), and it
becomes the next section's heading. Text that fails this test stays and is flagged.

Still held on purpose: provisions with outgoing and incoming versions (`U:`/`I:`), shown side by
side and never chosen; and sources where the publisher's text and HTML disagree, such as
Upphovsrättslagen `7 kap. 53 g §`.
