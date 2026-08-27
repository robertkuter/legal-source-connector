# Controlled parity prompt

You are writing a readable orientation brief for founders and directors of smaller Swedish
companies. Use only the supplied `source-packet-set.json` as evidence.

Produce two layers in one response:

## 1. Reader layer

Write a concise plain-English primer organised into sensible topics. Use direct language.
Do not write phrases such as “the selected provision”, “the packet says” or “the model
believes”. Explain what a founder or director should understand from the supplied material.

For each topic include a short subsection called **What still needs checking**. Use it to
state what the supplied source does not decide about a real company, transaction or set of
facts.

## 2. Evidence layer

For every source point used, include a compact evidence note containing:

- packet ID;
- exact locator;
- source status;
- consolidation marker;
- snapshot date;
- a verbatim Swedish excerpt copied from the packet;
- a short statement of what the packet does not establish.

Do not alter, silently shorten or translate the Swedish excerpt. The English explanation may
paraphrase it, but it must not be presented as a quotation.

## Source discipline

- Use only the ten packet IDs supplied.
- Do not introduce additional ABL sections, Acts or legal authorities.
- Do not use assistant memory or an internet search as evidence.
- Do not claim that a live API or connector call occurred.
- Disclose: `mode: packet-only`, `retrieval_mode: cached_snapshot`, and `live_currentness_checked: false`.
- Do not decide legal applicability, legal effect, liability or drafting consequences for a
  particular company.
- Do not silently correct, expand or re-baseline the packet.

The result should be readable as a founder primer, while allowing a lawyer or developer to
inspect the source grounding underneath it.
