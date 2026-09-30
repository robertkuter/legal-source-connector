function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function currencyKey(value) {
  return compactText(value).replace(/^Ändrad:\s*/i, "").toLocaleLowerCase("sv-SE");
}

export function assessComparison({ baseline, current, sourceId }) {
  const baselineHash = baseline.document_text_sha256 ?? baseline.source_text_sha256 ?? null;
  const baselineHtmlHash = baseline.document_html_sha256 ?? baseline.source_html_sha256 ?? null;
  const baselineCurrency = baseline.consolidation_signal ?? null;
  const baselineCurrencyKey = currencyKey(baselineCurrency);
  const currentCurrencyKey = currencyKey(current.consolidation_signal);
  const requested = String(sourceId ?? "").match(/^sfs-(\d{4})-(\d+)$/);
  const expectedNumber = requested ? `${requested[1]}:${requested[2]}` : null;
  const identityMatches = Boolean(current.sfs_number)
    && (!baseline.sfs_number || baseline.sfs_number === current.sfs_number)
    && (!expectedNumber || expectedNumber === current.sfs_number);
  const contentChanged = Boolean(baselineHash && current.document_text_sha256)
    && baselineHash !== current.document_text_sha256;
  const htmlChanged = Boolean(baselineHtmlHash && current.document_html_sha256)
    && baselineHtmlHash !== current.document_html_sha256;
  const consolidationChanged = Boolean(baselineCurrencyKey && currentCurrencyKey)
    && baselineCurrencyKey !== currentCurrencyKey;

  let status = "unknown";
  let reason = "The comparison could not establish a reliable source comparison.";
  if (current.retrieval_status !== "retrieved") {
    reason = "The fresh official retrieval did not return complete JSON, text and HTML successfully.";
  } else if (!identityMatches) {
    reason = "The baseline and fresh retrieval identify different SFS sources.";
  } else if (!baselineHash) {
    reason = "The baseline receipt has no complete-source hash.";
  } else if (baselineHtmlHash && !current.document_html_sha256) {
    reason = "The fresh official retrieval has no HTML hash for the baseline comparison.";
  } else if (contentChanged || htmlChanged || consolidationChanged) {
    status = "stale";
    reason = contentChanged
      ? "The complete consolidated source text changed."
      : htmlChanged
        ? "The publisher HTML structure changed."
        : "The publisher's consolidation marker changed.";
  } else if (baselineHash === current.document_text_sha256) {
    status = "current";
    reason = baselineHtmlHash
      ? "The complete consolidated text and publisher HTML match the pinned receipt."
      : "The complete consolidated text matches the pinned receipt; no baseline HTML hash was available.";
  }

  return {
    status,
    reason,
    source_id: sourceId,
    changes: {
      identity_matches: identityMatches,
      content_changed: contentChanged,
      html_changed: htmlChanged,
      comparison_scope: baselineHtmlHash ? "text_and_html" : "text_only",
      consolidation_changed: consolidationChanged,
      baseline_currency_key: baselineCurrencyKey || null,
      current_currency_key: currentCurrencyKey || null,
    },
  };
}
