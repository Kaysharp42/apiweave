# Documentation Validation Checklist

Run this checklist whenever you change markdown docs.

## 1) Validate links and file references

Command template:

```bash
python docs/link_check.py <doc1.md> <doc2.md> ...
```

For the Phase 1 foundation docs:

```bash
python docs/link_check.py README.md docs/README.md docs/NAVIGATION.md docs/DOCS_VALIDATION_CHECKLIST.md
```

Pass condition:

- Output includes: `Validation passed: no broken links or missing file refs found.`

## 2) Confirm user readability

- The page explains what to do, not just what changed internally.
- Steps are actionable and ordered.
- Jargon is minimized or explained.

## 3) Confirm navigation consistency

- `README.md` points to `docs/README.md`.
- `docs/README.md` points to `docs/NAVIGATION.md`.
- Major guides are discoverable from both.
