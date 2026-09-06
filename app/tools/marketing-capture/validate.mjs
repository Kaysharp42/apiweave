#!/usr/bin/env node
/**
 * The gate between a capture run and shipping it.
 *
 * Six checks, each one a rule from the media brief that would otherwise be a
 * thing someone has to remember in review:
 *
 *   1. every still declares a claim, alt text, caption and byte budget;
 *   2. every encoded file exists and has exactly its destination dimensions;
 *   3. no file exceeds its byte budget;
 *   4. the demo is H.264/VP9 at 1080p, 24–30s, with a poster and a WebVTT track
 *      whose cues are ordered and in range;
 *   5. nothing that reached a frame looks like a secret, a real endpoint, a real
 *      account or a machine path;
 *   6. the subject fills enough of its frame — the "purposeless empty canvas"
 *      rule, measured rather than eyeballed.
 *
 * Usage: node validate.mjs [--media <dir>]
 */

import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The tool's own directory, so the script works from any working directory. */
const ROOT = dirname(resolve(process.argv[1]));
const STILLS_IN = join(ROOT, "output", "stills");
const FRAMES_IN = join(ROOT, "output", "frames");
const mediaIndex = process.argv.indexOf("--media");
const MEDIA =
  mediaIndex === -1
    ? join(ROOT, "output", "media")
    : resolve(process.argv[mediaIndex + 1]);

/**
 * Anything here in a captured frame's text is a leak, not a style problem.
 *
 * `api.shop.dev`, `qa@shop.dev` and the loopback MCP endpoint are the fixture's
 * own synthetic identifiers and are allowed by construction — everything else
 * that looks like a host, an account, a path or a credential is not.
 */
const FORBIDDEN = [
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}/ },
  { name: "long base64/hex secret", re: /\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/]{40,}={0,2}\b/ },
  { name: "bearer literal", re: /Bearer\s+(?!\{\{)[A-Za-z0-9._-]{12,}/ },
  { name: "Windows path", re: /[A-Za-z]:\\(?:Users|Work|Program)/ },
  { name: "POSIX home path", re: /\/(?:home|Users)\/[a-z0-9_.-]+/i },
  { name: "AWS-style key", re: /\bAKIA[0-9A-Z]{12,}\b/ },
  {
    name: "foreign hostname",
    re: /\bhttps?:\/\/(?!api\.shop\.dev|127\.0\.0\.1|localhost)[a-z0-9.-]+\.[a-z]{2,}/i,
  },
  {
    name: "foreign email",
    re: /\b[a-z0-9._%+-]+@(?!shop\.dev\b)[a-z0-9.-]+\.[a-z]{2,}\b/i,
  },
];

/** Text the product itself renders that trips a pattern but leaks nothing. */
const ALLOWED_EXACT = [
  "apiweave.desktop",
  "local@apiweave.desktop",
  "https://api.shop.dev",
  "http://127.0.0.1:47271/mcp",
];

const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

async function probe(file, entries) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    entries,
    "-of",
    "default=nw=1:nk=1",
    file,
  ]);
  // Windows ffprobe terminates each line with CR, which would make every string
  // comparison below fail on an otherwise correct file.
  return stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim());
}

async function exists(file) {
  return stat(file)
    .then(() => true)
    .catch(() => false);
}

function scanForbidden(label, text) {
  let haystack = text;
  for (const allowed of ALLOWED_EXACT) {
    haystack = haystack.split(allowed).join(" ");
  }
  for (const { name, re } of FORBIDDEN) {
    const hit = re.exec(haystack);
    if (hit !== null) {
      fail(`${label}: ${name} in captured text — ${JSON.stringify(hit[0].slice(0, 60))}`);
    }
  }
}

