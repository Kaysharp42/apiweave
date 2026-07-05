import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const tempDir = await mkdtemp(join(tmpdir(), "apiweave-parity-"));
const outfile = join(tempDir, "parity-runner.mjs");

try {
  await build({
    bundle: true,
    entryPoints: [resolve("core/runner/harness/parity-runner.ts")],
    format: "esm",
    logLevel: "silent",
    outfile,
    platform: "node",
    target: "node24",
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(tempDir, { force: true, recursive: true });
}
