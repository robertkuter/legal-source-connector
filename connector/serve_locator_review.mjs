#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareLocatorReviewBundle } from "./prepare_locator_review.mjs";
import { importReviewDecision } from "./locator_review.mjs";
import { loadCachedDocument } from "./sfs_index.mjs";
import {
  defaultCacheDir,
  defaultReviewCaseDir,
  defaultReviewDir,
  defaultReviewStoreDir,
  defaultRunDir,
  resolveUserPath,
} from "./runtime.mjs";

const execFileAsync = promisify(execFile);
const MAX_DECISION_BYTES = 256 * 1024;

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

export async function createReviewServer({ htmlPath, onDecision = null, token = randomBytes(24).toString("hex") }) {
  if (!htmlPath) throw new Error("Review HTML path is required.");
  if (!/^[a-f0-9]{48,}$/i.test(token)) throw new Error("Review token must contain at least 192 bits encoded as hexadecimal.");
  const html = await readFile(resolve(htmlPath));
  const route = `/review/${token}`;
  const server = createServer(async (request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    const expectedHost = `127.0.0.1:${server.address()?.port}`;
    if (request.headers.host !== expectedHost) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    if (request.method === "POST" && request.url === `${route}/decision` && onDecision) {
      const origin = `http://${expectedHost}`;
      if ((request.headers.origin && request.headers.origin !== origin)
        || request.headers["content-type"] !== "application/json") {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ status: "rejected", errors: ["Invalid local decision request."] }));
        return;
      }
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of request) {
          size += chunk.length;
          if (size > MAX_DECISION_BYTES) throw new Error("Decision request is too large.");
          chunks.push(chunk);
        }
        const result = await onDecision(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        response.writeHead(result.status === "completed" ? 200 : 422, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(422, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ status: "rejected", errors: [error.message] }));
      }
      return;
    }
    const getRoute = onDecision ? `${route}?save=1` : route;
    if (request.method !== "GET" || request.url !== getRoute) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": html.byteLength });
    response.end(html);
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve the loopback review address.");
  return {
    host: "127.0.0.1",
    port: address.port,
    route,
    url: `http://127.0.0.1:${address.port}${route}${onDecision ? "?save=1" : ""}`,
    close: () => new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept())),
  };
}

function parseArgs(items) {
  const args = {
    cacheDir: defaultCacheDir(),
    outputDir: resolve(defaultReviewDir(), "prepared"),
    caseDir: defaultReviewCaseDir(),
    storeDir: defaultReviewStoreDir(),
    runDir: defaultRunDir(),
  };
  for (let i = 0; i < items.length; i += 1) {
    if (items[i] === "--file") args.htmlPath = items[++i];
    else if (items[i] === "--source") args.sourceId = items[++i];
    else if (items[i] === "--locator") args.locator = items[++i];
    else if (items[i] === "--cache-dir") args.cacheDir = resolveUserPath(items[++i], args.cacheDir);
    else if (items[i] === "--output-dir") args.outputDir = resolveUserPath(items[++i], args.outputDir);
    else if (items[i] === "--case-dir") args.caseDir = resolveUserPath(items[++i], args.caseDir);
    else if (items[i] === "--review-store") args.storeDir = resolveUserPath(items[++i], args.storeDir);
    else if (items[i] === "--run-dir") args.runDir = resolveUserPath(items[++i], args.runDir);
  }
  return args;
}

export async function completeLocatorReview({ artifact, decision, cacheDir, storeDir, runDir, caseDir }) {
  const sourceId = artifact.source.authority_id;
  const cached = await loadCachedDocument(cacheDir, sourceId);
  const imported = await importReviewDecision({
    artifact, decision, sourceId, document: cached.document, rawFile: cached.rawFile, storeDir,
  });
  if (imported.status !== "imported") return { status: "rejected", errors: imported.errors };
  const { stdout } = await execFileAsync(process.execPath, [
    fileURLToPath(new URL("./get_provision.mjs", import.meta.url)),
    "--source", sourceId,
    "--locator", artifact.locator.requested,
    "--cache-dir", cacheDir,
    "--review-store", storeDir,
    "--run-dir", runDir,
    "--case-dir", caseDir,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const packet = JSON.parse(stdout);
  return {
    status: "completed",
    import_status: imported.status,
    lookup_status: packet.status,
    result_basis: packet.basis ?? "none",
    automatic_capability: packet.capability?.status ?? null,
    canonical_locator: packet.canonical_locator ?? null,
    decision_record_sha256: decision.decision_record_sha256,
    fresh_check_performed: false,
    next_step_for_current_wording: {
      command: ["node", "connector/get_provision.mjs", "--fresh", "--source", sourceId, "--locator", artifact.locator.requested],
      instruction: "The immediate retry used the pinned local snapshot. Run this fresh lookup and use its packet before reporting current wording.",
    },
    packet,
  };
}

export async function main(items = process.argv.slice(2)) {
  const args = parseArgs(items);
  if (!args.htmlPath && !(args.sourceId && args.locator)) {
    console.error("Usage: node connector/serve_locator_review.mjs --source sfs-1995-1554 --locator '7 kap. 7 §' | --file reviews/prepared/<review>/review.html");
    process.exitCode = 2;
    return;
  }
  try {
    const bundle = args.htmlPath ? null : await prepareLocatorReviewBundle(args);
    const artifact = bundle ? JSON.parse(await readFile(bundle.artifact_path, "utf8")) : null;
    let review;
    const onDecision = artifact?.review_disposition?.status === "decision_available"
      ? async (decision) => {
        const result = await completeLocatorReview({ artifact, decision, ...args });
        if (result.status === "completed") {
          console.log(JSON.stringify(result, null, 2));
          setTimeout(() => review.close(), 250);
        }
        return result;
      }
      : null;
    review = await createReviewServer({ htmlPath: args.htmlPath ?? bundle.open_target, onDecision });
    console.log(JSON.stringify({
      status: "serving",
      scope: "one_review_page",
      loopback_only: true,
      no_store: true,
      url: review.url,
      review_disposition: bundle?.review_disposition?.status ?? null,
      artifact_path: bundle?.artifact_path ?? null,
      instruction: onDecision
        ? "Open the URL locally. Save review to validate, import and retry this locator; the process then exits. Ctrl-C cancels."
        : "Open the URL locally to inspect the blocked case. No decision is available; press Ctrl-C when finished.",
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: "not_served", warning: error.message }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
