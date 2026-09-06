#!/usr/bin/env node
/**
 * Turns the capture pass output into the files the marketing site ships.
 *
 * Stills: every PNG is resampled to its destination size (and to each responsive
 * width in `alsoAt`) and encoded to WebP and AVIF. Nothing is ever scaled up —
 * `safeCrop` guarantees the capture is at least the destination size, and this
 * asserts it again rather than trusting that.
 *
 * Demo: the frame sequence is rebuilt from its real per-frame timestamps through
 * ffmpeg's concat demuxer, so a three-second hold costs one frame rather than
 * ninety, and the result is H.264 MP4 plus VP9 WebM at a constant 30fps. The
 * poster is the frame at the run's green beat, and the WebVTT track is generated
 * from the same beat table the take recorded.
 *
 * Usage: node encode.mjs [--out <dir>]
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** The tool's own directory, so the script works from any working directory. */
const ROOT = dirname(resolve(process.argv[1]));
const STILLS_IN = join(ROOT, "output", "stills");
const FRAMES_IN = join(ROOT, "output", "frames");
const outIndex = process.argv.indexOf("--out");
const OUT =
  outIndex === -1
    ? join(ROOT, "output", "media")
    : resolve(process.argv[outIndex + 1]);

/** ffmpeg's own scaler, with the sharper Lanczos kernel for UI downscales. */
const SCALE = (width, height) =>
  `scale=${width}:${height}:flags=lanczos`;

async function ffmpeg(args) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    maxBuffer: 1 << 26,
  });
}

async function probeSize(file) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    file,
  ]);
  const [width, height] = stdout.trim().split(",").map(Number);
  return { width, height };
}

async function encodeStills() {
  const files = (await readdir(STILLS_IN)).filter((name) => name.endsWith(".json"));
  const results = [];
  for (const name of files) {
    const meta = JSON.parse(await readFile(join(STILLS_IN, name), "utf8"));
    const source = join(STILLS_IN, `${meta.id}.png`);
    const captured = await probeSize(source);
    if (captured.width < meta.width || captured.height < meta.height) {
      throw new Error(
        `${meta.id}: captured ${captured.width}x${captured.height} is smaller ` +
          `than its ${meta.width}x${meta.height} destination — the crop would ` +
          "have to be upscaled",
      );
    }

    for (const width of [meta.width, ...(meta.alsoAt ?? [])]) {
      const height = Math.round((width / meta.width) * meta.height);
      const stem = width === meta.width ? meta.id : `${meta.id}-${width}`;
      const webp = join(OUT, "stills", `${stem}.webp`);
      const avif = join(OUT, "stills", `${stem}.avif`);
      await ffmpeg([
        "-i",
        source,
        "-vf",
        SCALE(width, height),
        "-quality",
        "82",
        "-compression_level",
        "6",
        webp,
      ]);
      await ffmpeg([
        "-i",
        source,
        "-vf",
        SCALE(width, height),
        "-crf",
        "30",
        "-cpu-used",
        "4",
        avif,
      ]);
      results.push({
        id: stem,
        of: meta.id,
        width,
        height,
        webpBytes: (await stat(webp)).size,
        avifBytes: (await stat(avif)).size,
        byteBudget: meta.byteBudget,
      });
    }

    // The OG image has to be a PNG: the social renderer takes it verbatim.
    if (meta.placement === "og") {
      const png = join(OUT, "stills", `${meta.id}.png`);
      await ffmpeg(["-i", source, "-vf", SCALE(meta.width, meta.height), png]);
      results.push({
        id: `${meta.id}.png`,
        of: meta.id,
        width: meta.width,
        height: meta.height,
        pngBytes: (await stat(png)).size,
        byteBudget: meta.byteBudget,
      });
    }
  }
  return results;
}

function vtt(beats, duration) {
  const stamp = (seconds) => {
    const whole = Math.max(0, seconds);
    const hh = String(Math.floor(whole / 3600)).padStart(2, "0");
    const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, "0");
    const ss = String(Math.floor(whole % 60)).padStart(2, "0");
    const ms = String(Math.round((whole % 1) * 1000)).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  };
  const lines = ["WEBVTT", ""];
  beats.forEach((beat, index) => {
    const end = beats[index + 1]?.at ?? duration;
    lines.push(
      `${index + 1}`,
      `${stamp(beat.at)} --> ${stamp(end)}`,
      `${beat.title}: ${beat.caption}`,
      "",
    );
  });
  return lines.join("\n");
}

