"""PoC #1: Server-Side Request Forgery (SSRF) via HTTP Request node.

Regression assertion: after SSRF fix, the executor must NOT make outbound requests
to user-supplied internal URLs.  Before the fix, the executor reaches the target.

Usage:
    python poc_ssrf.py --expected=blocked     # default: assert exploit is blocked
    python poc_ssrf.py --expected=vulnerable  # assert exploit still works (pre-fix)
"""

import argparse
import json
import os
import sys
import time
import urllib.request

SESSION = os.environ.get("APIWEAVE_SESSION")
CSRF = os.environ.get("APIWEAVE_CSRF")


def req(base, method, path, body=None, expect=200):
    url = base + path
    data = None
    if body is not None:
        data = json.dumps(body).encode()
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Cookie", f"session={SESSION}; csrftoken={CSRF}")
    r.add_header("Content-Type", "application/json")
    if method in ("POST", "PUT", "PATCH", "DELETE"):
        r.add_header("X-CSRF-Token", CSRF)
    try:
        resp = urllib.request.urlopen(r, timeout=10)
        return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def main():
    parser = argparse.ArgumentParser(description="SSRF PoC regression assertion")
    parser.add_argument(
        "--expected",
        choices=["blocked", "vulnerable"],
        default="blocked",
        help="Expected outcome: 'blocked' (post-fix) or 'vulnerable' (pre-fix)",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("APIWEAVE_BASE_URL", "http://127.0.0.1:8000"),
        help="Backend base URL (default: $APIWEAVE_BASE_URL or http://127.0.0.1:8000)",
    )
    args = parser.parse_args()
    BASE = args.base_url.rstrip("/")
    expected = args.expected

    if not SESSION or not CSRF:
        print("SKIP: Set APIWEAVE_SESSION and APIWEAVE_CSRF env vars")
        sys.exit(0)

    results = []  # list of (test_name, passed: bool, detail: str)

    # PoC target: localhost backend health endpoint
    target = f"{BASE}/health"
    print(f"[*] PoC SSRF target: {target}")
    print(f"[*] Expected outcome: {expected}")

    # Build a minimal workflow
    workflow = {
        "name": "SSRF PoC - audit",
        "description": "Security audit PoC",
        "nodes": [
            {
                "nodeId": "start_1",
                "type": "start",
                "label": "Start",
                "position": {"x": 100, "y": 100},
                "config": {},
            },
            {
                "nodeId": "http_1",
                "type": "http-request",
                "label": "SSRF probe",
                "position": {"x": 300, "y": 100},
                "config": {
                    "method": "GET",
                    "url": target,
                    "headers": "",
                    "body": "",
                    "bodyType": None,
                    "timeout": 10,
                },
            },
            {
                "nodeId": "end_1",
                "type": "end",
                "label": "End",
                "position": {"x": 500, "y": 100},
                "config": {},
            },
        ],
        "edges": [
            {"edgeId": "e1", "source": "start_1", "target": "http_1"},
            {"edgeId": "e2", "source": "http_1", "target": "end_1"},
        ],
        "variables": {},
    }

    print("[*] Creating workflow...")
    code, wf = req(BASE, "POST", "/api/workflows", workflow)
    if code not in (200, 201):
        print(f"FAIL: create workflow: HTTP {code} {wf}")
        sys.exit(2)
    workflow_id = wf.get("workflowId")
    print(f"[+] Created workflow {workflow_id}")

    print("[*] Triggering run...")
    code, run = req(BASE, "POST", f"/api/workflows/{workflow_id}/run", {})
    if code not in (200, 202):
        print(f"FAIL: trigger: HTTP {code} {run}")
        sys.exit(3)
    run_id = run.get("runId")
    print(f"[+] Run started: {run_id}")

    # Poll for completion
    print("[*] Polling run status...")
    status = {}
    for attempt in range(60):
        time.sleep(1)
        code, status = req(BASE, "GET", f"/api/workflows/{workflow_id}/runs/{run_id}")
        if code != 200:
            print(f"Poll failed: HTTP {code} {status}")
            continue
        run_status = status.get("status", "unknown")
        if run_status in ("completed", "failed"):
            print(f"[+] Run {run_status} after {attempt + 1}s")
            break
    else:
        print("TIMEOUT after 60s")
        sys.exit(4)

    # Inspect the http_1 node result
    print("\n[*] Node result for http_1:")
    code, res = req(
        BASE,
        "GET",
        f"/api/workflows/{workflow_id}/runs/{run_id}/nodes/http_1/result",
    )
    print(json.dumps(res, indent=2)[:2000])

    # --- Assertions ---
    body = res.get("body", {})
    result_status = res.get("status", "")
    error_msg = res.get("error", "")
    json.dumps(body) if isinstance(body, (dict, list)) else str(body)

    ssrf_reached = isinstance(body, dict) and body.get("status") == "healthy"

    if expected == "blocked":
        # PASS if: node result status is error OR body does NOT contain healthy
        if result_status == "error" or not ssrf_reached:
            detail = f"SSRF blocked: status={result_status}, " f"body_has_healthy={ssrf_reached}"
            if error_msg:
                detail += f", error={error_msg[:120]}"
            results.append(("SSRF blocked (no internal reach)", True, detail))
        else:
            results.append(
                (
                    "SSRF blocked (no internal reach)",
                    False,
                    f"SSRF NOT blocked — executor reached {target} and got healthy response",
                )
            )
    else:  # vulnerable
        # PASS if: body contains "status": "healthy"
        if ssrf_reached:
            results.append(
                (
                    "SSRF vulnerable (internal reach confirmed)",
                    True,
                    f"Executor reached {target} — SSRF confirmed",
                )
            )
        else:
            results.append(
                (
                    "SSRF vulnerable (internal reach confirmed)",
                    False,
                    f"Expected SSRF to succeed but it did not — status={result_status}, error={error_msg[:120]}",
                )
            )

    # Cleanup
    req(BASE, "DELETE", f"/api/workflows/{workflow_id}")

    # --- Report ---
    print("\n" + "=" * 60)
    print("ASSERTION RESULTS")
    print("=" * 60)
    all_pass = True
    for name, passed, detail in results:
        tag = "PASS" if passed else "FAIL"
        if not passed:
            all_pass = False
        print(f"  [{tag}] {name}")
        print(f"         {detail}")

    # Save evidence
    evidence_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        ".omo",
        "evidence",
        "task-6-poc-ssrf.txt",
    )
    try:
        os.makedirs(os.path.dirname(evidence_path), exist_ok=True)
        with open(evidence_path, "w", encoding="utf-8") as f:
            f.write(f"poc_ssrf.py — expected={expected}\n")
            f.write(f"base_url={BASE}\n")
            f.write(f"target={target}\n\n")
            f.write("Node result:\n")
            f.write(json.dumps(res, indent=2)[:4000])
            f.write("\n\nAssertions:\n")
            for name, passed, detail in results:
                f.write(f"  [{'PASS' if passed else 'FAIL'}] {name}: {detail}\n")
            f.write(f"\nOverall: {'PASS' if all_pass else 'FAIL'}\n")
        print(f"\n[*] Evidence saved to {evidence_path}")
    except Exception as e:
        print(f"[!] Could not save evidence: {e}")

    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
