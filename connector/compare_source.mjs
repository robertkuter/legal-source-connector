#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assessComparison } from "./staleness_logic.mjs";
import {
  defaultCacheDir,
  defaultRunDir,
  riksdagenAttribution,
  resolveUserPath,
} from "./runtime.mjs";

function parseArgs(items) {
  const result = { cacheDir: defaultCacheDir(), runDir: defaultRunDir() };
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] === "--baseline") result.baseline = items[++i];
    else if (items[i] === "--source") result.sourceId = items[++i];
    else if (items[i] === "--cache-dir") result.cacheDir = resolveUserPath(items[++i], result.cacheDir);
    else if (items[i] === "--run-dir") result.runDir = resolveUserPath(items[++i], result.runDir);
  }
  return result;
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function currencySignal(...values) {
  const joined = values.map((value) => String(value ?? "").replace(/\s+/g, " ").trim()).join(" ");
  return joined.match(/(?:Ändrad:\s*)?t\.o\.m\.\s*SFS\s+\d{4}:\d+/i)?.[0] ?? null;
}

function findDocument(payload) {
  if (payload?.dokumentstatus?.dokument) return payload.dokumentstatus.dokument;
  if (payload?.dokument?.dokument) return payload.dokument.dokument;
  if (payload?.dokument) return payload.dokument;
  return null;
}

function selectBaseline(payload, sourceId) {
  if (Array.isArray(payload?.sources)) {
    return payload.sources.find((source) => source.source_id === sourceId) ?? null;
  }
  if (payload?.authority_id === sourceId || payload?.source_id === sourceId) return payload;
  return null;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "legal-source-connector-pilot/0.1" },
    });
    const body = await response.text();
    return {
      url,
      http_status: response.status,
      ok: response.ok,
      bytes: Buffer.byteLength(body, "utf8"),
      sha256: sha256(body),
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function retrieveCurrent(sourceId, cacheDir) {
  const retrievedAt = new Date().toISOString();
  const safeTimestamp = retrievedAt.replaceAll(/[:.]/g, "-");
  const sourceDir = join(cacheDir, sourceId);
  await mkdir(sourceDir, { recursive: true });
  const base = `https://data.riksdagen.se/dokument/${sourceId}`;
  const formats = {};
  let document = null;
  let jsonError = null;

  for (const format of ["json", "text"]) {
    try {
      const response = await fetchText(`${base}.${format}`);
      formats[format] = {
        url: response.url,
        http_status: response.http_status,
        ok: response.ok,
        bytes: response.bytes,
        sha256: response.sha256,
      };
      await writeFile(join(sourceDir, `${safeTimestamp}.${format}`), response.body, "utf8");
      if (format === "json" && response.ok) {
        try {
          document = findDocument(JSON.parse(response.body));
          formats.json.currency_signal = currencySignal(
            document?.subtitel,
            document?.subtitle,
            document?.text,
          );
        } catch (error) {
          jsonError = error.message;
        }
      }
      if (format === "text") formats.text.currency_signal = currencySignal(response.body);
    } catch (error) {
      formats[format] = { url: `${base}.${format}`, ok: false, error: error.message };
    }
  }

  const text = document?.text ?? "";
  return {
    source_id: sourceId,
    publisher: "Sveriges riksdag / data.riksdagen.se",
    attribution: riksdagenAttribution(),
    retrieved_at: retrievedAt,
    title: document?.titel ?? document?.title ?? null,
    sfs_number: document?.beteckning ?? document?.sfs_nr ?? null,
    retrieval_status:
      formats.json?.http_status === 200 && formats.text?.http_status === 200
        ? "retrieved"
        : "unknown",
    consolidation_signal:
      formats.text?.currency_signal ?? currencySignal(document?.subtitel, text),
    document_text_length: text.length,
    document_text_sha256: text ? sha256(text) : null,
    formats,
    raw_snapshots: {
      json: `${safeTimestamp}.json`,
      text: `${safeTimestamp}.text`,
    },
    warnings: [
      ...(jsonError ? [`JSON parse/document extraction failed: ${jsonError}`] : []),
      ...(text ? [] : ["No consolidated text was extracted from the JSON response."]),
    ],
  };
}

const args = parseArgs(process.argv.slice(2));
const comparisonAt = new Date().toISOString();
let result;

try {
  if (!args.baseline) throw new Error("Missing --baseline receipt path");
  const baselinePayload = JSON.parse(await readFile(args.baseline, "utf8"));
  const inferredSourceId =
    args.sourceId ?? baselinePayload.authority_id ?? baselinePayload.source_id;
  if (!inferredSourceId) throw new Error("Missing --source and no source ID in baseline receipt");

  const baseline = selectBaseline(baselinePayload, inferredSourceId);
  if (!baseline) throw new Error(`Baseline receipt has no source entry for ${inferredSourceId}`);
  const current = await retrieveCurrent(inferredSourceId, args.cacheDir);
  const assessment = assessComparison({ baseline, current, sourceId: inferredSourceId });
  const baselineHash = baseline.document_text_sha256 ?? baseline.source_text_sha256 ?? null;
  const baselineCurrency = baseline.consolidation_signal ?? null;

  result = {
    comparison_version: "0.1",
    ...assessment,
    compared_at: comparisonAt,
    baseline: {
      receipt: args.baseline,
      retrieved_at: baseline.retrieved_at ?? null,
      title: baseline.title ?? null,
      sfs_number: baseline.sfs_number ?? baseline.source_id ?? null,
      consolidation_signal: baselineCurrency,
      document_text_sha256: baselineHash,
    },
    current,
    note: "Comparison only; no automatic re-baselining and no legal applicability determination.",
  };
} catch (error) {
  result = {
    comparison_version: "0.1",
    status: "unknown",
    reason: error.message,
    compared_at: comparisonAt,
    baseline: args.baseline ?? null,
    source_id: args.sourceId ?? null,
    note: "Comparison only; no automatic re-baselining and no legal applicability determination.",
  };
}

await mkdir(args.runDir, { recursive: true });
const runPath = join(args.runDir, `staleness-${comparisonAt.replaceAll(/[:.]/g, "-")}.json`);
await writeFile(runPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ run_receipt: runPath, ...result }, null, 2));
