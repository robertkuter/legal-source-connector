import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtureRoot = new URL("./fixtures/riksdagen/", import.meta.url).pathname;

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

export async function stagePinnedFixture(sourceId, stamp) {
  const fixtureDir = join(fixtureRoot, sourceId, stamp);
  const provenance = JSON.parse(await readFile(join(fixtureDir, "provenance.json"), "utf8"));
  if (provenance.source_id !== sourceId || provenance.original_snapshot !== stamp) {
    throw new Error(`Pinned fixture identity differs from ${sourceId}/${stamp}`);
  }
  const bodies = await Promise.all(["json", "text", "html"]
    .map((format) => readFile(join(fixtureDir, `${stamp}.${format}`))));
  for (const [position, format] of ["json", "text", "html"].entries()) {
    if (sha256(bodies[position]) !== provenance.excerpt_sha256[format]) {
      throw new Error(`Pinned fixture ${sourceId}/${stamp}.${format} does not match provenance`);
    }
  }
  const document = JSON.parse(bodies[0]).dokumentstatus?.dokument;
  const expectedNumber = sourceId.replace(/^sfs-(\d{4})-(\d+)$/, "$1:$2");
  if (document?.beteckning !== expectedNumber
    || document.text !== bodies[1].toString("utf8")
    || document.html !== bodies[2].toString("utf8")) {
    throw new Error(`Pinned fixture ${sourceId}/${stamp} has inconsistent payload formats`);
  }
  const cacheDir = await mkdtemp(join(tmpdir(), `lsc-pinned-${sourceId}-`));
  const sourceDir = join(cacheDir, sourceId);
  await mkdir(sourceDir);
  await Promise.all(["json", "text", "html"].map((format) => copyFile(
    join(fixtureDir, `${stamp}.${format}`),
    join(sourceDir, `${stamp}.${format}`),
  )));
  return { cacheDir, sourceId, rawFile: `${stamp}.json`, provenance };
}
