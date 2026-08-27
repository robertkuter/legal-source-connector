function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function currencyKey(value) {
  return compactText(value).replace(/^Ändrad:\s*/i, "").toLocaleLowerCase("sv-SE");
}

export function assessComparison({ baseline, current, sourceId }) {
  const baselineHash = baseline.document_text_sha256 ?? baseline.source_text_sha256 ?? null;
  const baselineCurrency = baseline.consolidation_signal ?? null;
  const baselineCurrencyKey = currencyKey(baselineCurrency);
  const currentCurrencyKey = currencyKey(current.consolidation_signal);
  const identityMatches =
    !baseline.sfs_number || !current.sfs_number || baseline.sfs_number === current.sfs_number;
  const contentChanged = Boolean(baselineHash && current.document_text_sha256)
    && baselineHash !== current.document_text_sha256;
  const consolidationChanged = Boolean(baselineCurrencyKey && currentCurrencyKey)
    && baselineCurrencyKey !== currentCurrencyKey;

  let status = "unknown";
  let reason = "The comparison could not establish a reliable source comparison.";
  if (current.retrieval_status !== "retrieved") {
    reason = "The fresh official retrieval did not return both JSON and text successfully.";
  } else if (!identityMatches) {
    reason = "The baseline and fresh retrieval identify different SFS sources.";
  } else if (!baselineHash) {
    reason = "The baseline receipt has no complete-source hash.";
  } else if (contentChanged || consolidationChanged) {
    status = "stale";
    reason = contentChanged
      ? "The complete consolidated source text changed."
      : "The publisher's consolidation marker changed.";
  } else if (baselineHash === current.document_text_sha256) {
    status = "current";
    reason = "The complete consolidated source text matches the pinned receipt.";
  }

  return {
    status,
    reason,
    source_id: sourceId,
    changes: {
      identity_matches: identityMatches,
      content_changed: contentChanged,
      consolidation_changed: consolidationChanged,
      baseline_currency_key: baselineCurrencyKey || null,
      current_currency_key: currentCurrencyKey || null,
    },
  };
}
