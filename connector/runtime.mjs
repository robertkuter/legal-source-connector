import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function riksdagenAttribution() {
  return {
    text: "Källa: Sveriges riksdag",
    non_endorsement: "This project is independent and is not produced, endorsed or sponsored by Sveriges riksdag.",
  };
}

export function defaultCacheDir() {
  return join(PROJECT_ROOT, "cache", "riksdagen");
}

export function defaultRunDir() {
  return join(PROJECT_ROOT, "runs");
}

export function resolveUserPath(value, fallback) {
  return value ? resolve(value) : fallback;
}

export function safeFileSegment(value, fallback = "item") {
  const segment = String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return segment || fallback;
}

export async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
  return path;
}
