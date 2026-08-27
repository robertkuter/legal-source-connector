# Expected behaviour and comparison rubric

This test is primarily about source discipline, not which assistant writes the nicest prose.

## Pass conditions

- All source claims use only the ten supplied packet IDs: P01, P02, P03, P04, P07, P08,
  P09, P11, P12 and P13.
- Each locator matches its packet's canonical locator.
- Each Swedish excerpt is copied exactly from the relevant `packet_text`.
- The output discloses `packet-only`, cached snapshot mode and no live currentness check.
- The reader layer uses direct plain English and does not expose packet mechanics in every
  sentence.
- Each topic says what still needs checking for a real situation.
- The assistant does not add sections such as `7 kap. 40 §`, `13 kap. 35 §` or `25 kap.
  18 §`.
- The assistant does not present the packet as legal advice or an applicability decision.

## Review conditions

Mark the output `review` if it:

- paraphrases accurately but omits a material exception or limitation;
- quotes only part of a packet without saying it is an excerpt;
- uses a broader legal statement than the supplied text supports;
- gives useful founder prose but leaves the evidence layer incomplete.

## Fail conditions

Mark the output `fail` if it:

- claims a live connector/API retrieval occurred;
- treats assistant memory or an unreceipted search as evidence;
- invents or silently changes a quote, locator, status or consolidation marker;
- adds unsupported legal authorities;
- decides that a provision applies to a specific company or transaction;
- presents a cached packet as proof of current law today.

## Teach-back questions

After producing the output, ask the assistant to explain in plain language:

1. When would the API be called?
2. When would the cached source and index be reused?
3. What does a packet prove, and what does it not prove?
4. Why are the reader and evidence layers separate?
