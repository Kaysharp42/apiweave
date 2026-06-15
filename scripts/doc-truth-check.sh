#!/usr/bin/env bash
# doc-truth-check.sh — Check for stale "Not Yet Supported" callouts and Known Gaps sections
#
# Greps 9 scoped docs for "Not Yet Supported" (case-insensitive) and
# docs/reference/architecture.md for "## Known Gaps". Exits 0 if nothing
# found, 1 if any matches detected.
#
# Usage: bash scripts/doc-truth-check.sh
#   (run from repo root)

set -euo pipefail

MATCHES=0

# 9 scoped docs: 8 from T21 + docs/operations/encryption.md
SCOPED_DOCS=(
  "docs/features/webhooks.md"
  "docs/features/environments-and-secrets.md"
  "docs/operations/authentication.md"
  "docs/reference/placeholders.md"
  "docs/getting-started/concepts.md"
  "docs/features/variables-and-extractors.md"
  "docs/operations/troubleshooting.md"
  "docs/reference/architecture.md"
  "docs/operations/encryption.md"
)

echo "=== Doc-Truth Check ==="
echo ""

# --- Check 1: "Not Yet Supported" / "not yet supported" in scoped docs ---
echo "--- Checking for 'Not Yet Supported' callouts ---"
for doc in "${SCOPED_DOCS[@]}"; do
  if [ ! -f "$doc" ]; then
    echo "  [SKIP] $doc (file not found)"
    continue
  fi
  count=$(grep -ci "not yet supported" "$doc" 2>/dev/null | tr -d '\r' || echo 0)
  if [ "$count" -gt 0 ] 2>/dev/null; then
    echo "  [FAIL] $doc — $count match(es)"
    MATCHES=$((MATCHES + count))
  else
    echo "  [PASS] $doc"
  fi
done

echo ""

# --- Check 2: "## Known Gaps" heading in architecture.md ---
echo "--- Checking for '## Known Gaps' heading ---"
ARCH_FILE="docs/reference/architecture.md"
if [ -f "$ARCH_FILE" ]; then
  if grep -q "## Known Gaps" "$ARCH_FILE" 2>/dev/null; then
    echo "  [FAIL] $ARCH_FILE contains '## Known Gaps' heading"
    MATCHES=$((MATCHES + 1))
  else
    echo "  [PASS] $ARCH_FILE"
  fi
else
  echo "  [SKIP] $ARCH_FILE (file not found)"
fi

echo ""
echo "=== Result ==="
if [ "$MATCHES" -gt 0 ]; then
  echo "FAIL: $MATCHES doc-truth issue(s) found." >&2
  exit 1
else
  echo "PASS: No doc-truth issues found."
  exit 0
fi
