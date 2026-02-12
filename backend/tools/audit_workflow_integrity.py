from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.request import urlopen

# Ensure backend root is importable when script is executed directly.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.utils.workflow_integrity import summarize_workflows


def _load_json(url: str):
    with urlopen(url) as response:
        return json.load(response)


def _fetch_workflows(base_url: str):
    page = _load_json(f"{base_url}/api/workflows?skip=0&limit=500")
    return page.get("workflows") or []


def _fetch_workflow(base_url: str, workflow_id: str):
    return _load_json(f"{base_url}/api/workflows/{workflow_id}")


def main():
    parser = argparse.ArgumentParser(
        description="Audit workflows for suspicious start-only payloads.",
    )
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--workflow-id", default=None)
    args = parser.parse_args()

    if args.workflow_id:
        workflows = [_fetch_workflow(args.base_url, args.workflow_id)]
    else:
        workflows = _fetch_workflows(args.base_url)

    results = summarize_workflows(workflows)
    suspicious = [r for r in results if r.default_start_only]

    print(f"Audited workflows: {len(results)}")
    print(f"Suspicious default start-only workflows: {len(suspicious)}")

    for item in suspicious:
        print(
            f"- {item.workflow_id} | {item.name} | nodes={item.node_count} | edges={item.edge_count}"
        )


if __name__ == "__main__":
    main()
