#!/usr/bin/env python3
"""Lightweight markdown link and file-reference checker.

Usage:
  python docs/link_check.py <markdown-file> [<markdown-file> ...]

Checks:
  1) Markdown links: [label](path)
  2) Inline code file refs: `path/to/file.ext`

Excludes:
  - http/https/mailto links
  - in-page anchors (#heading)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
INLINE_PATH_RE = re.compile(r"`([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)`")


def normalize_link_target(raw_target: str) -> str:
    target = raw_target.strip()
    if not target:
        return ""

    # Strip optional surrounding angle brackets
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1].strip()

    # Handle optional markdown title syntax: (path "title")
    if " " in target and not target.startswith("http"):
        quote_index = min(
            [idx for idx in (target.find(" \""), target.find(" '")) if idx != -1],
            default=-1,
        )
        if quote_index != -1:
            target = target[:quote_index].strip()

    # Strip fragment
    if "#" in target:
        target = target.split("#", 1)[0].strip()

    return target


def should_skip_target(target: str) -> bool:
    if not target:
        return True
    lowered = target.lower()
    return (
        lowered.startswith("http://")
        or lowered.startswith("https://")
        or lowered.startswith("mailto:")
        or lowered.startswith("#")
    )


def resolve_target(target: str, source: Path, repo_root: Path) -> Path:
    cleaned = target.replace("\\", "/")

    # absolute-like workspace path
    if cleaned.startswith("/"):
        return (repo_root / cleaned.lstrip("/")).resolve()

    # try source-relative first
    source_relative = (source.parent / cleaned).resolve()
    if source_relative.exists():
        return source_relative

    # fallback to repo-root-relative
    repo_relative = (repo_root / cleaned).resolve()
    if repo_relative.exists():
        return repo_relative

    # bare filename fallback: search recursively from repo root
    if "/" not in cleaned:
        matches = [p for p in repo_root.rglob(cleaned) if p.is_file()]
        if matches:
            return matches[0].resolve()

    return repo_relative


def check_file(path: Path, repo_root: Path) -> list[str]:
    errors: list[str] = []

    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception as exc:
        return [f"{path}: cannot read file ({exc})"]

    for index, line in enumerate(lines, start=1):
        for match in MARKDOWN_LINK_RE.finditer(line):
            raw_target = match.group(1)
            target = normalize_link_target(raw_target)
            if should_skip_target(target):
                continue

            resolved = resolve_target(target, path, repo_root)
            if not resolved.exists():
                errors.append(
                    f"{path}:{index}: broken markdown link -> {target}"
                )

        for match in INLINE_PATH_RE.finditer(line):
            target = match.group(1).strip()
            if should_skip_target(target):
                continue

            resolved = resolve_target(target, path, repo_root)
            if not resolved.exists():
                errors.append(
                    f"{path}:{index}: missing inline file ref -> {target}"
                )

    return errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check markdown links and file refs")
    parser.add_argument("files", nargs="+", help="Markdown files to validate")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]

    missing: list[str] = []
    for input_path in args.files:
        candidate = Path(input_path)
        if not candidate.is_absolute():
            candidate = (repo_root / candidate).resolve()
        missing.extend(check_file(candidate, repo_root))

    if missing:
        print("Validation failed:")
        for item in missing:
            print(f"- {item}")
        return 1

    print("Validation passed: no broken links or missing file refs found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