async function encodeTakes() {
  const takes = [];
  const dirs = await readdir(FRAMES_IN).catch(() => []);
  for (const dir of dirs) {
    const takePath = join(FRAMES_IN, dir, "take.json");
    const take = JSON.parse(await readFile(takePath, "utf8").catch(() => "null"));
    if (take === null) continue;

    // A fixed 30fps cadence, resolved from the frame timestamps: for each slot
    // the frame that was on screen then. Concat's own `duration` directive is
    // ignored on the final entry, which is a well-known trap that silently
    // stretched the first cut of this video by six seconds — a uniform cadence
    // has no last-entry special case at all.
    const step = 1 / 30;
    const slots = Math.max(1, Math.round(take.durationSeconds / step));
    let cursor = 0;
    const entries = [];
    for (let slot = 0; slot < slots; slot += 1) {
      const at = slot * step;
      while (
        cursor + 1 < take.frames.length &&
        take.frames[cursor + 1].at <= at
      ) {
        cursor += 1;
      }
      entries.push(
        `file '${take.frames[cursor].file}'\nduration ${step.toFixed(4)}`,
      );
    }
    entries.push(`file '${take.frames[take.frames.length - 1].file}'`);
    const listPath = join(FRAMES_IN, dir, "frames.txt");
    await writeFile(listPath, `${entries.join("\n")}\n`, "utf8");

    const mp4 = join(OUT, "video", `${take.id}.mp4`);
    const webm = join(OUT, "video", `${take.id}.webm`);
    const common = [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-vf",
      `${SCALE(take.width, take.height)},fps=30`,
      "-an",
    ];
    await ffmpeg([
      ...common,
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-preset",
      "slow",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4,
    ]);
    await ffmpeg([
      ...common,
      "-c:v",
      "libvpx-vp9",
      "-crf",
      "34",
      "-b:v",
      "0",
      "-row-mt",
      "1",
      webm,
    ]);

    // Poster: the last beat, which is the settled green state — never a black
    // frame and never mid-transition.
    const posterAt = take.beats[take.beats.length - 1]?.at ?? 0;
    const poster = join(OUT, "posters", `${take.id}.webp`);
    await ffmpeg([
      "-ss",
      String(posterAt + 1),
      "-i",
      mp4,
      "-frames:v",
      "1",
      "-vf",
      SCALE(take.width, take.height),
      "-quality",
      "82",
      poster,
    ]);

    const captions = join(OUT, "video", `${take.id}.vtt`);
    await writeFile(captions, vtt(take.beats, take.durationSeconds), "utf8");

    takes.push({
      id: take.id,
      width: take.width,
      height: take.height,
      durationSeconds: Number(take.durationSeconds.toFixed(2)),
      posterTimestampSeconds: Number((posterAt + 1).toFixed(2)),
      beats: take.beats,
      alt: take.alt,
      caption: take.caption,
      byteBudget: take.byteBudget,
      mp4Bytes: (await stat(mp4)).size,
      webmBytes: (await stat(webm)).size,
      posterBytes: (await stat(poster)).size,
    });
  }
  return takes;
}

async function main() {
  // Only the tool's own scratch output is cleared. `--out` can point at the
  // Cloud repo's served `public/media`, which holds files this tool does not
  // own — wiping that would delete assets the site still references.
  if (OUT === join(ROOT, "output", "media")) {
    await rm(OUT, { recursive: true, force: true });
  }
  for (const dir of ["stills", "video", "posters"]) {
    await mkdir(join(OUT, dir), { recursive: true });
  }
  const stills = await encodeStills();
  const takes = await encodeTakes();
  await writeFile(
    join(OUT, "encoded.json"),
    `${JSON.stringify({ stills, takes }, null, 2)}\n`,
    "utf8",
  );
  const total = [...stills, ...takes].length;
  console.log(`encoded ${total} outputs into ${OUT}`);
  for (const still of stills) {
    console.log(
      `  ${still.id.padEnd(30)} ${String(still.width).padStart(4)}x${String(
        still.height,
      ).padEnd(4)} webp ${String(still.webpBytes ?? still.pngBytes).padStart(7)}B`,
    );
  }
  for (const take of takes) {
    console.log(
      `  ${take.id.padEnd(30)} ${take.durationSeconds}s mp4 ${take.mp4Bytes}B webm ${take.webmBytes}B`,
    );
  }
}

await main();