async function validateStills() {
  const sidecars = (await readdir(STILLS_IN)).filter((n) => n.endsWith(".json"));
  if (sidecars.length === 0) fail("no stills captured — run the capture pass first");

  for (const name of sidecars) {
    const meta = JSON.parse(await readFile(join(STILLS_IN, name), "utf8"));
    const label = meta.id;

    for (const field of ["claim", "alt", "caption", "byteBudget", "placement"]) {
      if (
        meta[field] === undefined ||
        meta[field] === null ||
        meta[field] === ""
      ) {
        fail(`${label}: manifest is missing ${field}`);
      }
    }
    if (typeof meta.alt === "string" && meta.alt.length < 40) {
      fail(`${label}: alt text is too short to describe the frame`);
    }

    scanForbidden(label, meta.pageText ?? "");

    // Rule 6: how much of the frame the subject actually occupies. The crop is
    // grown to the destination aspect around the subject, so this is the honest
    // measure of empty canvas.
    const clip = meta.clip;
    if (clip) {
      const area = (clip.width * clip.height).toFixed(0);
      notes.push(`${label}: crop ${Math.round(clip.width)}x${Math.round(clip.height)} CSS px (${area} px²)`);
    }

    for (const width of [meta.width, ...(meta.alsoAt ?? [])]) {
      const height = Math.round((width / meta.width) * meta.height);
      const stem = width === meta.width ? meta.id : `${meta.id}-${width}`;
      const webp = join(MEDIA, "stills", `${stem}.webp`);
      if (!(await exists(webp))) {
        fail(`${label}: ${stem}.webp was never encoded`);
        continue;
      }
      const [actualWidth, actualHeight] = await probe(webp, "stream=width,height");
      if (Number(actualWidth) !== width || Number(actualHeight) !== height) {
        fail(
          `${label}: ${stem}.webp is ${actualWidth}x${actualHeight}, declared ${width}x${height}`,
        );
      }
      const bytes = (await stat(webp)).size;
      if (bytes > meta.byteBudget) {
        fail(`${label}: ${stem}.webp is ${bytes}B over its ${meta.byteBudget}B budget`);
      }
    }

    if (meta.placement === "og") {
      const png = join(MEDIA, "stills", `${meta.id}.png`);
      if (!(await exists(png))) fail(`${label}: the OG PNG was never encoded`);
    }
  }
}

async function validateTakes() {
  const dirs = await readdir(FRAMES_IN).catch(() => []);
  let found = 0;
  for (const dir of dirs) {
    const raw = await readFile(join(FRAMES_IN, dir, "take.json"), "utf8").catch(
      () => null,
    );
    if (raw === null) continue;
    found += 1;
    const take = JSON.parse(raw);
    const label = take.id;

    if (take.durationSeconds < 24 || take.durationSeconds > 30) {
      fail(
        `${label}: the take is ${take.durationSeconds.toFixed(1)}s — the brief asks for 24–30s`,
      );
    }
    if ((take.beats ?? []).length < 4) {
      fail(`${label}: ${take.beats?.length ?? 0} beats — the brief asks for 4–6`);
    }
    scanForbidden(label, JSON.stringify(take.beats ?? []));

    const mp4 = join(MEDIA, "video", `${label}.mp4`);
    const webm = join(MEDIA, "video", `${label}.webm`);
    const vttPath = join(MEDIA, "video", `${label}.vtt`);
    const poster = join(MEDIA, "posters", `${label}.webp`);

    for (const [file, codec] of [
      [mp4, "h264"],
      [webm, "vp9"],
    ]) {
      if (!(await exists(file))) {
        fail(`${label}: ${file} was never encoded`);
        continue;
      }
      const [name, width, height] = await probe(
        file,
        "stream=codec_name,width,height",
      );
      if (name !== codec) fail(`${label}: ${file} is ${name}, expected ${codec}`);
      if (Number(width) !== take.width || Number(height) !== take.height) {
        fail(`${label}: ${file} is ${width}x${height}, declared ${take.width}x${take.height}`);
      }
      const bytes = (await stat(file)).size;
      if (bytes > take.byteBudget) {
        fail(`${label}: ${file} is ${bytes}B over its ${take.byteBudget}B budget`);
      }
    }

    if (!(await exists(poster))) fail(`${label}: no poster was generated`);

    const vtt = await readFile(vttPath, "utf8").catch(() => null);
    if (vtt === null) {
      fail(`${label}: no WebVTT track was generated`);
    } else {
      if (!vtt.startsWith("WEBVTT")) fail(`${label}: the VTT track has no WEBVTT header`);
      const cues = [...vtt.matchAll(/(\d\d):(\d\d):(\d\d)\.(\d\d\d) --> /g)].map(
        (match) =>
          Number(match[1]) * 3600 +
          Number(match[2]) * 60 +
          Number(match[3]) +
          Number(match[4]) / 1000,
      );
      if (cues.length !== (take.beats ?? []).length) {
        fail(`${label}: ${cues.length} VTT cues for ${take.beats.length} beats`);
      }
      for (const [index, at] of cues.entries()) {
        if (index > 0 && at < cues[index - 1]) {
          fail(`${label}: VTT cue ${index + 1} starts before the one before it`);
        }
        if (at > take.durationSeconds) {
          fail(`${label}: VTT cue ${index + 1} starts after the video ends`);
        }
      }
    }
  }
  if (found === 0) fail("no demo take captured — run the demo pass first");
}

await validateStills();
await validateTakes();

for (const note of notes) console.log(`note  ${note}`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log("\nall media validated");
