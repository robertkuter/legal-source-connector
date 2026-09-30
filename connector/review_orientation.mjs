// Presentation only. The artifact disposition and validator decide whether a review is allowed.
export function buildReviewOrientation(artifact) {
  const signals = new Set((artifact.review_signals ?? []).map((signal) => signal.kind));
  if (artifact.review_disposition.status === "decision_available") {
    const intervening = artifact.review_context.intervening_text_candidates ?? [];
    const difference = artifact.automatic_capability.text_candidate_count
      - artifact.automatic_capability.html_anchor_count;
    const localEvidence = intervening.length
      ? `${intervening.length} heading-like ${intervening.length === 1 ? "line sits" : "lines sit"} inside the proposed provision${difference === intervening.length ? `, matching the source's net +${difference} count gap` : ""}.`
      : "At this locator, one publisher anchor and both provision boundaries can be reproduced. The source-map mismatch is outside this proposed extraction.";
    return {
      kind: intervening.length ? "intervening_text" : "reproducible_boundary",
      localEvidence,
      evidenceLink: intervening.length ? "See the yellow-highlighted source lines" : null,
      evidenceTarget: intervening.length ? "trigger-evidence" : null,
      limit: signals.has("identity_order_difference")
        ? "This local review does not clear the separate identity or order warning."
        : "This local review does not clear source-wide mismatches.",
    };
  }

  const views = artifact.explanation_context?.reading_views ?? [];
  let kind = "unsupported_structure";
  let localEvidence = "The available source coordinates do not establish a reviewable provision boundary.";
  if (signals.has("temporal_layer") && artifact.review_signals.some((signal) => signal.kind === "temporal_layer" && signal.blocks_decision)) {
    kind = "temporal_versions";
    localEvidence = "The source presents timing-marked alternatives that this structural review cannot select between.";
  } else if (signals.has("renumbering_editorial_notice")) {
    kind = "renumbering_notice";
    localEvidence = "The publisher shows an editorial renumbering notice alongside another passage at this locator.";
  } else if (signals.has("duplicate_publisher_identity")) {
    kind = "duplicate_identity";
    localEvidence = "More than one publisher-backed passage uses this locator.";
  } else if (signals.has("broken_boundary") || signals.has("missing_text_candidate")) {
    kind = "incomplete_boundary";
    localEvidence = "A matching start or neighbouring boundary cannot be reproduced safely.";
  }
  return {
    kind,
    localEvidence,
    evidenceLink: views.length ? "Compare the unselected source candidates" : "Inspect the available source context",
    evidenceTarget: "source-evidence",
    limit: "No structural confirmation is available for this locator.",
  };
}

// Presentation questions for a decision-available locator. The artifact and validator
// still decide whether a decision is permitted and which source bytes it binds to.
export function buildReviewQuestions(artifact) {
  if (artifact?.review_disposition?.status !== "decision_available"
    || artifact?.review_disposition?.decision_allowed !== true) return [];
  const locator = artifact.locator.canonical;
  const anchor = artifact.publisher_anchor.name;
  const interveningCount = artifact.review_context.intervening_text_candidates?.length ?? 0;
  const next = artifact.boundary.next_publisher_anchor;
  const nextLocator = next
    ? `${next.chapter ? `${next.chapter} kap. ` : ""}${next.section} §`
    : null;
  const questions = [{
    id: "start",
    text: `Does publisher anchor ${anchor} match the start of ${locator} in the displayed source text?`,
  }];
  if (interveningCount) questions.push({
    id: "inside",
    text: `Are the ${interveningCount} highlighted heading-like ${interveningCount === 1 ? "line" : "lines"} inside ${locator}, rather than separate provisions?`,
  });
  questions.push({
    id: "stop",
    text: next
      ? `Does the proposed text stop before ${nextLocator} at publisher anchor ${next.name}?`
      : "Does the proposed text continue to the end of the available source without crossing another provision?",
  });
  return questions;
}
