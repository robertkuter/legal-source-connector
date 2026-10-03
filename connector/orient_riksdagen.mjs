#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultCacheDir,
  defaultRunDir,
  riksdagenAttribution,
  resolveUserPath,
} from "./runtime.mjs";

function parseArgs(items) {
  const result = { cases: [], globalLocators: [], cacheDir: defaultCacheDir(), runDir: defaultRunDir() };
  let currentCase = null;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item === "--source") {
      currentCase = { sourceId: items[++i], locators: [] };
      result.cases.push(currentCase);
    } else if (item === "--locator") {
      const locator = items[++i];
      if (currentCase) currentCase.locators.push(locator);
      else result.globalLocators.push(locator);
    }
    else if (item === "--cache-dir") result.cacheDir = resolveUserPath(items[++i], result.cacheDir);
    else if (item === "--run-dir") result.runDir = resolveUserPath(items[++i], result.runDir);
    else if (item === "--help") result.help = true;
  }
  return result;
}

function printHelp() {
  console.log(`Usage: node connector/orient_riksdagen.mjs [options]

Options:
  --source <id>       Repeatable, e.g. sfs-2005-551
  --locator <text>    Repeatable; applies to the most recent --source
  --cache-dir <path>  Default: cache/riksdagen
  --run-dir <path>    Default: runs
`);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function findDocument(payload) {
  if (payload?.dokumentstatus?.dokument) return payload.dokumentstatus.dokument;
  if (payload?.dokument?.dokument) return payload.dokument.dokument;
  if (payload?.dokument) return payload.dokument;
  if (payload?.dokumentlista?.dokument) return payload.dokumentlista.dokument;
  return null;
}

function currencySignal(...values) {
  const joined = values.map(compactText).join(" ");
  return joined.match(/(?:Ändrad:\s*)?t\.o\.m\.\s*SFS\s+\d{4}:\d+/i)?.[0] ?? null;
}

function locatorPresent(text, locator) {
  const normalizedText = compactText(text).toLocaleLowerCase("sv-SE");
  const normalizedLocator = compactText(locator).toLocaleLowerCase("sv-SE");
  return normalizedText.includes(normalizedLocator);
}

async function fetchText(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "user-agent": "legal-source-connector-pilot/0.1" },
    });
    const body = await response.text();
    return {
      url,
      httpStatus: response.status,
      ok: response.ok,
      body,
      bytes: Buffer.byteLength(body, "utf8"),
      sha256: sha256(body),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectSource(sourceId, locators, cacheDir, fetchImpl = fetch) {
  const base = `https://data.riksdagen.se/dokument/${sourceId}`;
  const retrievedAt = new Date().toISOString();
  const safeTimestamp = retrievedAt.replaceAll(/[:.]/g, "-");
  const sourceDir = join(cacheDir, sourceId);
  await mkdir(sourceDir, { recursive: true });

  const formats = {};
  let document = null;
  let jsonError = null;
  for (const format of ["json", "text", "html"]) {
    const url = `${base}.${format}`;
    try {
      const response = await fetchText(url, fetchImpl);
      formats[format] = {
        url: response.url,
        http_status: response.httpStatus,
        ok: response.ok,
        bytes: response.bytes,
        sha256: response.sha256,
      };
      if (format === "json" && response.ok) {
        try {
          document = findDocument(JSON.parse(response.body));
          if (!document?.text) throw new Error("The JSON response has no consolidated text.");
          const sourceMatch = sourceId.match(/^sfs-(\d{4})-(\d+)$/);
          if (sourceMatch && document.beteckning !== `${sourceMatch[1]}:${sourceMatch[2]}`) {
            throw new Error("The JSON response has a different SFS identity.");
          }
          await writeFile(join(sourceDir, `${safeTimestamp}.${format}`), response.body, "utf8");
          formats.json.currency_signal = currencySignal(
            document?.subtitel,
            document?.subtitle,
            document?.text,
          );
        } catch (error) {
          document = null;
          jsonError = error.message;
        }
      }
      if (format !== "json" && response.ok) {
        await writeFile(join(sourceDir, `${safeTimestamp}.${format}`), response.body, "utf8");
      }
      if (format !== "json") {
        formats[format].currency_signal = currencySignal(response.body);
      }
    } catch (error) {
      formats[format] = { url, ok: false, error: error.message };
    }
  }

  const title = document?.titel ?? document?.title ?? null;
  const sfsNumber = document?.beteckning ?? document?.sfs_nr ?? null;
  const subtitle = document?.subtitel ?? document?.subtitle ?? null;
  const consolidatedText = document?.text ?? "";
  const textCurrencySignal = formats.text?.currency_signal ?? null;
  const result = {
    source_id: sourceId,
    publisher: "Sveriges riksdag / data.riksdagen.se",
    attribution: riksdagenAttribution(),
    retrieved_at: retrievedAt,
    title,
    sfs_number: sfsNumber,
    retrieval_status: document?.text && formats.json?.ok && formats.text?.ok ? "retrieved" : "unknown",
    consolidation_signal: textCurrencySignal ?? currencySignal(subtitle, consolidatedText),
    document_text_length: consolidatedText.length,
    document_text_sha256: consolidatedText ? sha256(consolidatedText) : null,
    formats,
    locator_checks: locators.map((locator) => ({
      locator,
      contains_in_json_text: locatorPresent(consolidatedText, locator),
      note: "Orientation check only; exact section extraction is a later stage.",
    })),
    warnings: [
      ...(jsonError ? [`JSON parse/document extraction failed: ${jsonError}`] : []),
      ...(consolidatedText ? [] : ["No consolidated text was extracted from the JSON response."]),
    ],
  };
  return result;
}

export async function main(items = process.argv.slice(2)) {
  const args = parseArgs(items);
  if (args.help) {
    printHelp();
    return;
  }

  const cases = args.cases.length ? args.cases : [{ sourceId: "sfs-2005-551", locators: ["13 kap. 6 §"] }];
  const retrieved = [];
  for (const testCase of cases) {
    try {
      const locators = testCase.locators.length ? testCase.locators : args.globalLocators;
      retrieved.push(await inspectSource(testCase.sourceId, locators, args.cacheDir));
    } catch (error) {
      retrieved.push({ source_id: testCase.sourceId, status: "unknown", error: error.message });
    }
  }

  const receipt = {
    receipt_version: "0.1",
    run_id: new Date().toISOString(),
    purpose: "Riksdagen API orientation; not legal advice",
    sources: retrieved,
  };
  await mkdir(args.runDir, { recursive: true });
  const runPath = join(args.runDir, `riksdagen-orientation-${receipt.run_id.replaceAll(/[:.]/g, "-")}.json`);
  await writeFile(runPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ run_receipt: runPath, ...receipt }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
